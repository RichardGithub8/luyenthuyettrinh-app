import 'server-only';
import type { Db } from '@/repositories/types';
import type { BillingCycle, PaymentProvider, PaymentRow, Product } from '@/types/database';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import { PLAN_RANK, PRICES_VND, priceOf } from '@/config/plans';
import { profileService } from '@/services/profile.service';
import { paymentRepository } from '@/repositories/payment.repository';
import { sessionRepository } from '@/repositories/session.repository';
import { practiceService } from '@/services/practice.service';
import { gateway, enabledProviders, mockSecret, type IpnAck } from '@/payments/gateways';
import { landingPath, mockSign, newOrderCode, type Outcome } from '@/payments/core';

const log = logger.child({ module: 'payment' });
const RESUMABLE = ['pending_premium', 'pending_quota'] as const;

export function paymentView(p: PaymentRow) {
  const expired = p.status === 'pending' && new Date(p.expires_at).getTime() < Date.now();
  return {
    id: p.id, provider: p.provider, orderCode: p.order_code, amountVnd: p.amount_vnd, product: p.product, cycle: p.cycle,
    status: expired ? 'expired' as const : p.status, resumeSessionId: p.resume_session_id, returnPath: p.return_path,
    failureCode: p.failure_code, expiresAt: p.expires_at, paidAt: p.paid_at, createdAt: p.created_at,
    landingPath: landingPath({ status: expired ? 'expired' : p.status, resumeSessionId: p.resume_session_id, returnPath: p.return_path, paymentId: p.id }),
  };
}

type ConfirmResult = { result: 'activated' | 'already_succeeded' | 'closed' | 'already_closed' | 'amount_mismatch' | 'not_found'; status?: string; premium_expires_at?: string };
const ACK: Record<ConfirmResult['result'], IpnAck> = {
  activated: 'ok', closed: 'ok', already_succeeded: 'already', already_closed: 'already', amount_mismatch: 'bad_amount', not_found: 'not_found',
};

/**
 * After a successful payment, analyse the talk the user was blocked on — right away, server-side,
 * so it is already running when the browser lands back on that talk. Only from a "waiting" status,
 * so repeated IPN/return calls never re-run or double-charge a finished/failed analysis.
 */
async function resumeAnalysis(db: Db, p: PaymentRow) {
  if (!p.resume_session_id) return;
  const s = await sessionRepository.findOwned(db, p.user_id, p.resume_session_id);
  if (!s || !(RESUMABLE as readonly string[]).includes(s.status)) return;
  try {
    const v = await practiceService.requestAnalysis(db, p.user_id, s.id);
    log.info('resumed analysis after payment', { paymentId: p.id, sessionId: s.id, status: v.status });
  } catch (e) {
    // Payment is still valid; the talk page shows "Analyse now" so the user can retry.
    log.error('resume analysis failed', { paymentId: p.id, sessionId: s.id, error: String(e) });
  }
}

export const paymentService = {
  providers() {
    return { providers: enabledProviders(), prices: PRICES_VND, currency: 'VND' as const };
  },

  async create(db: Db, userId: string, i: { provider: PaymentProvider; product: Product; cycle: BillingCycle; resumeSessionId?: string; returnPath?: string }, ctx: { ip: string; lang: 'vi' | 'en' }) {
    const amount = priceOf(i.product, i.cycle);
    if (!amount) throw new AppError('VALIDATION_FAILED', { fields: { cycle: ['INVALID_FOR_PRODUCT'] } });
    // Không bán gói thấp hơn gói đang dùng; thành viên (không phải trưởng nhóm) không tự gia hạn Team.
    const me = await profileService.getMe(db, userId);
    if (PLAN_RANK[me.plan] > PLAN_RANK[i.product]) throw new AppError('PLAN_ALREADY_HIGHER', { plan: me.plan });
    if (i.product === 'team' && me.plan === 'team') {
      const { data: own } = await db.from('teams').select('id').eq('owner_id', userId).maybeSingle();
      if (!own) throw new AppError('ALREADY_IN_TEAM');
    }
    const gw = gateway(i.provider);
    if (!gw) throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', { provider: i.provider, available: enabledProviders() });
    if (i.resumeSessionId && !(await sessionRepository.findOwned(db, userId, i.resumeSessionId))) throw new AppError('NOT_FOUND', { resource: 'session' });

    // One open checkout per user: an older tab's order is superseded (a late success on it is still honoured).
    await paymentRepository.cancelOpen(db, userId, 'SUPERSEDED');
    const now = new Date(), expiresAt = new Date(now.getTime() + serverEnv().PAYMENT_TTL_MIN * 60_000);
    const p = await paymentRepository.insert(db, {
      user_id: userId, provider: i.provider, order_code: newOrderCode(now), amount_vnd: amount, product: i.product, cycle: i.cycle,
      resume_session_id: i.resumeSessionId ?? null, return_path: i.returnPath ?? null, expires_at: expiresAt.toISOString(),
    });
    const info = `luyenthuyettrinh ${i.product} ${i.cycle} ${p.order_code}`;
    try {
      const { checkoutUrl } = await gw.createCheckout({ paymentId: p.id, orderCode: p.order_code, amountVnd: amount, info, ipAddr: ctx.ip, locale: ctx.lang, createdAt: now, expiresAt });
      log.info('payment created', { paymentId: p.id, provider: i.provider, product: i.product, cycle: i.cycle, resume: !!i.resumeSessionId });
      return { ...paymentView(p), checkoutUrl };
    } catch (e) {
      await paymentRepository.transition(db, p.id, ['pending'], { status: 'failed', failure_code: 'GATEWAY_ERROR', failure_message: String(e).slice(0, 500) });
      log.error('gateway create failed', { paymentId: p.id, provider: i.provider, error: String(e) });
      throw new AppError('PAYMENT_GATEWAY_ERROR', undefined, e);
    }
  },

  async get(db: Db, userId: string, id: string) {
    const p = await paymentRepository.findOwned(db, userId, id);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'payment' });
    return paymentView(p);
  },

  async list(db: Db, userId: string) {
    return (await paymentRepository.list(db, userId)).map(paymentView);
  },

  /** User closed the checkout without paying. A later success IPN still wins (money taken). */
  async cancel(db: Db, userId: string, id: string) {
    const p = await paymentRepository.findOwned(db, userId, id);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'payment' });
    const updated = await paymentRepository.transition(db, p.id, ['pending'], { status: 'cancelled', failure_code: 'USER_CANCELLED' });
    return paymentView(updated ?? p);
  },

  /**
   * Shared by IPN (server→server) and browser return: verify signature, then confirm atomically in SQL.
   * Idempotent: duplicates return 'already'. Whichever arrives first activates Premium.
   */
  async handleCallback(db: Db, provider: PaymentProvider, input: Record<string, unknown>, source: 'ipn' | 'return'): Promise<{ ack: IpnAck; payment: PaymentRow | null }> {
    const gw = gateway(provider);
    if (!gw) return { ack: 'not_found', payment: null };
    const v = gw.verify(input);
    if (!v.ok) { log.warn('callback rejected', { provider, source, reason: v.reason }); return { ack: 'bad_signature', payment: null }; }
    const r = v.result;
    const p = await paymentRepository.byOrderCode(db, provider, r.orderCode);
    if (!p) { log.warn('callback for unknown order', { provider, source, orderCode: r.orderCode }); return { ack: 'not_found', payment: null }; }

    const { data, error } = await db.rpc('confirm_payment', {
      p_payment: p.id, p_outcome: r.outcome, p_txn: r.txnId, p_amount: r.amountVnd, p_payload: { source, ...r.raw }, p_code: r.code, p_message: r.message,
    });
    if (error) { log.error('confirm_payment failed', { paymentId: p.id, error: error.message }); return { ack: 'error', payment: p }; }
    const res = data as unknown as ConfirmResult;
    log.info('payment callback', { paymentId: p.id, provider, source, outcome: r.outcome, result: res.result });
    if (res.result === 'amount_mismatch') log.error('AMOUNT MISMATCH — manual review', { paymentId: p.id, expected: p.amount_vnd, got: r.amountVnd });

    const fresh = (await paymentRepository.byId(db, p.id)) ?? p;
    if (fresh.status === 'succeeded') await resumeAnalysis(db, fresh);
    return { ack: ACK[res.result], payment: fresh };
  },

  /**
   * Mock checkout: the simulator page posts the user's choice here. We sign a gateway-shaped payload
   * and push it through exactly the same verify → confirm → resume path a real IPN uses.
   * Returns the gateway-style return URL query (also signed), like MoMo/VNPay redirects.
   */
  async simulate(db: Db, userId: string, id: string, outcome: Outcome) {
    const p = await paymentRepository.findOwned(db, userId, id);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'payment' });
    if (p.provider !== 'mock') throw new AppError('INVALID_STATE', { reason: 'not_mock' });
    if (p.status !== 'pending') throw new AppError('PAYMENT_NOT_PENDING', { status: p.status });
    if (new Date(p.expires_at).getTime() < Date.now()) throw new AppError('PAYMENT_EXPIRED');
    const payload = mockSign(mockSecret(), { orderCode: p.order_code, txnId: `MOCK${Date.now()}`, amount: p.amount_vnd, outcome });
    await this.handleCallback(db, 'mock', payload, 'ipn');
    return { returnQuery: new URLSearchParams(payload).toString() };
  },
};
