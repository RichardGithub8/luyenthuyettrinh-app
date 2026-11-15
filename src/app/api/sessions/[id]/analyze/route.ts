import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { practiceService } from '@/services/practice.service';

/** POST /api/sessions/:id/analyze → phân tích bài đang chờ (sau nâng cấp, tháng mới) hoặc chạy lại khi lỗi. */
export const POST = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await practiceService.requestAnalysis(supabaseAdmin(), user.id, parse(zUuid, id)));
});

/** Hàng đợi inline chạy phân tích sau response (after()) trong cùng function. */
export const maxDuration = 300;
