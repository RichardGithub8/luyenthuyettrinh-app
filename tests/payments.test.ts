import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingPath, mockSign, mockVerify, momoCreateBody, momoSignResult, momoVerify, newOrderCode, vnpayCheckoutUrl, vnpayVerify, hmacHex } from '../src/payments/core.ts';

const SECRET = 'test-secret-0123456789';

test('mock: signed payload verifies; tampered amount is rejected', () => {
  const p = mockSign(SECRET, { orderCode: 'LTT1', txnId: 'M1', amount: 149000, outcome: 'succeeded' });
  const v = mockVerify(SECRET, p);
  assert.ok(v.ok && v.result.outcome === 'succeeded' && v.result.amountVnd === 149000);
  assert.deepEqual(mockVerify(SECRET, { ...p, amount: '1000' }), { ok: false, reason: 'invalid_signature' });
  assert.deepEqual(mockVerify('other-secret-xxxxxxxx', p), { ok: false, reason: 'invalid_signature' });
});

test('mock: cancel and fail outcomes', () => {
  const c = mockVerify(SECRET, mockSign(SECRET, { orderCode: 'A', txnId: 'B', amount: 1, outcome: 'cancelled' }));
  const f = mockVerify(SECRET, mockSign(SECRET, { orderCode: 'A', txnId: 'B', amount: 1, outcome: 'failed' }));
  assert.ok(c.ok && c.result.outcome === 'cancelled' && f.ok && f.result.outcome === 'failed');
});

const vcfg = { tmnCode: 'TMN01', hashSecret: 'VNPAYSECRET', payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html' };
test('vnpay: checkout URL is signed over sorted params (amount x100, GMT+7 dates)', () => {
  const url = new URL(vnpayCheckoutUrl(vcfg, { orderCode: 'LTT9', amountVnd: 149000, info: 'Premium monthly', returnUrl: 'https://x.app/r?a=1', ipAddr: '1.2.3.4', locale: 'vi', createdAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2026-01-01T00:15:00Z') }));
  const q = Object.fromEntries(url.searchParams);
  assert.equal(q.vnp_Amount, '14900000');
  assert.equal(q.vnp_CreateDate, '20260101070000');
  assert.equal(q.vnp_Locale, 'vn');
  const raw = url.search.slice(1).split('&vnp_SecureHash=')[0]!;
  assert.equal(q.vnp_SecureHash, hmacHex('sha512', vcfg.hashSecret, raw));
  assert.ok(raw.includes('vnp_OrderInfo=Premium+monthly'));
});

test('vnpay: IPN round-trip, outcome mapping, tamper detection', () => {
  const ipn: Record<string, string> = { vnp_TmnCode: 'TMN01', vnp_Amount: '14900000', vnp_TxnRef: 'LTT9', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '1400', vnp_OrderInfo: 'Premium monthly' };
  const sign = (p: Record<string, string>) => {
    const data = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k]!).replace(/%20/g, '+')}`).join('&');
    return { ...p, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: hmacHex('sha512', vcfg.hashSecret, data) };
  };
  const v = vnpayVerify(vcfg, sign(ipn));
  assert.ok(v.ok && v.result.outcome === 'succeeded' && v.result.amountVnd === 149000 && v.result.txnId === '1400');
  const c = vnpayVerify(vcfg, sign({ ...ipn, vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' }));
  assert.ok(c.ok && c.result.outcome === 'cancelled' && c.result.txnId === null);
  assert.deepEqual(vnpayVerify(vcfg, { ...sign(ipn), vnp_Amount: '100' }), { ok: false, reason: 'invalid_signature' });
});

const mcfg = { partnerCode: 'MOMOX', accessKey: 'AK', secretKey: 'SK', endpoint: 'https://test-payment.momo.vn/v2/gateway/api/create' };
test('momo: create body signature matches the documented raw string; accessKey not sent', () => {
  const b = momoCreateBody(mcfg, { orderCode: 'LTT7', requestId: 'r1', amountVnd: 149000, info: 'Premium', redirectUrl: 'https://x/r', ipnUrl: 'https://x/i', locale: 'vi' });
  const raw = 'accessKey=AK&amount=149000&extraData=&ipnUrl=https://x/i&orderId=LTT7&orderInfo=Premium&partnerCode=MOMOX&redirectUrl=https://x/r&requestId=r1&requestType=captureWallet';
  assert.equal(b.signature, hmacHex('sha256', 'SK', raw));
  assert.equal((b as Record<string, unknown>).accessKey, undefined);
  assert.equal(b.amount, 149000);
});

test('momo: IPN verify + outcome mapping + wrong partner rejected', () => {
  const base = { partnerCode: 'MOMOX', orderId: 'LTT7', requestId: 'r1', amount: '149000', orderInfo: 'Premium', orderType: 'momo_wallet', transId: '999', resultCode: '0', message: 'ok', payType: 'qr', responseTime: '1', extraData: '' };
  const v = momoVerify(mcfg, momoSignResult(mcfg, base));
  assert.ok(v.ok && v.result.outcome === 'succeeded' && v.result.txnId === '999');
  const c = momoVerify(mcfg, momoSignResult(mcfg, { ...base, resultCode: '1006' }));
  assert.ok(c.ok && c.result.outcome === 'cancelled');
  assert.deepEqual(momoVerify(mcfg, { ...momoSignResult(mcfg, base), amount: '1' }), { ok: false, reason: 'invalid_signature' });
  assert.deepEqual(momoVerify(mcfg, momoSignResult(mcfg, { ...base, partnerCode: 'EVIL' })), { ok: false, reason: 'invalid_signature' });
});

test('order code: LTT + yyMMddHHmmss (GMT+7) + 6 chars, alphanumeric', () => {
  const c = newOrderCode(new Date('2026-11-08T03:04:05Z'), () => 0);
  assert.equal(c, 'LTT261108100405AAAAAA');
  assert.match(newOrderCode(), /^LTT\d{12}[A-Z2-9]{6}$/);
});

test('landing: waiting talk wins over return path; never the dashboard', () => {
  assert.equal(landingPath({ status: 'succeeded', resumeSessionId: 's1', returnPath: '/app', paymentId: 'p' }), '/app/sessions/s1?payment=succeeded&paymentId=p');
  assert.equal(landingPath({ status: 'failed', resumeSessionId: null, returnPath: '/app/pricing?x=1', paymentId: 'p' }), '/app/pricing?x=1&payment=failed&paymentId=p');
  assert.equal(landingPath({ status: 'succeeded', resumeSessionId: null, returnPath: '//evil.com', paymentId: 'p' }), '/app/billing?payment=succeeded&paymentId=p');
});
