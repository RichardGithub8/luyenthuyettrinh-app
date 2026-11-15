import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zPracticeContext } from '@/lib/validation-practice';
import { practiceService } from '@/services/practice.service';

const Input = zPracticeContext.omit({ isPlacement: true }).extend({ text: z.string().max(50_000) });

/** POST /api/sessions/script { text, ... } → 201 session (queued hoặc pending_quota). */
export const POST = handler(async (req) => {
  const { user } = await requireUser();
  return ok(await practiceService.submitScript(supabaseAdmin(), user.id, await body(req, Input)), { status: 201 });
});

/** Hàng đợi inline chạy phân tích sau response (after()) trong cùng function. */
export const maxDuration = 300;
