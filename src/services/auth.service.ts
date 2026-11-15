import 'server-only';
import type { AuthError, EmailOtpType, SupabaseClient } from '@supabase/supabase-js';
import type { Database, GoalType, LangCode } from '@/types/database';
import { AppError, type ErrorCode } from '@/lib/errors';
import { authCallbackUrl } from '@/lib/urls';
import { logger, maskEmail } from '@/lib/logger';
import { safeReturnPath } from '@/lib/validation';

type Db = SupabaseClient<Database>;
const log = logger.child({ module: 'auth' });
const callbackUrl = (next: string) => authCallbackUrl(safeReturnPath(next));

/** Đổi lỗi Supabase Auth sang mã lỗi của sản phẩm. */
export function mapAuthError(e: AuthError): AppError {
  const byCode: Record<string, ErrorCode> = {
    invalid_credentials: 'INVALID_CREDENTIALS', email_not_confirmed: 'EMAIL_NOT_CONFIRMED',
    user_already_exists: 'EMAIL_TAKEN', email_exists: 'EMAIL_TAKEN', weak_password: 'WEAK_PASSWORD', same_password: 'SAME_PASSWORD',
    otp_expired: 'LINK_EXPIRED', flow_state_expired: 'LINK_EXPIRED', flow_state_not_found: 'LINK_EXPIRED', bad_code_verifier: 'LINK_EXPIRED',
    over_email_send_rate_limit: 'RATE_LIMITED', over_request_rate_limit: 'RATE_LIMITED', over_sms_send_rate_limit: 'RATE_LIMITED',
    session_not_found: 'UNAUTHENTICATED', user_not_found: 'INVALID_CREDENTIALS',
  };
  const code = (e.code && byCode[e.code]) || (e.status === 429 ? 'RATE_LIMITED' : 'AUTH_FAILED');
  if (code === 'AUTH_FAILED') log.error('unmapped auth error', { code: e.code, status: e.status, message: e.message });
  return new AppError(code, undefined, e);
}

export interface RegisterInput { fullName: string; email: string; password: string; uiLanguage: LangCode; defaultGoal?: GoalType; speakingLanguage?: LangCode }

export const authService = {
  /** Đăng ký email + mật khẩu. Supabase gửi email xác thực; lựa chọn lúc "Bắt đầu" được lưu vào profile qua trigger. */
  async register(db: Db, i: RegisterInput) {
    const { data, error } = await db.auth.signUp({
      email: i.email, password: i.password,
      options: {
        emailRedirectTo: callbackUrl('/onboarding'),
        data: { full_name: i.fullName, ui_language: i.uiLanguage, default_goal: i.defaultGoal, speaking_language: i.speakingLanguage ?? i.uiLanguage },
      },
    });
    if (error) throw mapAuthError(error);
    // Supabase không báo lỗi khi email đã tồn tại (chống dò email) mà trả user không có identity.
    if (data.user && (data.user.identities?.length ?? 0) === 0) throw new AppError('EMAIL_TAKEN');
    log.info('registered', { email: maskEmail(i.email), needsVerification: !data.session });
    return { email: i.email, needsVerification: !data.session };
  },

  async login(db: Db, email: string, password: string) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw mapAuthError(error);
    log.info('login', { userId: data.user.id });
    return data.user;
  },

  async logout(db: Db) {
    const { error } = await db.auth.signOut();
    if (error && error.code !== 'session_not_found') throw mapAuthError(error);
  },

  async resendVerification(db: Db, email: string) {
    const { error } = await db.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl('/onboarding') } });
    if (error) throw mapAuthError(error);
  },

  /** Luôn trả thành công dù email có tồn tại hay không, để không lộ danh sách tài khoản. */
  async requestPasswordReset(db: Db, email: string) {
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/reset-password') });
    if (error && error.status === 429) throw mapAuthError(error);
    if (error) log.warn('reset email not sent', { email: maskEmail(email), code: error.code });
  },

  /** Đặt mật khẩu mới. Cần phiên khôi phục có được sau khi bấm link trong email. */
  async resetPassword(db: Db, password: string) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) throw new AppError('LINK_EXPIRED');
    const { error } = await db.auth.updateUser({ password });
    if (error) throw mapAuthError(error);
    log.info('password reset', { userId: user.id });
  },

  /** Đổi mật khẩu khi đang đăng nhập: xác nhận lại mật khẩu hiện tại trước. */
  async changePassword(db: Db, email: string, current: string, next: string) {
    const { error: verr } = await db.auth.signInWithPassword({ email, password: current });
    if (verr) throw mapAuthError(verr);
    const { error } = await db.auth.updateUser({ password: next });
    if (error) throw mapAuthError(error);
    log.info('password changed', { email: maskEmail(email) });
  },

  async googleSignInUrl(db: Db, next: string) {
    const { data, error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(next), skipBrowserRedirect: true } });
    if (error || !data.url) throw error ? mapAuthError(error) : new AppError('OAUTH_FAILED');
    return data.url;
  },

  /** Đổi mã (PKCE) lấy phiên: dùng cho link xác thực email, link đặt lại mật khẩu và đăng nhập Google. */
  async exchangeCode(db: Db, code: string) {
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (error) throw mapAuthError(error);
    return data.user;
  },

  /** Xác thực bằng token_hash (khi tùy biến mẫu email theo hướng dẫn SSR của Supabase). */
  async verifyOtp(db: Db, tokenHash: string, type: EmailOtpType) {
    const { data, error } = await db.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw mapAuthError(error);
    return data.user;
  },
};
