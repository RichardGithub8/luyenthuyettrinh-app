import { getAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { practiceService } from '@/services/practice.service';

export const dynamic = 'force-dynamic';
const BANNER: Record<string, string> = {
  succeeded: 'Thanh toán thành công — Premium đã bật, AI đang phân tích bài này. / Payment succeeded — analysing this talk now.',
  processing: 'Đang chờ xác nhận thanh toán… / Waiting for payment confirmation…',
  failed: 'Thanh toán thất bại. Bài vẫn được lưu, bạn có thể thử lại. / Payment failed. Your talk is saved; try again.',
  cancelled: 'Bạn đã hủy thanh toán. Bài vẫn được lưu. / Payment cancelled. Your talk is saved.',
  expired: 'Giao dịch hết hạn. / Payment expired.',
};

/** Demo talk page (the real UI is ported in a later phase). Auto-refreshes while analysis runs. */
export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const [{ id }, { payment }] = await Promise.all([params, searchParams]);
  const { user } = await getAuth();
  const s = await practiceService.get(supabaseAdmin(), user!.id, id).catch(() => null);
  if (!s) return <main className="wrap"><div className="card">Không tìm thấy bài. / Talk not found.</div></main>;
  const running = s.status === 'queued' || s.status === 'processing' || payment === 'processing';
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      {running && <meta httpEquiv="refresh" content="4" />}
      {payment && BANNER[payment] && <div className="alert">{BANNER[payment]}</div>}
      <div className="card"><h1>{s.title}</h1><p className="muted">Trạng thái / Status: <b>{s.status}</b></p><pre>{JSON.stringify(s, null, 2)}</pre></div>
    </main>
  );
}
