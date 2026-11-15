import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { practiceService } from '@/services/practice.service';

/** GET /api/sessions/:id → trạng thái buổi luyện (+ kết quả khi đã xong). Client poll hoặc dùng Realtime. */
export const GET = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await practiceService.get(supabaseAdmin(), user.id, parse(zUuid, id)));
});
