import type { LangCode } from '@/types/database';

/** Mẫu email song ngữ. Mỗi mẫu trả về subject + html + text (text cho trình đọc thư thuần và chống spam). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const layout = (title: string, body: string, cta?: { label: string; url: string }) => `<!doctype html><html><body style="margin:0;background:#F6F9FC;font-family:Lexend,Arial,sans-serif;color:#1F242E">
<div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #E8ECF3;border-radius:20px;padding:28px">
<div style="font-weight:700;color:#0060FD;margin-bottom:16px">luyenthuyettrinh.com</div><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${body}
${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta.url)}" style="background:#0060FD;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>` : ''}
</div><p style="font-size:12px;color:#8394AE;text-align:center;margin-top:16px">luyenthuyettrinh.com</p></div></body></html>`;
const fmtDate = (iso: string, lang: LangCode) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'long', year: 'numeric' });

export const templates = {
  /** Mẫu chung một đoạn văn + nút (vd. lời mời vào nhóm). */
  simple(title: string, text: string, cta?: { label: string; url: string }) {
    return layout(title, `<p>${esc(text)}</p>`, cta);
  },
  /** Nhắc trước khi tệp ghi âm/video bị xóa theo chính sách 30 ngày. */
  retentionWarning(p: { name: string; lang: LangCode; items: { title: string; expiresAt: string }[]; libraryUrl: string }) {
    const en = p.lang === 'en';
    const list = p.items.map((i) => `${i.title} (${fmtDate(i.expiresAt, p.lang)})`);
    const title = en ? 'Some recordings will be deleted soon' : 'Một số bản ghi sắp bị xóa';
    const intro = en
      ? `Hi ${p.name}, we keep original recordings for 30 days. These will be deleted soon. Your reports and transcripts stay.`
      : `Chào ${p.name}, bản ghi gốc được lưu tối đa 30 ngày. Các bản ghi sau sẽ sớm bị xóa. Báo cáo và bản chép lời vẫn được giữ.`;
    return {
      subject: title,
      html: layout(title, `<p>${esc(intro)}</p><ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p style="color:#566681;font-size:14px">${en ? 'Download anything you want to keep from your Library.' : 'Hãy tải về những bản bạn muốn giữ trong Thư viện.'}</p>`, { label: en ? 'Open library' : 'Mở thư viện', url: p.libraryUrl }),
      text: `${intro}\n\n${list.map((l) => '- ' + l).join('\n')}\n\n${p.libraryUrl}`,
    };
  },
  accountDeleted(p: { name: string; lang: LangCode }) {
    const en = p.lang === 'en';
    const title = en ? 'Your account has been deleted' : 'Tài khoản của bạn đã được xóa';
    const body = en ? `Hi ${p.name}, your account, recordings, reports and transcripts have been permanently deleted.` : `Chào ${p.name}, tài khoản cùng toàn bộ bản ghi, báo cáo và bản chép lời của bạn đã được xóa vĩnh viễn.`;
    return { subject: title, html: layout(title, `<p>${esc(body)}</p>`), text: body };
  },
};
