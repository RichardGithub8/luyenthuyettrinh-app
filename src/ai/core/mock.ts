/**
 * Nhà cung cấp mô phỏng khi chưa có GROQ_API_KEY / DEEPSEEK_API_KEY.
 * Kết quả xác định (deterministic) theo loại hình + ngôn ngữ, đi qua CÙNG đường xử lý như dịch vụ thật
 * (đo chỉ số, kiểm tra schema, gộp điểm), nên kiểm thử được toàn bộ pipeline mà không tốn phí.
 */
import { norm } from './lexicon.ts';
import { scriptStats } from './metrics.ts';
import type { ScriptScoring, SpeechScoring } from './schema.ts';
import type { Goal, Lang, Persona, Transcript } from './types.ts';

const SAMPLES: Record<Goal | 'placement', Record<Lang, string[]>> = {
  presentation: { vi: ['Xin chào thầy cô và các bạn, ừm, hôm nay em sẽ, à, trình bày về ứng dụng AI trong giáo dục.', 'Theo một khảo sát năm 2025, 68% sinh viên dùng AI để học ít nhất một lần mỗi tuần.', 'Lợi ích đầu tiên là cá nhân hóa lộ trình, phản hồi ngay và giảm tải cho giảng viên, cái này rất quan trọng vì giúp mọi người học nhanh hơn rất nhiều.', 'Vâng, ừm, phần trình bày của em đến đây là hết ạ.'], en: ['Hello everyone, um, today I am going to, uh, talk about AI in education.', 'A 2025 survey found that 68% of students use AI to study at least once a week.', 'The first benefit is personalised learning, instant feedback and less work for teachers, which is really important because it helps everyone learn much faster.', 'So, um, that is all from me, thank you.'] },
  reporting: { vi: ['Dạ, ừm, em xin báo cáo tiến độ dự án tuần này ạ.', 'Chúng ta đã hoàn thành 7 trên 10 hạng mục, đạt 70% kế hoạch.', 'Hạng mục thanh toán bị chậm vì kiểu như đối tác gửi tài liệu muộn, nên bên em chưa kiểm thử được và chắc là phải lùi thêm một tuần nữa.', 'À, em hết rồi ạ.'], en: ['Um, so this is the project update for this week.', 'We have finished 7 of 10 work items, which is 70% of the plan.', 'The payment module is late because the partner sent documents late, so we could not test it yet and we will probably need one more week.', 'Uh, that is it.'] },
  interview: { vi: ['Ừm, em chào anh, em tên là Lan Anh, em mới tốt nghiệp ngành Marketing.', 'Ở kỳ thực tập, em phụ trách fanpage và tăng lượng tương tác 45% trong 3 tháng.', 'Điểm yếu của em là ừm em hay cầu toàn, kiểu như làm gì cũng muốn hoàn hảo nên đôi khi bị chậm hạn chót.', 'Dạ, em nghĩ là vậy thôi ạ.'], en: ['Um, hi, my name is Lan Anh and I just graduated in Marketing.', 'During my internship I ran the fanpage and grew engagement by 45% in three months.', 'My weakness is, uh, I am a perfectionist, I want everything perfect so sometimes I miss deadlines.', 'Yeah, I think that is all.'] },
  pitching: { vi: ['Ừm, chào các anh chị, nhóm em làm ứng dụng đặt sân cầu lông.', 'Mỗi tuần một sinh viên mất 40 phút để gọi điện tìm sân trống.', 'Ứng dụng của tụi em giúp đặt sân trong 3 phút, đã có 12 sân và 850 người dùng thử, à, tỉ lệ quay lại là 46% cho thấy nhu cầu là có thật và rất là lớn.', 'Ừm, vậy thôi ạ, cảm ơn mọi người.'], en: ['Um, hi everyone, our team built a badminton court booking app.', 'Every week a student spends 40 minutes calling around for a free court.', 'Our app books a court in 3 minutes, we already have 12 courts and 850 trial users, uh, and a 46% return rate which shows the demand is real and really big.', 'Um, so that is it, thank you.'] },
  debating: { vi: ['Ừm, đội em ủng hộ việc cấm điện thoại trong lớp học.', 'Một nghiên cứu năm 2024 cho thấy điểm thi tăng 6% ở các trường đã cấm điện thoại.', 'Ngoài ra thì kiểu như học sinh cũng tập trung hơn, ít bị phân tâm hơn, và giáo viên cũng đỡ mệt hơn rất nhiều khi đứng lớp mỗi ngày.', 'À, đó là quan điểm của đội em.'], en: ['Um, our team supports banning phones in classrooms.', 'A 2024 study found test scores rose 6% in schools that banned phones.', 'Also students focus more, get distracted less, and teachers are a lot less tired after teaching every day.', 'Uh, that is our position.'] },
  placement: { vi: ['Dạ, ừm, em chào mọi người, em tên là Lan Anh, sinh viên năm hai ngành Quản trị kinh doanh.', 'Điều em tự hào nhất là dẫn dắt nhóm 5 người giành giải nhì cuộc thi khởi nghiệp của trường.', 'Thì kiểu như em hay bị run khi đứng trước đông người, nên em muốn luyện để tự tin hơn.', 'Ừm, em hết rồi ạ.'], en: ['Um, hello everyone, my name is Lan Anh and I am a second-year Business student.', 'What I am most proud of is leading a team of 5 to second place in our school startup contest.', 'I often get nervous in front of a crowd, so I want to practise to feel more confident.', 'Um, that is all.'] },
};

/** Bản chép lời mô phỏng ~135 từ/phút, lặp lại các câu mẫu cho đủ thời lượng. */
export function mockTranscript(goal: Goal, lang: Lang, durationSec: number, placement = false): Transcript {
  const sents = SAMPLES[placement ? 'placement' : goal][lang], target = Math.max(20, Math.round(durationSec / 60 * 135));
  const segments: Transcript['segments'] = [], words: Transcript['words'] = [];
  let t = 0.4, count = 0, k = 0;
  const step = (durationSec - 1) / target;
  while (count < target && t < durationSec - 0.5) {
    const s = sents[k % sents.length]!, ws = s.split(' '), start = t;
    ws.forEach((w) => { words.push({ word: w, start: t, end: t + step * 0.85 }); t += step; count++; });
    segments.push({ start: Math.round(start * 10) / 10, end: Math.round(t * 10) / 10, text: s });
    t += step * 1.5; k++;
  }
  return { text: segments.map((s) => s.text).join(' '), durationSec, language: lang, segments, words };
}

const L = (lang: Lang, vi: string, en: string) => (lang === 'en' ? en : vi);
const GREET = /^(dạ|xin chào|chào|um|uh|hello|hi|ừm)\b/i;

/** Chấm mô phỏng theo các dấu hiệu đơn giản trong văn bản (có số liệu, lời chào ở đầu, câu dài, kết đột ngột). */
function heuristics(text: string, first: string, last: string, title: string) {
  const numbers = (text.match(/\d+/g) ?? []).length;
  const longest = (text.match(/[^.!?]+[.!?]/g) ?? [text]).sort((a, b) => b.length - a.length)[0]!.trim();
  const kws = title.toLowerCase().split(/\s+/).map(norm).filter((w) => w.length > 3);
  const hits = kws.filter((w) => text.toLowerCase().includes(w)).length;
  return { numbers, longest, greet: GREET.test(first.trim()), weakEnd: /(hết|vậy thôi|that is all|that is it|thank you|cảm ơn)/i.test(last), relevance: kws.length ? hits / kws.length : 0.8 };
}

function common(lang: Lang, persona: Persona, text: string, first: string, last: string, title: string) {
  const h = heuristics(text, first, last, title);
  const issues: SpeechScoring['issues'] = [];
  if (h.greet) issues.push({ category: 'opening', title: L(lang, 'Mở bài chưa có câu thu hút', 'The opening has no hook'), detail: L(lang, 'Bài bắt đầu bằng lời chào và từ đệm, chưa cho người nghe lý do để chú ý.', 'You open with a greeting and fillers, giving no reason to listen.'), fix: L(lang, 'Mở bằng một con số hoặc câu hỏi liên quan trực tiếp tới người nghe.', 'Open with a number or a question that matters to the audience.'), quote: first });
  if (h.longest.split(/\s+/).length > 22) issues.push({ category: 'clarity', title: L(lang, 'Câu quá dài', 'Sentence too long'), detail: L(lang, 'Câu dài khiến người nghe khó theo kịp ý chính.', 'Long sentences make the key point hard to follow.'), fix: L(lang, 'Tách thành hai câu, mỗi câu một ý.', 'Split it into two sentences, one idea each.'), quote: h.longest });
  if (h.weakEnd) issues.push({ category: 'closing', title: L(lang, 'Kết bài chưa có thông điệp chốt', 'No key message at the end'), detail: L(lang, 'Bài kết thúc đột ngột, người nghe khó nhớ ý chính.', 'The talk ends abruptly, so the main point is easy to forget.'), fix: L(lang, 'Nhắc lại thông điệp chính và một việc người nghe nên làm.', 'Restate your key message and one next step for the audience.'), quote: last });
  return {
    h, issues,
    strengths: h.numbers ? [L(lang, 'Có số liệu cụ thể làm dẫn chứng.', 'You back your point with concrete numbers.')] : [],
    rewrites: h.longest.split(/\s+/).length > 22 ? [{ original: h.longest, improved: h.longest.split(',').slice(0, 2).join(',').trim().replace(/[,.]?$/, '.') }] : [],
    audience_questions: persona.questions.slice(0, 3),
    content: Math.min(92, 60 + h.numbers * 5), structure: 78 - (h.greet ? 8 : 0) - (h.weakEnd ? 8 : 0), relevance: Math.round(60 + h.relevance * 32),
  };
}

export function mockSpeechScoring(i: { transcript: Transcript; title: string; uiLang: Lang; persona: Persona }): SpeechScoring {
  const segs = i.transcript.segments, c = common(i.uiLang, i.persona, i.transcript.text, segs[0]?.text ?? '', segs.at(-1)?.text ?? '', i.title);
  return {
    summary: L(i.uiLang, `Bài có ý chính rõ${c.h.numbers ? ' và có số liệu' : ''}. Cần cải thiện mở bài và kết bài.`, `Your main point is clear${c.h.numbers ? ' and backed by data' : ''}. Work on your opening and closing.`),
    criteria: { content: { score: c.content, reason: L(i.uiLang, 'Đánh giá mô phỏng dựa trên số liệu và ví dụ trong bài.', 'Simulated score based on data and examples in the talk.') }, structure: { score: c.structure, reason: L(i.uiLang, 'Đánh giá mô phỏng dựa trên mở bài và kết bài.', 'Simulated score based on opening and closing.') }, relevance: { score: c.relevance, reason: L(i.uiLang, 'Đánh giá mô phỏng dựa trên mức độ nhắc tới chủ đề.', 'Simulated score based on topic coverage.') } },
    strengths: c.strengths, issues: c.issues.slice(0, 5), rewrites: c.rewrites, audience_questions: c.audience_questions,
  };
}

export function mockScriptScoring(i: { text: string; title: string; uiLang: Lang; persona: Persona; target: [number, number] }): ScriptScoring {
  const paras = i.text.split(/\n\s*\n/).filter(Boolean), c = common(i.uiLang, i.persona, i.text, paras[0] ?? '', paras.at(-1) ?? '', i.title);
  const st = scriptStats(i.text, i.target), r = (s: string) => ({ score: 0, reason: s });
  return {
    summary: L(i.uiLang, `Kịch bản ${st.wordCount} từ, khoảng ${Math.round(st.estSec / 60)} phút khi nói.`, `${st.wordCount}-word script, about ${Math.round(st.estSec / 60)} minutes spoken.`),
    criteria: {
      content: { ...r(L(i.uiLang, 'Đánh giá mô phỏng.', 'Simulated score.')), score: c.content }, structure: { ...r(L(i.uiLang, 'Đánh giá mô phỏng.', 'Simulated score.')), score: Math.min(92, c.structure + paras.length * 2) },
      relevance: { ...r(L(i.uiLang, 'Đánh giá mô phỏng.', 'Simulated score.')), score: c.relevance },
      opening: { ...r(L(i.uiLang, 'Câu đầu có số liệu hoặc câu hỏi thì được điểm cao.', 'A first line with a number or question scores higher.')), score: /\d|\?/.test(paras[0] ?? '') ? 86 : c.h.greet ? 55 : 68 },
      closing: { ...r(L(i.uiLang, 'Kết bài có lời kêu gọi thì được điểm cao.', 'A closing with a call to action scores higher.')), score: /(cần|đề xuất|hãy|raising|need|propose|join)/i.test(paras.at(-1) ?? '') ? 85 : 60 },
    },
    strengths: c.strengths, issues: c.issues.slice(0, 5), rewrites: c.rewrites, audience_questions: c.audience_questions,
  };
}
