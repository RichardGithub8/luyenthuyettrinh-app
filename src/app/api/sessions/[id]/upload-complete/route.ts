import { z } from 'zod';
import { handler, body, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { practiceService } from '@/services/practice.service';

/** POST /api/sessions/:id/upload-complete { durationSec } → áp quy tắc > 5 phút / lượt, trả trạng thái mới. Gọi lại an toàn. */
export const POST = handler<{ id: string }>(async (req, _ctx, { id }) => {
  const { user } = await requireUser();
  const { durationSec } = await body(req, z.object({ durationSec: z.number().positive().max(36_000) }));
  return ok(await practiceService.completeUpload(supabaseAdmin(), user.id, parse(zUuid, id), durationSec));
});

/** Hàng đợi inline chạy phân tích sau response (after()) trong cùng function. */
export const maxDuration = 300;
