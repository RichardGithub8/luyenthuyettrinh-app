import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';
import { profileService } from '@/services/profile.service';
import { safeReturnPath } from '@/lib/validation';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * GET /auth/callback?code=...&next=...
 * Điểm quay về chung cho: link xác thực email, link đặt lại mật khẩu, đăng nhập Google (PKCE).
 * Lỗi → về /login với mã lỗi để trang hiển thị thông báo rõ ràng.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  const next = safeReturnPath(searchParams.get('next'));
  const providerError = searchParams.get('error_code') ?? searchParams.get('error');
  if (providerError || !code) {
    logger.warn('auth callback without code', { providerError });
    const err = providerError === 'otp_expired' ? 'LINK_EXPIRED' : next.startsWith('/onboarding') ? 'LINK_EXPIRED' : 'OAUTH_FAILED';
    return NextResponse.redirect(`${origin}/login?error=${err}`);
  }
  try {
    const sb = await createSupabaseServer();
    const user = await authService.exchangeCode(sb, code);
    if (!user) throw new AppError('AUTH_FAILED');
    if (next === '/reset-password') return NextResponse.redirect(`${origin}/reset-password`);
    const me = await profileService.getMe(sb, user.id);
    return NextResponse.redirect(`${origin}${me.onboarded ? next : '/onboarding'}`);
  } catch (e) {
    const codeOut = e instanceof AppError ? e.code : 'AUTH_FAILED';
    logger.warn('auth callback failed', { code: codeOut });
    return NextResponse.redirect(`${origin}/login?error=${codeOut}`);
  }
}
