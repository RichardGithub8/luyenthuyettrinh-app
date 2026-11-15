import 'server-only';
import { logger, maskEmail } from '@/lib/logger';

export interface OutgoingEmail { to: string; subject: string; html: string; text: string; template: string; tags?: Record<string, string> }
export interface EmailProvider { readonly name: 'resend' | 'mock'; send(m: OutgoingEmail): Promise<{ id: string }> }

/** Resend REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;
  constructor(private apiKey: string, private from: string, private replyTo?: string) {}
  async send(m: OutgoingEmail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
        ...(this.replyTo && { reply_to: this.replyTo }),
        tags: Object.entries({ template: m.template, ...m.tags }).map(([name, value]) => ({ name, value: value.replace(/[^a-zA-Z0-9_-]/g, '_') })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body?.message ?? JSON.stringify(body)}`);
    return { id: String(body.id) };
  }
}

/** Chế độ phát triển: không gửi gì ra ngoài, chỉ ghi log (và bảng email_messages) để kiểm thử luồng. */
export class MockProvider implements EmailProvider {
  readonly name = 'mock' as const;
  async send(m: OutgoingEmail) {
    const id = `mock_${crypto.randomUUID()}`;
    logger.info('email (mock)', { id, to: maskEmail(m.to), template: m.template, subject: m.subject, preview: m.text.slice(0, 200) });
    return { id };
  }
}
