import { NextResponse } from 'next/server';

/** Frontend SPA routes (hash routing). Email links and OAuth land here via the /auth/* handlers. */
export const SPA = { login: '/#dang-nhap', onboarding: '/#thiet-lap-muc-tieu', resetPassword: '/#dat-lai-mat-khau', home: '/#tong-quan' } as const;

/** Where to send the browser after a successful auth link. `next` is the internal path the flow asked for. */
export function spaTarget(next: string, onboarded: boolean): string {
  if (next === '/reset-password') return SPA.resetPassword;
  if (!onboarded) return SPA.onboarding;
  return next === '/' || next === '/app' || next === '/onboarding' ? SPA.home : next;
}

export const spaRedirect = (origin: string, target: string) => NextResponse.redirect(`${origin}${target}`);
export const spaError = (origin: string, code: string) => spaRedirect(origin, `${SPA.login}?error=${encodeURIComponent(code)}`);
