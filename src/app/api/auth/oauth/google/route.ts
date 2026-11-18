import { NextResponse } from 'next/server';
import { handler } from '@/lib/http';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';
import { siteUrl } from '@/lib/urls';

/** GET /api/auth/oauth/google?next=/app → 302 tới trang đăng nhập Google. */
export const GET = handler(async (req) => {
  // Bắt đầu trực tiếp trên tên miền Vercel (không qua trang web chính): chuyển sang trang web chính trước,
  // để cookie PKCE (code verifier) được lưu đúng tên miền mà Google sẽ quay về (/auth/callback trên trang chính).
  const site = new URL(siteUrl()), ref = req.headers.get('referer');
  if (ref && new URL(ref).host === req.nextUrl.host && req.nextUrl.host !== site.host) {
    return NextResponse.redirect(`${site.origin}${req.nextUrl.pathname}${req.nextUrl.search}`);
  }
  const url = await authService.googleSignInUrl(await createSupabaseServer(), req.nextUrl.searchParams.get('next') ?? '/app');
  return NextResponse.redirect(url);
});
