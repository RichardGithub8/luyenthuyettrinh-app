import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';
import { safeReturnPath } from '@/lib/validation';
import { AppError } from '@/lib/errors';
import { spaError, spaRedirect, spaTarget } from '@/lib/spa';
import { profileService } from '@/services/profile.service';

/** GET /auth/confirm?token_hash=...&type=signup|recovery|email_change&next=... (mẫu email tùy biến). */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (!tokenHash || !type) return spaError(origin, 'LINK_EXPIRED');
  try {
    const sb = await createSupabaseServer();
    const user = await authService.verifyOtp(sb, tokenHash, type);
    if (type === 'recovery') return spaRedirect(origin, spaTarget('/reset-password', true));
    const me = user ? await profileService.getMe(sb, user.id) : null;
    return spaRedirect(origin, spaTarget(safeReturnPath(searchParams.get('next'), '/onboarding'), !!me?.onboarded));
  } catch (e) {
    return spaError(origin, e instanceof AppError ? e.code : 'LINK_EXPIRED');
  }
}
