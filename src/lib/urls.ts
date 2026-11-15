/**
 * Mọi URL tuyệt đối (link trong email, callback Auth, return/IPN thanh toán) đều dựng từ đây.
 * Không hardcode domain. Thứ tự ưu tiên:
 *   1. NEXT_PUBLIC_SITE_URL (domain chính thức khi có)
 *   2. VERCEL_PROJECT_PRODUCTION_URL (production trên Vercel)
 *   3. VERCEL_URL (preview deployment)
 *   4. http://localhost:3000
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL : process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}

/** URL công khai nhận IPN/callback từ bên thứ ba (mặc định = siteUrl). */
export const publicApiUrl = () => (process.env.PUBLIC_API_URL || siteUrl()).replace(/\/+$/, '');

export const appUrl = (path: string) => `${siteUrl()}${path.startsWith('/') ? path : '/' + path}`;
export const authCallbackUrl = (next: string) => appUrl(`/auth/callback?next=${encodeURIComponent(next)}`);
export const paymentReturnUrl = (provider: string, paymentId: string) => appUrl(`/api/payments/${provider}/return?paymentId=${encodeURIComponent(paymentId)}`);
export const paymentIpnUrl = (provider: string) => `${publicApiUrl()}/api/payments/${provider}/ipn`;
