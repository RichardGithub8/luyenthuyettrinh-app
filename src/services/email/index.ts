import 'server-only';
import { serverEnv } from '@/lib/env';
import { logger, maskEmail } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { MockProvider, ResendProvider, type EmailProvider, type OutgoingEmail } from './providers';

const log = logger.child({ module: 'email' });
let provider: EmailProvider | null = null;

/** Chọn nhà cung cấp: EMAIL_PROVIDER, hoặc tự động (có RESEND_API_KEY + EMAIL_FROM → Resend, không thì mock). */
export function emailProvider(): EmailProvider {
  if (provider) return provider;
  const env = serverEnv();
  const want = env.EMAIL_PROVIDER ?? (env.RESEND_API_KEY && env.EMAIL_FROM ? 'resend' : 'mock');
  if (want === 'resend' && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
    log.warn('EMAIL_PROVIDER=resend nhưng thiếu RESEND_API_KEY hoặc EMAIL_FROM → dùng mock');
    provider = new MockProvider();
  } else provider = want === 'resend' ? new ResendProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!, env.EMAIL_REPLY_TO) : new MockProvider();
  log.info('email provider', { provider: provider.name });
  return provider;
}

/**
 * Gửi email. KHÔNG BAO GIỜ ném lỗi ra ngoài: email hỏng không được làm gián đoạn nghiệp vụ chính
 * (xóa dữ liệu, thanh toán…). Kết quả được ghi vào email_messages để tra cứu.
 */
export async function sendEmail(m: OutgoingEmail & { userId?: string | null }): Promise<{ ok: boolean; id?: string }> {
  const p = emailProvider();
  let status: 'sent' | 'mocked' | 'failed' = p.name === 'mock' ? 'mocked' : 'sent', id: string | undefined, error: string | undefined;
  try { ({ id } = await p.send(m)); }
  catch (e) { status = 'failed'; error = e instanceof Error ? e.message : String(e); log.error('email failed', { to: maskEmail(m.to), template: m.template, error }); }
  try {
    await supabaseAdmin().from('email_messages').insert({ user_id: m.userId ?? null, to_email: m.to, template: m.template, subject: m.subject, provider: p.name, provider_message_id: id ?? null, status, error: error ?? null });
  } catch (e) { log.warn('email log insert failed', { error: String(e) }); }
  return { ok: status !== 'failed', id };
}
export { templates } from './templates';
