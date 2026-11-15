import { z } from 'zod';

export const GOALS = ['presentation', 'reporting', 'interview', 'pitching', 'debating'] as const;
export const LANGS = ['vi', 'en'] as const;

export const zGoal = z.enum(GOALS);
export const zLang = z.enum(LANGS);
export const zEmail = z.string().trim().toLowerCase().pipe(z.email({ error: 'EMAIL_INVALID' }));
/** Chính sách mật khẩu: ≥ 8 ký tự, có chữ và số. Đặt trùng với cấu hình Supabase Auth. */
export const zPassword = z.string().min(8, { error: 'WEAK_PASSWORD' }).max(72, { error: 'WEAK_PASSWORD' })
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), { error: 'WEAK_PASSWORD' });

/** Chỉ cho phép đường dẫn nội bộ, chống open redirect (//evil.com, https://...). */
export const safeReturnPath = (p?: string | null, fallback = '/app') =>
  p && /^\/(?!\/)[^\s\\]*$/.test(p) ? p : fallback;
