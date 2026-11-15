import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';
import { safeReturnPath } from '@/lib/validation';
import { AppError } from '@/lib/errors';

/** GET /auth/confirm?token_hash=...&type=signup|recovery|email_change&next=... (mẫu email tùy biến). */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  if (!tokenHash || !type) return NextResponse.redirect(`${origin}/login?error=LINK_EXPIRED`);
  try {
    await authService.verifyOtp(await createSupabaseServer(), tokenHash, type);
    return NextResponse.redirect(`${origin}${type === 'recovery' ? '/reset-password' : safeReturnPath(searchParams.get('next'), '/onboarding')}`);
  } catch (e) {
    return NextResponse.redirect(`${origin}/login?error=${e instanceof AppError ? e.code : 'LINK_EXPIRED'}`);
  }
}
