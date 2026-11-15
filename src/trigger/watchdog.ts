import { schedules } from '@trigger.dev/sdk';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { markFailed } from '@/ai/failure';

/**
 * Mỗi 15 phút: bài kẹt ở queued/processing quá 45 phút (job mất, worker chết…) → đánh dấu quá hạn và hoàn lượt,
 * để người dùng thấy lỗi rõ ràng và bấm "Thử lại" thay vì chờ mãi.
 */
export const analysisWatchdog = schedules.task({
  id: 'analysis-watchdog',
  cron: '*/15 * * * *',
  run: async () => {
    const db = supabaseAdmin();
    const { data } = await db.from('practice_sessions').select('id').in('status', ['queued', 'processing'])
      .lt('updated_at', new Date(Date.now() - 45 * 60_000).toISOString()).limit(100);
    let failed = 0;
    for (const s of data ?? []) if ((await markFailed(s.id, 'TIMEOUT', 'watchdog: no progress for 45 minutes', true, db)).changed) failed++;
    return { checked: data?.length ?? 0, failed };
  },
});
