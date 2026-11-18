-- =====================================================================
-- Pricing v2 (owner's pricing sheet, 2026-11-18): Free / Pass / Premium / Team.
--   * Pass    59.000đ  → 7 days, 15 analyses per pass window, 20 min/submission. Buying again while
--                        active adds 7 days and 15 analyses to the same window.
--   * Premium 79.000đ/month or 399.000đ/6 months → 60 analyses/month (fair use), 30 min/submission.
--   * Team    690.000đ/month or 3.490.000đ/6 months → up to 5 members (leader included), each with
--                        Premium privileges; leader dashboard; shared team scripts.
-- One active subscription per user: same product stacks, a higher product replaces a lower one,
-- buying a lower product than the current plan is refused by the API (and honoured safely here if
-- money arrives anyway).
-- New enum values are only used at run time (inside functions), never in this file's DML, so the
-- "ADD VALUE inside a transaction" rule is respected.
-- =====================================================================

alter type public.plan_tier add value if not exists 'pass';
alter type public.plan_tier add value if not exists 'team';
alter type public.billing_cycle add value if not exists 'semiannual';
alter type public.billing_cycle add value if not exists 'once';

-- ---------------------------------------------------------------- profiles
-- premium_expires_at now means "paid plan ends at" for every paid plan.
alter table public.profiles add column if not exists plan_started_at timestamptz;
alter table public.profiles add column if not exists pass_credits integer not null default 0 check (pass_credits >= 0);
drop index if exists public.profiles_premium_expiry_idx;
create index if not exists profiles_paid_expiry_idx on public.profiles (premium_expires_at) where plan <> 'free';

create or replace function public.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select plan::text in ('premium', 'team') and premium_expires_at > now() from public.profiles where id = p_user), false)
$$;

-- ---------------------------------------------------------------- usage per scope
-- Monthly plans count per calendar month (VN time); a Pass counts per pass window.
alter table public.usage_counters add column if not exists scope text not null default 'month' check (scope in ('month', 'pass'));
alter table public.usage_counters drop constraint if exists usage_counters_pkey;
alter table public.usage_counters add primary key (user_id, scope, period_start);

create or replace function public.usage_key(p_user uuid, out scope text, out period date)
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user;
  if found and p.plan::text = 'pass' and p.premium_expires_at > now() and p.plan_started_at is not null then
    scope := 'pass'; period := (p.plan_started_at at time zone 'Asia/Ho_Chi_Minh')::date;
  else
    scope := 'month'; period := public.current_usage_period();
  end if;
end $$;

create or replace function public.reserve_analysis_credit(p_user uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare k record; v_used integer;
begin
  select * into k from public.usage_key(p_user);
  insert into public.usage_counters (user_id, scope, period_start) values (p_user, k.scope, k.period) on conflict do nothing;
  update public.usage_counters set analyses_used = analyses_used + 1
   where user_id = p_user and scope = k.scope and period_start = k.period and analyses_used < p_limit
  returning analyses_used into v_used;
  return v_used is not null;
end $$;

create or replace function public.refund_analysis_credit(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  select * into k from public.usage_key(p_user);
  update public.usage_counters set analyses_used = greatest(analyses_used - 1, 0)
   where user_id = p_user and scope = k.scope and period_start = k.period;
end $$;

-- ---------------------------------------------------------------- products on billing rows
alter table public.payments      add column if not exists product text not null default 'premium' check (product in ('pass', 'premium', 'team'));
alter table public.subscriptions add column if not exists product text not null default 'premium' check (product in ('pass', 'premium', 'team'));

-- ---------------------------------------------------------------- teams
create table if not exists public.teams (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null unique references public.profiles(id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  plan_expires_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();

create table if not exists public.team_members (
  team_id     uuid not null references public.teams(id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) <= 254),
  user_id     uuid references public.profiles(id) on delete set null,
  role        text not null default 'member' check (role in ('leader', 'member')),
  status      text not null default 'invited' check (status in ('invited', 'active')),
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  primary key (team_id, email)
);
create unique index if not exists team_members_one_team_idx on public.team_members (user_id) where status = 'active';
create index if not exists team_members_email_idx on public.team_members (email) where status = 'invited';

create table if not exists public.team_scripts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 20000),
  created_at  timestamptz not null default now()
);
create index if not exists team_scripts_team_idx on public.team_scripts (team_id, created_at desc);

-- Only the backend (service role) reads/writes team data; it checks leader/member rights itself.
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.team_scripts enable row level security;

-- Give a user team privileges (or take them back) according to the team's paid period.
-- A member keeps the later of their own paid end and the team's end.
create or replace function public.team_sync_member(p_user uuid, p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if not found or t.plan_expires_at is null or t.plan_expires_at <= now() then return; end if;
  update public.profiles
     set plan = 'team',
         premium_expires_at = case when plan::text in ('premium', 'team') and premium_expires_at > t.plan_expires_at then premium_expires_at else t.plan_expires_at end,
         pass_credits = 0
   where id = p_user;
end $$;

-- Back to the user's own subscription (if any is still running), else Free.
create or replace function public.team_unsync_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.subscriptions;
begin
  select * into s from public.subscriptions where user_id = p_user and status = 'active' and current_period_end > now() and product <> 'team';
  if found then
    update public.profiles set plan = s.product::public.plan_tier, premium_expires_at = s.current_period_end where id = p_user and plan::text = 'team';
  else
    update public.profiles set plan = 'free', premium_expires_at = null, pass_credits = 0 where id = p_user and plan::text = 'team';
  end if;
end $$;

-- Invite by email (leader only; the API checks who is calling). Seats = leader + members + open invites ≤ 5.
create or replace function public.team_invite(p_team uuid, p_email text, p_max integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer; e text := lower(trim(p_email));
begin
  perform 1 from public.teams where id = p_team for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if exists (select 1 from public.team_members where team_id = p_team and email = e) then return jsonb_build_object('result', 'already'); end if;
  select count(*) into n from public.team_members where team_id = p_team;
  if n >= p_max then return jsonb_build_object('result', 'full', 'max', p_max); end if;
  insert into public.team_members (team_id, email, role, status) values (p_team, e, 'member', 'invited');
  return jsonb_build_object('result', 'invited');
end $$;

-- Accept an invite sent to the user's email. A user can be active in one team only.
create or replace function public.team_join(p_team uuid, p_user uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.team_members;
begin
  select * into m from public.team_members where team_id = p_team and email = lower(p_email) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if m.status = 'active' and m.user_id = p_user then return jsonb_build_object('result', 'already'); end if;
  if exists (select 1 from public.team_members where user_id = p_user and status = 'active' and team_id <> p_team) then
    return jsonb_build_object('result', 'in_other_team');
  end if;
  update public.team_members set user_id = p_user, status = 'active', joined_at = now() where team_id = p_team and email = m.email;
  perform public.team_sync_member(p_user, p_team);
  return jsonb_build_object('result', 'joined');
end $$;

-- Remove a member (leader) or leave (member). The leader cannot be removed.
create or replace function public.team_remove(p_team uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.team_members;
begin
  select * into m from public.team_members where team_id = p_team and email = lower(p_email) for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if m.role = 'leader' then return jsonb_build_object('result', 'is_leader'); end if;
  delete from public.team_members where team_id = p_team and email = m.email;
  if m.user_id is not null and m.status = 'active' then perform public.team_unsync_member(m.user_id); end if;
  return jsonb_build_object('result', 'removed');
end $$;

-- ---------------------------------------------------------------- confirm_payment v2
create or replace function public.confirm_payment(
  p_payment uuid, p_outcome text, p_txn text, p_amount integer, p_payload jsonb, p_code text default null, p_message text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pay   public.payments;
  sub   public.subscriptions;
  prof  public.profiles;
  tm    public.teams;
  span  interval;
  new_end timestamptz;
  owner_name text;
  r record;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled') then raise exception 'invalid outcome %', p_outcome; end if;

  select * into pay from public.payments where id = p_payment for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if pay.status = 'succeeded' then return jsonb_build_object('result', 'already_succeeded', 'status', pay.status, 'user_id', pay.user_id); end if;

  if p_outcome <> 'succeeded' then
    if pay.status <> 'pending' then return jsonb_build_object('result', 'already_closed', 'status', pay.status, 'user_id', pay.user_id); end if;
    update public.payments set status = p_outcome::public.payment_status, provider_txn_id = coalesce(p_txn, provider_txn_id),
           failure_code = p_code, failure_message = left(p_message, 500), ipn_payload = p_payload
     where id = pay.id;
    return jsonb_build_object('result', 'closed', 'status', p_outcome, 'user_id', pay.user_id);
  end if;

  if p_amount is distinct from pay.amount_vnd then
    update public.payments set failure_code = 'AMOUNT_MISMATCH', failure_message = format('expected %s, got %s', pay.amount_vnd, p_amount), ipn_payload = p_payload
     where id = pay.id;
    return jsonb_build_object('result', 'amount_mismatch', 'status', pay.status, 'user_id', pay.user_id);
  end if;

  span := case pay.cycle::text when 'once' then interval '7 days' when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year' else interval '1 month' end;
  select * into prof from public.profiles where id = pay.user_id for update;
  select * into sub from public.subscriptions where user_id = pay.user_id and status = 'active' for update;

  if pay.product = 'pass' and prof.plan::text in ('premium', 'team') and prof.premium_expires_at > now() then
    -- A Pass bought while on a higher plan (the API refuses this; if money arrives anyway it is not lost):
    -- extend the higher plan by the Pass's 7 days instead of downgrading.
    update public.profiles set premium_expires_at = premium_expires_at + span where id = pay.user_id;
    if sub.id is not null then update public.subscriptions set current_period_end = current_period_end + span where id = sub.id; end if;
    update public.payments set status = 'succeeded', paid_at = now(), subscription_id = sub.id, provider_txn_id = coalesce(p_txn, provider_txn_id),
           failure_code = 'APPLIED_TO_HIGHER_PLAN', failure_message = null, ipn_payload = p_payload
     where id = pay.id;
    return jsonb_build_object('result', 'activated', 'status', 'succeeded', 'user_id', pay.user_id, 'product', pay.product,
                              'premium_expires_at', (select premium_expires_at from public.profiles where id = pay.user_id), 'resume_session_id', pay.resume_session_id);
  end if;

  if sub.id is not null and sub.product = pay.product and sub.current_period_end > now() then
    -- Same product still running: stack the new period on top.
    new_end := sub.current_period_end + span;
    update public.subscriptions set current_period_end = new_end, cycle = pay.cycle where id = sub.id;
  else
    if sub.id is not null then update public.subscriptions set status = 'expired' where id = sub.id; end if;
    new_end := now() + span;
    insert into public.subscriptions (user_id, plan, product, cycle, status, current_period_start, current_period_end)
    values (pay.user_id, pay.product::public.plan_tier, pay.product, pay.cycle, 'active', now(), new_end)
    returning * into sub;
  end if;

  if pay.product = 'pass' then
    if prof.plan::text = 'pass' and prof.premium_expires_at > now() then
      update public.profiles set premium_expires_at = new_end, pass_credits = pass_credits + 15 where id = pay.user_id;
    else
      update public.profiles set plan = 'pass', plan_started_at = now(), premium_expires_at = new_end, pass_credits = 15 where id = pay.user_id;
    end if;

  elsif pay.product = 'premium' then
    if prof.plan::text = 'team' and prof.premium_expires_at > now() then
      update public.profiles set premium_expires_at = greatest(premium_expires_at, new_end) where id = pay.user_id;
    else
      update public.profiles set plan = 'premium', plan_started_at = coalesce(case when prof.plan::text = 'premium' then prof.plan_started_at end, now()),
             premium_expires_at = new_end, pass_credits = 0 where id = pay.user_id;
    end if;

  else -- team: the payer leads the team; every active member gets team privileges until the team's end.
    select * into tm from public.teams where owner_id = pay.user_id for update;
    if not found then
      owner_name := nullif(trim(prof.full_name), '');
      insert into public.teams (owner_id, name, plan_expires_at)
      values (pay.user_id, left(coalesce('Nhóm ' || owner_name, 'Nhóm luyện thuyết trình'), 80), new_end)
      returning * into tm;
    else
      update public.teams set plan_expires_at = new_end where id = tm.id returning * into tm;
    end if;
    insert into public.team_members (team_id, email, user_id, role, status, joined_at)
    values (tm.id, lower(prof.email), pay.user_id, 'leader', 'active', now())
    on conflict (team_id, email) do update set user_id = excluded.user_id, role = 'leader', status = 'active', joined_at = coalesce(public.team_members.joined_at, now());
    for r in select user_id from public.team_members where team_id = tm.id and status = 'active' and user_id is not null loop
      perform public.team_sync_member(r.user_id, tm.id);
    end loop;
  end if;

  update public.payments set status = 'succeeded', paid_at = now(), subscription_id = sub.id, provider_txn_id = coalesce(p_txn, provider_txn_id),
         failure_code = null, failure_message = null, ipn_payload = p_payload
   where id = pay.id;

  return jsonb_build_object('result', 'activated', 'status', 'succeeded', 'user_id', pay.user_id, 'product', pay.product,
                            'premium_expires_at', (select premium_expires_at from public.profiles where id = pay.user_id), 'resume_session_id', pay.resume_session_id);
end $$;

-- ---------------------------------------------------------------- daily housekeeping v2
create or replace function public.expire_billing() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_pay int; n_sub int; n_prof int;
begin
  update public.payments set status = 'expired', failure_code = coalesce(failure_code, 'EXPIRED')
   where status = 'pending' and expires_at < now() - interval '1 hour';
  get diagnostics n_pay = row_count;
  update public.subscriptions set status = 'expired' where status = 'active' and current_period_end < now();
  get diagnostics n_sub = row_count;
  update public.profiles set plan = 'free', premium_expires_at = null, pass_credits = 0 where plan::text <> 'free' and premium_expires_at < now();
  get diagnostics n_prof = row_count;
  return jsonb_build_object('payments_expired', n_pay, 'subscriptions_expired', n_sub, 'profiles_downgraded', n_prof);
end $$;

revoke execute on function public.usage_key(uuid) from public, anon, authenticated;
revoke execute on function public.team_sync_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.team_unsync_member(uuid) from public, anon, authenticated;
revoke execute on function public.team_invite(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.team_join(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.team_remove(uuid, text) from public, anon, authenticated;
grant execute on function public.usage_key(uuid) to service_role;
grant execute on function public.team_sync_member(uuid, uuid) to service_role;
grant execute on function public.team_unsync_member(uuid) to service_role;
grant execute on function public.team_invite(uuid, text, integer) to service_role;
grant execute on function public.team_join(uuid, uuid, text) to service_role;
grant execute on function public.team_remove(uuid, text) to service_role;
