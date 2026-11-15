import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { zEmail, zPassword, zGoal, zLang } from '@/lib/validation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

const Input = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: zEmail,
  password: zPassword,
  uiLanguage: zLang.default('vi'),
  defaultGoal: zGoal.optional(),
  speakingLanguage: zLang.optional(),
});

/** POST /api/auth/register → 201 { email, needsVerification } */
export const POST = handler(async (req) => {
  const input = await body(req, Input);
  const result = await authService.register(await createSupabaseServer(), input);
  return ok(result, { status: 201 });
});
