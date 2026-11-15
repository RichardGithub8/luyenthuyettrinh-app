import 'server-only';
import { NextResponse } from 'next/server';
import type { PaymentProvider } from '@/types/database';
import { serverEnv } from '@/lib/env';
import { appUrl, paymentIpnUrl, paymentReturnUrl } from '@/lib/urls';
import { hmacHex, mockVerify, momoCreateBody, momoVerify, vnpayCheckoutUrl, vnpayVerify, VNPAY_RSP, type Verified } from '@/payments/core';

export type IpnAck = 'ok' | 'already' | 'not_found' | 'bad_amount' | 'bad_signature' | 'error';
export interface CheckoutInput {
  paymentId: string; orderCode: string; amountVnd: number; info: string;
  ipAddr: string; locale: 'vi' | 'en'; createdAt: Date; expiresAt: Date;
}
/**
 * One interface for every gateway. The payment service never branches on provider:
 * adding a real gateway = implement these three methods + set its env credentials.
 */
export interface Gateway {
  name: PaymentProvider;
  /** IPN transport the gateway uses (VNPay: GET query; MoMo/mock: POST JSON). */
  ipnMethod: 'GET' | 'POST';
  createCheckout(i: CheckoutInput): Promise<{ checkoutUrl: string }>;
  /** Verify a signed IPN body or browser-return query. */
  verify(input: Record<string, unknown>): Verified;
  ipnReply(ack: IpnAck): Response;
}

export const mockSecret = () => {
  const env = serverEnv();
  return env.MOCK_PAYMENT_SECRET ?? hmacHex('sha256', env.SUPABASE_SERVICE_ROLE_KEY, 'luyenthuyettrinh/mock-payment/v1');
};

const mock = (): Gateway => ({
  name: 'mock', ipnMethod: 'POST',
  async createCheckout(i) { return { checkoutUrl: appUrl(`/pay/mock/${i.paymentId}`) }; },
  verify: (input) => mockVerify(mockSecret(), input),
  ipnReply: (ack) => NextResponse.json({ ack }, { status: ack === 'bad_signature' ? 400 : ack === 'error' ? 500 : 200 }),
});

const vnpay = (): Gateway => {
  const env = serverEnv();
  const cfg = { tmnCode: env.VNPAY_TMN_CODE!, hashSecret: env.VNPAY_HASH_SECRET!, payUrl: env.VNPAY_PAYMENT_URL };
  return {
    name: 'vnpay', ipnMethod: 'GET',
    // IPN URL is configured in the VNPay merchant portal: point it to paymentIpnUrl('vnpay').
    async createCheckout(i) {
      return { checkoutUrl: vnpayCheckoutUrl(cfg, { orderCode: i.orderCode, amountVnd: i.amountVnd, info: i.info, returnUrl: paymentReturnUrl('vnpay', i.paymentId), ipAddr: i.ipAddr, locale: i.locale, createdAt: i.createdAt, expiresAt: i.expiresAt }) };
    },
    verify: (input) => vnpayVerify(cfg, input),
    ipnReply: (ack) => NextResponse.json({ ok: VNPAY_RSP.ok, already: VNPAY_RSP.alreadyConfirmed, not_found: VNPAY_RSP.notFound, bad_amount: VNPAY_RSP.badAmount, bad_signature: VNPAY_RSP.badSignature, error: VNPAY_RSP.error }[ack]),
  };
};

const momo = (): Gateway => {
  const env = serverEnv();
  const cfg = { partnerCode: env.MOMO_PARTNER_CODE!, accessKey: env.MOMO_ACCESS_KEY!, secretKey: env.MOMO_SECRET_KEY!, endpoint: env.MOMO_ENDPOINT };
  return {
    name: 'momo', ipnMethod: 'POST',
    async createCheckout(i) {
      const body = momoCreateBody(cfg, { orderCode: i.orderCode, requestId: i.paymentId, amountVnd: i.amountVnd, info: i.info, redirectUrl: paymentReturnUrl('momo', i.paymentId), ipnUrl: paymentIpnUrl('momo'), locale: i.locale });
      const res = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const json = (await res.json().catch(() => ({}))) as { resultCode?: number; payUrl?: string; message?: string };
      if (!res.ok || json.resultCode !== 0 || !json.payUrl) throw new Error(`momo create failed: ${res.status} ${json.resultCode} ${json.message ?? ''}`);
      return { checkoutUrl: json.payUrl };
    },
    verify: (input) => momoVerify(cfg, input),
    // MoMo expects HTTP 204 once the IPN is accepted (including duplicates).
    ipnReply: (ack) => (ack === 'ok' || ack === 'already' ? new Response(null, { status: 204 }) : NextResponse.json({ ack }, { status: ack === 'error' ? 500 : 400 })),
  };
};

/** Providers usable right now, in display order. */
export function enabledProviders(): PaymentProvider[] {
  const env = serverEnv(), list: PaymentProvider[] = [];
  if (env.MOMO_PARTNER_CODE && env.MOMO_ACCESS_KEY && env.MOMO_SECRET_KEY) list.push('momo');
  if (env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET) list.push('vnpay');
  if (env.PAYMENT_MOCK_ENABLED === 'true') list.push('mock');
  return list;
}

export function gateway(provider: PaymentProvider): Gateway | null {
  if (!enabledProviders().includes(provider)) return null;
  return provider === 'momo' ? momo() : provider === 'vnpay' ? vnpay() : mock();
}
