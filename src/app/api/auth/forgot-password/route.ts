import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { zEmail } from '@/lib/validation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

/** POST /api/auth/forgot-password { email } → luôn 200 (không lộ email nào đã đăng ký). */
export const POST = handler(async (req) => {
  const { email } = await body(req, z.object({ email: zEmail }));
  await authService.requestPasswordReset(await createSupabaseServer(), email);
  return ok({ sent: true });
});
