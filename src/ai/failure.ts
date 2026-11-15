import 'server-only';
import type { Db } from '@/repositories/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { jobEvents } from '@/ai/events';
import { cleanupTemp } from '@/ai/providers/audio';

/** Phân loại lỗi cuối cùng của job (sau khi đã hết lượt thử lại). */
export function classifyFailure(error: unknown): { code: string; message: string; timedOut: boolean } {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/MAX_DURATION|maxDuration|TIMED_OUT|TIMEOUT/i.test(msg)) return { code: 'TIMEOUT', message: msg.slice(0, 500), timedOut: true };
  const code = (error as { code?: string })?.code ?? msg.match(/\b([A-Z][A-Z_]{3,})\b:/)?.[1] ?? 'ANALYSIS_FAILED';
  return { code, message: msg.slice(0, 500), timedOut: false };
}

/**
 * Đánh dấu thất bại hẳn: hoàn lượt đã giữ, lưu lỗi, xóa tệp tạm. Idempotent:
 * chỉ tác động khi bài còn ở queued/processing (gọi trùng từ onFailure + watchdog vẫn an toàn).
 */
export async function markFailed(sessionId: string, code: string, message: string, timedOut = false, db: Db = supabaseAdmin()) {
  const ev = jobEvents(db, sessionId);
  const { data: before } = await db.from('practice_sessions').select('user_id,status,credit_reserved').eq('id', sessionId).maybeSingle();
  if (!before || !['queued', 'processing'].includes(before.status)) return { changed: false };
  const { data: s } = await db.from('practice_sessions')
    .update({ status: 'failed', credit_reserved: false, last_error_code: code, last_error_message: message.slice(0, 500) })
    .eq('id', sessionId).in('status', ['queued', 'processing']).select('id,user_id').maybeSingle();
  if (!s) return { changed: false };   // một tiến trình khác đã xử lý trước
  const refunded = before.credit_reserved;
  if (refunded) await db.rpc('refund_analysis_credit', { p_user: s.user_id });
  await db.from('analysis_results').upsert({ session_id: sessionId, user_id: s.user_id, status: timedOut ? 'timed_out' : 'failed', error_code: code, error_message: message.slice(0, 500), finished_at: new Date().toISOString() }, { onConflict: 'session_id' });
  await cleanupTemp(db, s.user_id, sessionId).catch(() => undefined);
  await ev.error('failed', code, { message: message.slice(0, 300), timedOut, refunded });
  return { changed: true };
}
