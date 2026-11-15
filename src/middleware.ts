import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/** API không cần đăng nhập. IPN thanh toán được xác thực bằng chữ ký riêng (Phase 4). */
const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/public\//, /^\/api\/payments\/(momo|vnpay|mock)\/(ipn|return)$/, /^\/api\/cron\//];
/** Trang cần đăng nhập. */
const PROTECTED = [/^\/app(\/|$)/, /^\/pay\//, /^\/onboarding(\/|$)/, /^\/reset-password$/];
/** Trang chỉ dành cho khách: đã đăng nhập thì chuyển vào ứng dụng. */
const GUEST_ONLY = new Set(['/', '/login', '/register', '/forgot-password', '/get-started']);

const withCookies = (from: NextResponse, to: NextResponse) => { from.cookies.getAll().forEach((c) => to.cookies.set(c)); return to; };

export async function middleware(req: NextRequest) {
  const { response, user } = await updateSession(req);
  const path = req.nextUrl.pathname;

  if (path.startsWith('/api/')) {
    if (!user && !PUBLIC_API.some((r) => r.test(path))) {
      const en = (req.headers.get('x-ui-language') ?? req.cookies.get('ui_lang')?.value ?? req.headers.get('accept-language') ?? '').toLowerCase().startsWith('en');
      return withCookies(response, NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: en ? 'Please log in to continue.' : 'Bạn cần đăng nhập để tiếp tục.' } }, { status: 401 }));
    }
    return response;
  }
  if (!user && PROTECTED.some((r) => r.test(path))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?returnUrl=${encodeURIComponent(path + req.nextUrl.search)}`;
    return withCookies(response, NextResponse.redirect(url));
  }
  if (user && GUEST_ONLY.has(path)) {
    const url = req.nextUrl.clone(); url.pathname = '/app'; url.search = '';
    return withCookies(response, NextResponse.redirect(url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|img/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
