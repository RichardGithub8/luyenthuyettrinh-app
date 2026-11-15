import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { paymentService } from '@/services/payment.service';

export const dynamic = 'force-dynamic';
const vnd = (n: number) => n.toLocaleString('vi-VN') + ' ₫';

/** Mock gateway checkout (stands in for the MoMo/VNPay page until sandbox credentials exist). */
export default async function MockCheckout({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const { user } = await getAuth();
  if (!user) redirect(`/login?returnUrl=/pay/mock/${paymentId}`);
  const p = await paymentService.get(supabaseAdmin(), user.id, paymentId).catch(() => null);
  if (!p) redirect('/app/billing?payment=invalid');
  if (p.status !== 'pending') redirect(p.landingPath);
  const btn = (outcome: string, label: string, bg: string) => (
    <button name="outcome" value={outcome} style={{ background: bg, color: '#fff', border: 0, borderRadius: 10, padding: '12px 16px', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
  );
  return (
    <main className="wrap" style={{ maxWidth: 440 }}><div className="card">
      <p className="muted" style={{ fontSize: 12, letterSpacing: 1 }}>CỔNG THANH TOÁN MÔ PHỎNG · MOCK GATEWAY</p>
      <h1 style={{ margin: '8px 0' }}>{vnd(p.amountVnd)}</h1>
      <p>Premium · {p.cycle === 'yearly' ? 'Theo năm / Yearly' : 'Theo tháng / Monthly'}</p>
      <p className="muted">Mã đơn / Order: {p.orderCode}<br />Hết hạn / Expires: {new Date(p.expiresAt).toLocaleTimeString('vi-VN')}</p>
      <form method="post" action="/api/payments/mock/simulate" style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <input type="hidden" name="paymentId" value={p.id} />
        {btn('succeeded', 'Thanh toán thành công / Pay', '#0060FD')}
        {btn('failed', 'Thanh toán thất bại / Fail', '#B42318')}
        {btn('cancelled', 'Hủy / Cancel', '#555')}
      </form>
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Không có tiền thật nào được trừ. No real money is charged.</p>
    </div></main>
  );
}
