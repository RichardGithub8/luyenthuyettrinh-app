/**
 * Pure payment-gateway logic (no env, no DB) so it can be unit-tested.
 * Each gateway: build a checkout request, verify a signed callback (IPN or browser return),
 * and normalise it into a GatewayResult. Signature specs:
 *   - VNPay 2.1.0: HMAC-SHA512 over sorted, form-encoded query params.
 *   - MoMo v2 (captureWallet): HMAC-SHA256 over a fixed-order "k=v&..." string.
 *   - Mock: HMAC-SHA256 over sorted "k=v&..." (same shape as a real gateway).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Outcome = 'succeeded' | 'failed' | 'cancelled';
export interface GatewayResult {
  orderCode: string;
  txnId: string | null;
  amountVnd: number;
  outcome: Outcome;
  code: string;          // gateway result code, kept for support/debugging
  message: string;
  raw: Record<string, string>;
}
export type Verified = { ok: true; result: GatewayResult } | { ok: false; reason: 'invalid_signature' | 'malformed' };

export const hmacHex = (algo: 'sha256' | 'sha512', key: string, data: string) => createHmac(algo, key).update(data, 'utf8').digest('hex');
export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a.toLowerCase(), 'utf8'), y = Buffer.from(b.toLowerCase(), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
export const toRecord = (o: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)]));

/** Order code: alphanumeric only (VNPay TxnRef/MoMo orderId safe), sortable, unguessable suffix. */
export function newOrderCode(now = new Date(), rand = () => Math.random()) {
  const t = new Date(now.getTime() + 7 * 3600_000).toISOString().replace(/\D/g, '').slice(2, 14); // yyMMddHHmmss in GMT+7
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(rand() * abc.length)];
  return `LTT${t}${s}`;
}

// ------------------------------------------------------------------ Mock
export const MOCK_CODES = { succeeded: '00', cancelled: '24', failed: '51' } as const;
const MOCK_FIELDS = ['orderCode', 'txnId', 'amount', 'resultCode', 'message'] as const;
const mockSignData = (p: Record<string, string>) => MOCK_FIELDS.map((k) => `${k}=${p[k] ?? ''}`).join('&');

export function mockSign(secret: string, p: { orderCode: string; txnId: string; amount: number; outcome: Outcome; message?: string }) {
  const payload = { orderCode: p.orderCode, txnId: p.txnId, amount: String(p.amount), resultCode: MOCK_CODES[p.outcome], message: p.message ?? p.outcome };
  return { ...payload, signature: hmacHex('sha256', secret, mockSignData(payload)) };
}
export function mockVerify(secret: string, input: Record<string, unknown>): Verified {
  const p = toRecord(input);
  if (!p.orderCode || !p.amount || !p.resultCode || !p.signature) return { ok: false, reason: 'malformed' };
  if (!safeEqualHex(hmacHex('sha256', secret, mockSignData(p)), p.signature)) return { ok: false, reason: 'invalid_signature' };
  const outcome: Outcome = p.resultCode === '00' ? 'succeeded' : p.resultCode === '24' ? 'cancelled' : 'failed';
  return { ok: true, result: { orderCode: p.orderCode, txnId: p.txnId || null, amountVnd: Number(p.amount), outcome, code: p.resultCode, message: p.message ?? '', raw: p } };
}

// ------------------------------------------------------------------ VNPay
export interface VnpayConfig { tmnCode: string; hashSecret: string; payUrl: string }
/** VNPay encodes like PHP urlencode: spaces as '+'. Keys sorted ascending. */
const vnpEncode = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
const vnpSignData = (p: Record<string, string>) =>
  Object.keys(p).filter((k) => k.startsWith('vnp_') && k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType' && p[k] !== '')
    .sort().map((k) => `${vnpEncode(k)}=${vnpEncode(p[k]!)}`).join('&');
const vnpDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14); // yyyyMMddHHmmss GMT+7

export function vnpayCheckoutUrl(cfg: VnpayConfig, o: { orderCode: string; amountVnd: number; info: string; returnUrl: string; ipAddr: string; locale: 'vi' | 'en'; createdAt: Date; expiresAt: Date }) {
  const p: Record<string, string> = {
    vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: cfg.tmnCode, vnp_Amount: String(o.amountVnd * 100), vnp_CurrCode: 'VND',
    vnp_TxnRef: o.orderCode, vnp_OrderInfo: o.info, vnp_OrderType: 'other', vnp_Locale: o.locale === 'en' ? 'en' : 'vn',
    vnp_ReturnUrl: o.returnUrl, vnp_IpAddr: o.ipAddr || '127.0.0.1', vnp_CreateDate: vnpDate(o.createdAt), vnp_ExpireDate: vnpDate(o.expiresAt),
  };
  const data = vnpSignData(p);
  return `${cfg.payUrl}?${data}&vnp_SecureHash=${hmacHex('sha512', cfg.hashSecret, data)}`;
}
export function vnpayVerify(cfg: VnpayConfig, query: Record<string, unknown>): Verified {
  const p = toRecord(query);
  if (!p.vnp_TxnRef || !p.vnp_Amount || !p.vnp_SecureHash) return { ok: false, reason: 'malformed' };
  if (!safeEqualHex(hmacHex('sha512', cfg.hashSecret, vnpSignData(p)), p.vnp_SecureHash)) return { ok: false, reason: 'invalid_signature' };
  const code = p.vnp_ResponseCode ?? '', status = p.vnp_TransactionStatus ?? code;
  const outcome: Outcome = code === '00' && status === '00' ? 'succeeded' : code === '24' ? 'cancelled' : 'failed';
  return { ok: true, result: { orderCode: p.vnp_TxnRef, txnId: p.vnp_TransactionNo && p.vnp_TransactionNo !== '0' ? p.vnp_TransactionNo : null, amountVnd: Math.round(Number(p.vnp_Amount) / 100), outcome, code, message: `vnpay ${code}/${status}`, raw: p } };
}
/** IPN reply body expected by VNPay. */
export const VNPAY_RSP = {
  ok: { RspCode: '00', Message: 'Confirm Success' }, notFound: { RspCode: '01', Message: 'Order not found' },
  alreadyConfirmed: { RspCode: '02', Message: 'Order already confirmed' }, badAmount: { RspCode: '04', Message: 'Invalid amount' },
  badSignature: { RspCode: '97', Message: 'Invalid signature' }, error: { RspCode: '99', Message: 'Unknown error' },
} as const;

// ------------------------------------------------------------------ MoMo
export interface MomoConfig { partnerCode: string; accessKey: string; secretKey: string; endpoint: string }
const MOMO_CREATE_FIELDS = ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType'] as const;
const MOMO_RESULT_FIELDS = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'] as const;
const momoRaw = (fields: readonly string[], p: Record<string, string>) => fields.map((k) => `${k}=${p[k] ?? ''}`).join('&');

export function momoCreateBody(cfg: MomoConfig, o: { orderCode: string; requestId: string; amountVnd: number; info: string; redirectUrl: string; ipnUrl: string; locale: 'vi' | 'en' }) {
  const p: Record<string, string> = {
    accessKey: cfg.accessKey, amount: String(o.amountVnd), extraData: '', ipnUrl: o.ipnUrl, orderId: o.orderCode, orderInfo: o.info,
    partnerCode: cfg.partnerCode, redirectUrl: o.redirectUrl, requestId: o.requestId, requestType: 'captureWallet',
  };
  const signature = hmacHex('sha256', cfg.secretKey, momoRaw(MOMO_CREATE_FIELDS, p));
  const { accessKey: _omit, ...body } = p;
  return { ...body, amount: o.amountVnd, lang: o.locale, signature };
}
export function momoVerify(cfg: MomoConfig, input: Record<string, unknown>): Verified {
  const p: Record<string, string> = { ...toRecord(input), accessKey: cfg.accessKey };
  if (!p.orderId || !p.amount || p.resultCode === '' || !p.signature) return { ok: false, reason: 'malformed' };
  if (p.partnerCode !== cfg.partnerCode) return { ok: false, reason: 'invalid_signature' };
  if (!safeEqualHex(hmacHex('sha256', cfg.secretKey, momoRaw(MOMO_RESULT_FIELDS, p)), p.signature)) return { ok: false, reason: 'invalid_signature' };
  const { accessKey: _omit, ...raw } = p;
  const outcome: Outcome = p.resultCode === '0' ? 'succeeded' : p.resultCode === '1006' ? 'cancelled' : 'failed';
  return { ok: true, result: { orderCode: p.orderId, txnId: p.transId && p.transId !== '0' ? p.transId : null, amountVnd: Number(p.amount), outcome, code: p.resultCode!, message: p.message ?? '', raw } };
}
/** Test helper / simulator: sign a MoMo result payload the way MoMo does. */
export function momoSignResult(cfg: MomoConfig, p: Record<string, string>) {
  return { ...p, signature: hmacHex('sha256', cfg.secretKey, momoRaw(MOMO_RESULT_FIELDS, { ...p, accessKey: cfg.accessKey })) };
}

/** Where the browser lands after paying. Never the dashboard when a talk is waiting. */
export function landingPath(p: { status: string; resumeSessionId: string | null; returnPath: string | null; paymentId: string }) {
  const q = `payment=${encodeURIComponent(p.status)}&paymentId=${encodeURIComponent(p.paymentId)}`;
  if (p.resumeSessionId) return `/app/sessions/${p.resumeSessionId}?${q}`;
  const base = p.returnPath && /^\/[^/\\]/.test(p.returnPath) ? p.returnPath : '/app/billing';
  return `${base}${base.includes('?') ? '&' : '?'}${q}`;
}
