import { z } from 'zod';

/** Biến dùng được cả ở client (NEXT_PUBLIC_*). SITE_URL không bắt buộc: thiếu thì dùng URL của Vercel (xem lib/urls.ts). */
const publicSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

/**
 * Biến chỉ có ở server. Kiểm tra lười (khi dùng lần đầu) để `next build` không cần khóa thật.
 * Dịch vụ bên ngoài (email, hàng đợi, thanh toán) đều KHÔNG bắt buộc: thiếu khóa → tự dùng chế độ mock.
 */
const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PUBLIC_API_URL: z.url().optional(),                         // URL nhận IPN/callback nếu khác SITE_URL
  EMAIL_PROVIDER: z.enum(['resend', 'mock']).optional(),       // bỏ trống: có RESEND_API_KEY + EMAIL_FROM thì resend, không thì mock
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),                           // "luyenthuyettrinh.com <no-reply@your-domain>"
  EMAIL_REPLY_TO: z.string().optional(),
  ANALYSIS_QUEUE: z.enum(['trigger', 'inline']).optional(),    // trống: có TRIGGER_SECRET_KEY → trigger, không thì inline (chạy ngay trong Next)
  TRIGGER_SECRET_KEY: z.string().optional(),
  STT_PROVIDER: z.enum(['groq', 'mock']).optional(),           // trống: có GROQ_API_KEY → groq, không thì mock
  GROQ_API_KEY: z.string().optional(),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  LLM_PROVIDER: z.enum(['deepseek', 'mock']).optional(),       // trống: có DEEPSEEK_API_KEY → deepseek, không thì mock
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  FFMPEG_PATH: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Payments. A gateway is enabled only when its credentials are present; mock is on unless disabled.
  PAYMENT_MOCK_ENABLED: z.enum(['true', 'false']).default('true'),
  MOCK_PAYMENT_SECRET: z.string().min(16).optional(),         // empty: derived from SUPABASE_SERVICE_ROLE_KEY
  PAYMENT_TTL_MIN: z.coerce.number().int().min(5).max(60).default(15),
  MOMO_PARTNER_CODE: z.string().optional(),
  MOMO_ACCESS_KEY: z.string().optional(),
  MOMO_SECRET_KEY: z.string().optional(),
  MOMO_ENDPOINT: z.url().default('https://test-payment.momo.vn/v2/gateway/api/create'),
  VNPAY_TMN_CODE: z.string().optional(),
  VNPAY_HASH_SECRET: z.string().optional(),
  VNPAY_PAYMENT_URL: z.url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
});

export const publicEnv = () =>
  publicSchema.parse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

let cached: z.infer<typeof serverSchema> | null = null;
export function serverEnv() {
  if (cached) return cached;
  const raw = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Thiếu hoặc sai biến môi trường: ${missing}. Xem .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
