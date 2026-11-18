import type { Transcript } from './types';

/**
 * Lọc "ảo giác" của Whisper: khi bản ghi im lặng, chỉ có tiếng ồn/tiếng bíp, Whisper hay bịa ra câu kiểu
 * "Hãy subscribe cho kênh…" hoặc "Thanks for watching". Ta bỏ các đoạn (segment) mà chính Whisper đánh giá
 * là không có giọng nói, bị lặp bất thường, hoặc là câu "kênh YouTube" quen thuộc. Phần còn lại quá ngắn thì
 * pipeline báo NO_SPEECH (không trừ lượt).
 * Ngưỡng theo cách OpenAI dùng trong whisper: no_speech_prob > 0.6 và avg_logprob < -1 ⇒ im lặng.
 */
export interface RawSegment { start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number }
export interface RawWord { word: string; start: number; end: number }

/** Câu Whisper hay bịa khi không có lời (dữ liệu huấn luyện từ phụ đề YouTube). Chỉ giữ cụm đặc thù kênh video, không chặn lời cảm ơn bình thường. */
const HALLUCINATIONS = [
  /subscribe/i, /đăng ký kênh/i, /ghiền mì gõ/i, /la la school/i, /bỏ lỡ (những|các) video/i, /video hấp dẫn/i,
  /thanks? (you )?for watching/i, /like (and|và) share/i, /amara\.org/i, /subtitles? by/i, /phụ đề (bởi|được)/i,
];
export const isHallucinatedText = (t: string) => HALLUCINATIONS.some((re) => re.test(t));

export function isSilentSegment(s: RawSegment): boolean {
  const nsp = s.no_speech_prob ?? 0, lp = s.avg_logprob ?? 0;
  if (nsp > 0.6 && lp < -1) return true;
  if (nsp > 0.9) return true;
  if ((s.compression_ratio ?? 0) > 2.4) return true;          // lặp đi lặp lại một cụm
  return isHallucinatedText(s.text);
}

/** Trả transcript chỉ gồm phần có giọng nói thật, kèm số đoạn đã bỏ (để ghi log). */
export function dropSilence(raw: { text: string; duration: number; language: string; segments?: RawSegment[]; words?: RawWord[] }, fallbackLang: string): { transcript: Transcript; dropped: number } {
  const segs = (raw.segments ?? []).map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
  const words = (raw.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end })).filter((w) => w.word);
  const base = { durationSec: Number(raw.duration ?? 0), language: raw.language ?? fallbackLang };

  if (!segs.length) {   // không có thông tin đoạn: chỉ dựa vào nội dung chữ
    const bad = isHallucinatedText(raw.text ?? '');
    return { transcript: { ...base, text: bad ? '' : raw.text ?? '', segments: [], words: bad ? [] : words }, dropped: bad ? 1 : 0 };
  }
  const kept = segs.filter((s) => !isSilentSegment(s));
  const inKept = (w: RawWord) => { const mid = (w.start + w.end) / 2; return kept.some((s) => mid >= s.start - 0.2 && mid <= s.end + 0.2); };
  return {
    transcript: { ...base, text: kept.map((s) => s.text).join(' '), segments: kept.map((s) => ({ start: s.start, end: s.end, text: s.text })), words: words.filter(inKept) },
    dropped: segs.length - kept.length,
  };
}

/** Quá ít lời để chấm: dưới `minWords` từ, hoặc bài từ 20 giây trở lên mà dưới 20 từ/phút (bài nói thật thường 100–160). */
export function tooLittleSpeech(t: Transcript, minWords: number): boolean {
  const n = t.text.trim().split(/\s+/).filter(Boolean).length;
  if (t.words.length + t.segments.length === 0 || n < minWords) return true;
  return t.durationSec >= 20 && n / (t.durationSec / 60) < 20;
}
