import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { zEmail } from '@/lib/validation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

/** POST /api/auth/resend-verification { email } */
export const POST = handler(async (req) => {
  const { email } = await body(req, z.object({ email: zEmail }));
  await authService.resendVerification(await createSupabaseServer(), email);
  return ok({ sent: true });
});
