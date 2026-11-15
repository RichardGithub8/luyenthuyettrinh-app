import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { zEmail, safeReturnPath } from '@/lib/validation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';
import { profileService } from '@/services/profile.service';

const Input = z.object({ email: zEmail, password: z.string().min(1).max(72), returnUrl: z.string().optional() });

/** POST /api/auth/login → { me, redirectTo }. Cookie phiên được đặt trên response. */
export const POST = handler(async (req) => {
  const { email, password, returnUrl } = await body(req, Input);
  const sb = await createSupabaseServer();
  const user = await authService.login(sb, email, password);
  const me = await profileService.getMe(sb, user.id);
  return ok({ me, redirectTo: me.onboarded ? safeReturnPath(returnUrl) : '/onboarding' });
});
