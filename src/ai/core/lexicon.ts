import type { Lang } from './types.ts';

/** Từ đệm theo ngôn ngữ bài nói. Cụm nhiều từ được so khớp theo chuỗi từ liên tiếp. */
export const FILLERS: Record<Lang, { single: string[]; phrases: string[][] }> = {
  vi: { single: ['ừm', 'ưm', 'ừ', 'ờ', 'ơ', 'à', 'ầ', 'hmm', 'ừmm'], phrases: [['kiểu', 'như'], ['thì', 'là'], ['nói', 'chung', 'là'], ['đại', 'loại', 'là']] },
  en: { single: ['um', 'uh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm'], phrases: [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of']] },
};

/** Gợi ý cho Whisper giữ lại từ đệm (mặc định Whisper hay lược bỏ "ừm", "à"). */
export const STT_PROMPT: Record<Lang, string> = {
  vi: 'Ừm, à, ờ, thì là, kiểu như… Ghi lại đầy đủ cả các từ đệm và lặp từ như người nói thật.',
  en: 'Um, uh, like, you know… Transcribe every filler word and repetition exactly as spoken.',
};

export const norm = (w: string) => w.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}']+/gu, '');
