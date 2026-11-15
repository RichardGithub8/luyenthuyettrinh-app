import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { libraryService } from '@/services/library.service';

/** GET /api/library/:id/media?download=1 → signed URL 5 phút để nghe/xem lại hoặc tải về. */
export const GET = handler<{ id: string }>(async (req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await libraryService.mediaUrl(supabaseAdmin(), user.id, parse(zUuid, id), req.nextUrl.searchParams.get('download') === '1'));
});

/** DELETE /api/library/:id/media → chỉ xóa video/âm thanh, GIỮ báo cáo và transcript. */
export const DELETE = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await libraryService.deleteMedia(supabaseAdmin(), user.id, parse(zUuid, id)));
});
