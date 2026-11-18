import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropSilence, isSilentSegment, tooLittleSpeech } from '../src/ai/core/silence.ts';

const seg = (text: string, start: number, end: number, extra = {}) => ({ text, start, end, no_speech_prob: 0, avg_logprob: -0.2, compression_ratio: 1.2, ...extra });

test('bỏ câu "subscribe kênh" Whisper bịa ra khi bản ghi chỉ có tiếng bíp (dữ liệu thật từ Groq)', () => {
  const raw = { text: ' Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn', duration: 2, language: 'vi',
    segments: [{ start: 0, end: 2, text: ' Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn', no_speech_prob: 0, avg_logprob: -0.098, compression_ratio: 0.89 }],
    words: [{ word: 'Hãy', start: 0, end: 0.2 }, { word: 'subscribe', start: 0.2, end: 0.6 }] };
  const { transcript, dropped } = dropSilence(raw, 'vi');
  assert.equal(dropped, 1);
  assert.equal(transcript.text, '');
  assert.equal(transcript.words.length, 0);
});
test('giữ lời nói thật, chỉ bỏ đoạn im lặng và từ nằm trong đoạn đó', () => {
  const raw = { text: '', duration: 10, language: 'vi',
    segments: [seg('Xin chào mọi người', 0, 3), seg('Thanks for watching!', 6, 8), seg('...', 8, 10, { no_speech_prob: 0.95 })],
    words: [{ word: 'Xin', start: 0, end: 0.5 }, { word: 'chào', start: 0.5, end: 1 }, { word: 'Thanks', start: 6, end: 6.5 }] };
  const { transcript, dropped } = dropSilence(raw, 'vi');
  assert.equal(dropped, 2);
  assert.equal(transcript.text, 'Xin chào mọi người');
  assert.deepEqual(transcript.words.map((w) => w.word), ['Xin', 'chào']);
});
test('không chặn lời cảm ơn bình thường cuối bài thuyết trình', () => {
  assert.equal(isSilentSegment(seg('Cảm ơn mọi người đã lắng nghe', 0, 2)), false);
  assert.equal(isSilentSegment(seg('Cảm ơn thầy cô và các bạn đã theo dõi', 0, 2)), false);
});
test('ngưỡng của Whisper: no_speech_prob cao + logprob thấp, hoặc lặp bất thường', () => {
  assert.equal(isSilentSegment(seg('ờ', 0, 1, { no_speech_prob: 0.7, avg_logprob: -1.2 })), true);
  assert.equal(isSilentSegment(seg('la la la la la la la la', 0, 1, { compression_ratio: 3 })), true);
});
test('quá ít lời so với thời lượng thì coi như không có giọng nói', () => {
  const W = (n: number) => Array.from({ length: n }, (_, i) => ({ word: 'từ', start: i, end: i + 0.3 }));
  const T = (n: number, dur: number) => ({ text: Array(n).fill('từ').join(' '), durationSec: dur, language: 'vi', segments: [], words: W(n) });
  assert.equal(tooLittleSpeech(T(5, 10), 10), true);       // dưới 10 từ
  assert.equal(tooLittleSpeech(T(15, 60), 10), true);      // 15 từ/phút
  assert.equal(tooLittleSpeech(T(120, 60), 10), false);    // bài nói bình thường
  assert.equal(tooLittleSpeech(T(12, 15), 10), false);     // bài ngắn dưới 20 giây vẫn được chấm
});
