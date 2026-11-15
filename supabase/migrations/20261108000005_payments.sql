-- =====================================================================
-- Phase 4: payments.
-- * 'mock' provider = payment simulator (no sandbox credentials yet). Same flow as MoMo/VNPay.
-- * confirm_payment(): ONE transaction that locks the payment row, checks amount, records the
--   gateway result and (on success) extends the subscription + profile.premium_expires_at.
--   Idempotent: repeated IPN / return calls do nothing after the first.
-- * expire_billing(): daily housekeeping (pending payments past expiry, ended subscriptions).
-- =====================================================================

alter type public.payment_provider add value if not exists 'mock';

create or replace function public.confirm_payment(
  p_payment  uuid,
  p_outcome  text,      -- 'succeeded' | 'failed' | 'cancelled'
  p_txn      text,
  p_amount   integer,
  p_payload  jsonb,
  p_code     text default null,
  p_message  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pay   public.payments;
  sub   public.subscriptions;
  start timestamptz;
  span  interval;
  new_end timestamptz;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid outcome %', p_outcome;
  end if;

  select * into pay from public.payments where id = p_payment for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if pay.status = 'succeeded' then
    return jsonb_build_object('result', 'already_succeeded', 'status', pay.status, 'user_id', pay.user_id);
  end if;

  if p_outcome <> 'succeeded' then
    -- A failure/cancel only closes a payment that is still open; never overrides a later success.
    if pay.status <> 'pending' then
      return jsonb_build_object('result', 'already_closed', 'status', pay.status, 'user_id', pay.user_id);
    end if;
    update public.payments
       set status = p_outcome::public.payment_status, provider_txn_id = coalesce(p_txn, provider_txn_id),
           failure_code = p_code, failure_message = left(p_message, 500), ipn_payload = p_payload
     where id = pay.id;
    return jsonb_build_object('result', 'closed', 'status', p_outcome, 'user_id', pay.user_id);
  end if;

  -- Success. Money was taken, so honour it even if the order had expired or been superseded,
  -- but only when the amount matches what we asked for.
  if p_amount is distinct from pay.amount_vnd then
    update public.payments
       set failure_code = 'AMOUNT_MISMATCH', failure_message = format('expected %s, got %s', pay.amount_vnd, p_amount), ipn_payload = p_payload
     where id = pay.id;
    return jsonb_build_object('result', 'amount_mismatch', 'status', pay.status, 'user_id', pay.user_id);
  end if;

  span := case pay.cycle when 'yearly' then interval '1 year' else interval '1 month' end;
  select * into sub from public.subscriptions where user_id = pay.user_id and status = 'active' for update;

  if found and sub.current_period_end > now() then
    new_end := sub.current_period_end + span;         -- renew early: stack on top of the current period
    update public.subscriptions set current_period_end = new_end, cycle = pay.cycle where id = sub.id;
  else
    if found then
      update public.subscriptions set status = 'expired' where id = sub.id;
    end if;
    start := now();
    new_end := start + span;
    insert into public.subscriptions (user_id, plan, cycle, status, current_period_start, current_period_end)
    values (pay.user_id, 'premium', pay.cycle, 'active', start, new_end)
    returning * into sub;
  end if;

  update public.profiles set plan = 'premium', premium_expires_at = new_end where id = pay.user_id;
  update public.payments
     set status = 'succeeded', paid_at = now(), subscription_id = sub.id, provider_txn_id = coalesce(p_txn, provider_txn_id),
         failure_code = null, failure_message = null, ipn_payload = p_payload
   where id = pay.id;

  return jsonb_build_object('result', 'activated', 'status', 'succeeded', 'user_id', pay.user_id,
                            'premium_expires_at', new_end, 'resume_session_id', pay.resume_session_id);
end $$;

create or replace function public.expire_billing() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_pay int; n_sub int; n_prof int;
begin
  update public.payments set status = 'expired', failure_code = coalesce(failure_code, 'EXPIRED')
   where status = 'pending' and expires_at < now() - interval '1 hour';   -- grace period for late IPNs
  get diagnostics n_pay = row_count;
  update public.subscriptions set status = 'expired' where status = 'active' and current_period_end < now();
  get diagnostics n_sub = row_count;
  update public.profiles set plan = 'free', premium_expires_at = null where plan = 'premium' and premium_expires_at < now();
  get diagnostics n_prof = row_count;
  return jsonb_build_object('payments_expired', n_pay, 'subscriptions_expired', n_sub, 'profiles_downgraded', n_prof);
end $$;

revoke execute on function public.confirm_payment(uuid, text, text, integer, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.expire_billing() from public, anon, authenticated;
grant  execute on function public.confirm_payment(uuid, text, text, integer, jsonb, text, text) to service_role;
grant  execute on function public.expire_billing() to service_role;
