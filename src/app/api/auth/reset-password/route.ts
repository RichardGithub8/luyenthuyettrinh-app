import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { zPassword } from '@/lib/validation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

/** POST /api/auth/reset-password { password } → cần phiên khôi phục từ link email. */
export const POST = handler(async (req) => {
  const { password } = await body(req, z.object({ password: zPassword }));
  await authService.resetPassword(await createSupabaseServer(), password);
  return ok({ redirectTo: '/app' });
});
