import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { libraryService } from '@/services/library.service';

/** GET /api/library/:id → chi tiết (gồm nội dung kịch bản). */
export const GET = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await libraryService.get(supabaseAdmin(), user.id, parse(zUuid, id)));
});

/** DELETE /api/library/:id → xóa hẳn bài: tệp, buổi luyện, báo cáo. */
export const DELETE = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await libraryService.deleteItem(supabaseAdmin(), user.id, parse(zUuid, id)));
});
