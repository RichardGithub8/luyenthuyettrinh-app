import { handler, body, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { BodyMetricsSchema } from '@/ai/core/body';
import { practiceService } from '@/services/practice.service';

/** POST /api/sessions/:id/body-metrics → chỉ số ngôn ngữ cơ thể do MediaPipe tính trên trình duyệt. */
export const POST = handler<{ id: string }>(async (req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await practiceService.saveBodyMetrics(supabaseAdmin(), user.id, parse(zUuid, id), await body(req, BodyMetricsSchema)));
});
