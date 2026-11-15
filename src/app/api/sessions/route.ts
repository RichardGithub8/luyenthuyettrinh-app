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
