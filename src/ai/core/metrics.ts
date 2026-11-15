import { FILLERS, norm } from './lexicon.ts';
import type { Lang, Transcript, Word } from './types.ts';

export interface SpeechMetrics {
  durationSec: number; wordCount: number; wpmAvg: number; wpmPerMinute: number[];
  fillers: { text: string; start: number }[]; fillerCount: number; fillerPerMin: number;
  longPauses: { start: number; durationSec: number }[]; longPausePerMin: number; repetitions: number;
}
export const clamp = (v: number, lo = 0, hi = 100) => Math.round(Math.max(lo, Math.min(hi, v)));

/** Khi STT không trả mốc thời gian từng từ: chia đều thời gian của mỗi đoạn cho các từ trong đoạn. */
export function wordsFrom(t: Transcript): Word[] {
  if (t.words.length) return t.words;
  return t.segments.flatMap((s) => {
    const ws = s.text.split(/\s+/).filter(Boolean), step = (s.end - s.start) / Math.max(ws.length, 1);
    return ws.map((w, i) => ({ word: w, start: s.start + i * step, end: s.start + (i + 1) * step }));
  });
}

/** Chỉ số giọng nói đo bằng code (không dùng LLM): tốc độ theo phút, từ đệm, ngắt nghỉ dài, lặp từ. */
export function speechMetrics(t: Transcript, lang: Lang, longPauseSec = 2.5): SpeechMetrics {
  const words = wordsFrom(t), dur = Math.max(t.durationSec, words.at(-1)?.end ?? 0, 1), minutes = dur / 60;
  const n = words.map((w) => norm(w.word));
  const lex = FILLERS[lang];
  const fillers: { text: string; start: number }[] = [];
  for (let i = 0; i < n.length; i++) {
    const p = lex.phrases.find((ph) => ph.every((x, k) => n[i + k] === x));
    if (p) { fillers.push({ text: p.join(' '), start: words[i]!.start }); i += p.length - 1; continue; }
    if (lex.single.includes(n[i]!)) fillers.push({ text: n[i]!, start: words[i]!.start });
  }
  const longPauses: { start: number; durationSec: number }[] = [];
  let repetitions = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end;
    if (gap >= longPauseSec) longPauses.push({ start: Math.round(words[i - 1]!.end * 10) / 10, durationSec: Math.round(gap * 10) / 10 });
    if (n[i] && n[i] === n[i - 1] && !lex.single.includes(n[i]!)) repetitions++;
  }
  const buckets = Math.max(1, Math.ceil(dur / 60)), counts = new Array<number>(buckets).fill(0);
  words.forEach((w) => { counts[Math.min(buckets - 1, Math.floor(w.start / 60))]!++; });
  const lastLen = dur - (buckets - 1) * 60;
  const wpmPerMinute = counts.map((c, i) => Math.round(c / ((i === buckets - 1 ? Math.max(lastLen, 15) : 60) / 60)));
  return {
    durationSec: Math.round(dur * 10) / 10, wordCount: words.length, wpmAvg: Math.round(words.length / minutes), wpmPerMinute,
    fillers, fillerCount: fillers.length, fillerPerMin: Math.round(fillers.length / minutes * 10) / 10,
    longPauses, longPausePerMin: Math.round(longPauses.length / minutes * 10) / 10, repetitions,
  };
}

/** Điểm đo được (thang 100). Ngưỡng dễ nghe: 120–150 từ/phút. */
export function paceScore(m: SpeechMetrics) {
  const d = m.wpmAvg < 120 ? 120 - m.wpmAvg : m.wpmAvg > 150 ? m.wpmAvg - 150 : 0;
  const spikes = m.wpmPerMinute.filter((w) => w > 165 || w < 95).length;
  return clamp(95 - d * 1.2 - spikes * 3, 30, 98);
}
export const fillerScore = (m: SpeechMetrics) => clamp(95 - Math.max(0, m.fillerPerMin - 0.5) * 14, 30, 98);
export const fluencyScore = (m: SpeechMetrics) => clamp(92 - m.fillerPerMin * 6 - m.longPausePerMin * 8 - (m.repetitions / Math.max(m.durationSec / 60, 1)) * 5, 35, 98);

/** Ghi chú về cách nói (mã + số liệu) để giao diện dịch theo ngôn ngữ hiển thị. */
export function deliveryNotes(m: SpeechMetrics) {
  const notes: { code: string; data: Record<string, number> }[] = [];
  const fast = m.wpmPerMinute.findIndex((w) => w > 165), slow = m.wpmPerMinute.findIndex((w) => w < 95);
  if (m.wpmAvg > 150) notes.push({ code: 'pace_fast', data: { wpm: m.wpmAvg } });
  else if (m.wpmAvg < 120) notes.push({ code: 'pace_slow', data: { wpm: m.wpmAvg } });
  if (fast >= 0) notes.push({ code: 'pace_spike', data: { minute: fast + 1, wpm: m.wpmPerMinute[fast]! } });
  if (slow >= 0 && m.wpmPerMinute.length > 1) notes.push({ code: 'pace_drop', data: { minute: slow + 1, wpm: m.wpmPerMinute[slow]! } });
  if (m.fillerPerMin > 2) notes.push({ code: 'filler_high', data: { perMin: m.fillerPerMin, count: m.fillerCount } });
  if (m.longPausePerMin > 1.5) notes.push({ code: 'pauses_long', data: { count: m.longPauses.length } });
  return notes;
}

/** Thống kê kịch bản (đo bằng code). */
export function scriptStats(text: string, target: [number, number]) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const sentences = (text.match(/[^.!?…\n]+[.!?…]*/g) ?? []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 1);
  const wc = text.split(/\s+/).filter(Boolean).length, estSec = Math.round(wc / 130 * 60);
  const long = sentences.filter((s) => s.split(/\s+/).length > 30);
  const numbers = (text.match(/\d+([.,]\d+)?/g) ?? []).length;
  const [lo, hi] = target, diffMin = estSec < lo * 60 ? (lo * 60 - estSec) / 60 : estSec > hi * 60 ? (estSec - hi * 60) / 60 : 0;
  return {
    wordCount: wc, paragraphs: paras.length, sentences: sentences.length, estSec, numbers,
    longSentences: long.slice(0, 5).map((s) => ({ text: s, words: s.split(/\s+/).length })),
    lengthScore: clamp(92 - diffMin * 16, 35, 98), wordingScore: clamp(92 - long.length * 8, 35, 98),
  };
}
