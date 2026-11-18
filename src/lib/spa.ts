import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/urls';

/** Frontend SPA routes (hash routing). Email links and OAuth land here via the /auth/* handlers. */
export const SPA = { login: '/#dang-nhap', onboarding: '/#thiet-lap-muc-tieu', resetPassword: '/#dat-lai-mat-khau', home: '/#tong-quan' } as const;

/** Where to send the browser after a successful auth link. `next` is the internal path the flow asked for. */
export function spaTarget(next: string, onboarded: boolean): string {
  if (next === '/reset-password') return SPA.resetPassword;
  if (!onboarded) return SPA.onboarding;
  return next === '/' || next === '/app' || next === '/onboarding' ? SPA.home : next;
}

/**
 * Luôn quay về trang web chính (NEXT_PUBLIC_SITE_URL), KHÔNG dùng origin của request: khi đi qua proxy Netlify,
 * request tới Vercel mang host của Vercel, nên redirect theo origin sẽ đưa người dùng sang bản cũ trên vercel.app,
 * nơi không có cookie đăng nhập (cookie được lưu cho tên miền Netlify) → bị đẩy về màn đăng nhập.
 * `_origin` giữ lại cho chữ ký cũ của các route.
 */
export const spaRedirect = (_origin: string, target: string) => NextResponse.redirect(appUrl(target));
export const spaError = (origin: string, code: string) => spaRedirect(origin, `${SPA.login}?error=${encodeURIComponent(code)}`);
