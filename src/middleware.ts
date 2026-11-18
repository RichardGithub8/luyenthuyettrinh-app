import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { siteUrl } from '@/lib/urls';

/** Đường dẫn trang web chính proxy sang backend (netlify.toml). Mọi trang khác thuộc về trang web chính. */
const BACKEND_PATHS = /^\/(api|auth|pay)\//;
/** Trang Next.js cũ → màn tương ứng của trang web chính (định tuyến bằng #). */
const LEGACY_PAGES: Record<string, string> = {
  '/login': '/#dang-nhap', '/register': '/#dang-ky', '/get-started': '/#bat-dau', '/forgot-password': '/#quen-mat-khau',
  '/reset-password': '/#dat-lai-mat-khau', '/verify-email': '/#dang-nhap', '/onboarding': '/#thiet-lap-muc-tieu',
  '/app': '/#tong-quan', '/app/billing': '/#goi-dich-vu',
};

/** API không cần đăng nhập. IPN thanh toán được xác thực bằng chữ ký riêng (Phase 4). */
const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/public\//, /^\/api\/payments\/(momo|vnpay|mock)\/(ipn|return)$/, /^\/api\/cron\//];
/** Trang cần đăng nhập. */
const PROTECTED = [/^\/app(\/|$)/, /^\/pay\//, /^\/onboarding(\/|$)/, /^\/reset-password$/];
/** Trang chỉ dành cho khách: đã đăng nhập thì chuyển vào ứng dụng. */
const GUEST_ONLY = new Set(['/login', '/register', '/forgot-password', '/get-started']);

const withCookies = (from: NextResponse, to: NextResponse) => { from.cookies.getAll().forEach((c) => to.cookies.set(c)); return to; };

export async function middleware(req: NextRequest) {
  // Giao diện chỉ sống ở trang web chính (Netlify). Mở trang trực tiếp trên tên miền backend (vd. vercel.app)
  // → chuyển hẳn sang trang chính, thay vì hiện bản giao diện cũ không có phiên đăng nhập.
  const site = new URL(siteUrl()), host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  if (!BACKEND_PATHS.test(req.nextUrl.pathname) && host !== site.host) {
    return NextResponse.redirect(`${site.origin}${LEGACY_PAGES[req.nextUrl.pathname] ?? (req.nextUrl.pathname.startsWith('/app/') ? '/#tong-quan' : '/')}`, 308);
  }
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|img/|css/|js/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
