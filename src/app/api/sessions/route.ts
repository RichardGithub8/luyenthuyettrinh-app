import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zPracticeContext } from '@/lib/validation-practice';
import { practiceService } from '@/services/practice.service';

const Input = zPracticeContext.extend({
  kind: z.enum(['audio', 'video']),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

/**
 * POST /api/sessions → 201 { session, upload: { bucket, path, token, signedUrl } }
 * Client tải tệp bằng supabase.storage.from(bucket).uploadToSignedUrl(path, token, file), rồi gọi upload-complete.
 */
export const POST = handler(async (req) => {
  const { user } = await requireUser();
  return ok(await practiceService.createUpload(supabaseAdmin(), user.id, await body(req, Input)), { status: 201 });
});

/** GET /api/sessions?limit= → { items } tóm tắt các buổi luyện đã chấm xong (mới nhất trước). */
export const GET = handler(async (req) => {
  const { user } = await requireUser();
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 100, 1), 200);
  return ok({ items: await practiceService.listCompleted(supabaseAdmin(), user.id, limit) });
});
