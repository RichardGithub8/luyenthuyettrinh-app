import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechMetrics, paceScore, fillerScore, scriptStats } from '../src/ai/core/metrics.ts';
import { bodyScores, BodyMetricsSchema } from '../src/ai/core/body.ts';
import { weightedOverall, SPEECH_WEIGHTS } from '../src/ai/core/rubric.ts';
import { parseLlmJson, SpeechScoringSchema, groundIssues } from '../src/ai/core/schema.ts';
import { buildSpeechMessages, buildScriptMessages, PROMPT_VERSION } from '../src/ai/core/prompts/scoring.v1.ts';
import { buildSpeechReport, buildScriptReport } from '../src/ai/core/report.ts';
import { mockTranscript, mockSpeechScoring, mockScriptScoring } from '../src/ai/core/mock.ts';
import type { Transcript } from '../src/ai/core/types.ts';

const persona = { name: 'Anh Minh', role: 'Nhà đầu tư thiên thần', focus: 'con số và lời kêu gọi', questions: ['Q1?', 'Q2?', 'Q3?'] };
const W = (word: string, start: number) => ({ word, start, end: start + 0.3 });

test('đếm từ đệm tiếng Việt, kể cả cụm "kiểu như"', () => {
  const t: Transcript = { text: '', durationSec: 10, language: 'vi', segments: [], words: [W('Ừm,', 0), W('em', 0.5), W('kiểu', 1), W('như', 1.4), W('là', 1.8), W('à', 2.2), W('ạ', 2.6)] };
  const m = speechMetrics(t, 'vi');
  assert.deepEqual(m.fillers.map((f) => f.text), ['ừm', 'kiểu như', 'à']);
});
test('đếm từ đệm tiếng Anh và ngắt nghỉ dài', () => {
  const t: Transcript = { text: '', durationSec: 20, language: 'en', segments: [], words: [W('Um', 0), W('so', 1), W('you', 1.5), W('know', 1.9), W('we', 8), W('grew', 8.4)] };
  const m = speechMetrics(t, 'en');
  assert.equal(m.fillerCount, 2);
  assert.equal(m.longPauses.length, 1);
  assert.equal(m.longPauses[0]!.start, 2.2);
});
test('tốc độ theo phút và điểm tốc độ', () => {
  const words = Array.from({ length: 270 }, (_, i) => W('từ', i * (120 / 270)));
  const m = speechMetrics({ text: '', durationSec: 120, language: 'vi', segments: [], words }, 'vi');
  assert.equal(m.wpmAvg, 135);
  assert.ok(paceScore(m) >= 90, 'trong vùng 120–150 → điểm cao');
  const fast = speechMetrics({ text: '', durationSec: 60, language: 'vi', segments: [], words: Array.from({ length: 200 }, (_, i) => W('từ', i * 0.3)) }, 'vi');
  assert.ok(paceScore(fast) < 60, '200 từ/phút → điểm thấp');
});
test('nhiều từ đệm → điểm từ đệm thấp', () => {
  const words = Array.from({ length: 60 }, (_, i) => W(i % 4 === 0 ? 'ừm' : 'nói', i));
  assert.ok(fillerScore(speechMetrics({ text: '', durationSec: 60, language: 'vi', segments: [], words }, 'vi')) < 40);
});
test('điểm ngôn ngữ cơ thể và ghi chú', () => {
  const b = BodyMetricsSchema.parse({ version: 1, durationSec: 120, samples: 600, eyeContactRatio: 0.38, handsVisibleRatio: 0.8, gestureRatePerMin: 6, postureShiftsPerMin: 5, avgShoulderTiltDeg: 3, smileRatio: 0.02 });
  const s = bodyScores(b);
  assert.ok(s.eye < 70 && s.gesture === 90);
  assert.deepEqual(s.notes.map((n) => n.code), ['eye_low', 'posture_sway', 'expression_flat']);
  assert.throws(() => BodyMetricsSchema.parse({ ...b, eyeContactRatio: 2 }));
});
test('thiếu điểm body thì chia lại trọng số', () => {
  const s = { content: 80, structure: 80, relevance: 80, pace: 80, fluency: 80, filler: 80, body: null };
  assert.equal(weightedOverall(s, SPEECH_WEIGHTS.pitching), 80);
});
test('đọc JSON từ LLM có ```json, báo lỗi khi sai schema', () => {
  const good = mockSpeechScoring({ transcript: mockTranscript('pitching', 'vi', 60), title: 'Gọi vốn', uiLang: 'vi', persona });
  assert.equal(parseLlmJson('```json\n' + JSON.stringify(good) + '\n```', SpeechScoringSchema).summary, good.summary);
  assert.throws(() => parseLlmJson('xin lỗi, tôi không thể', SpeechScoringSchema), /SCORING_INVALID|no JSON/);
  assert.throws(() => parseLlmJson(JSON.stringify({ ...good, criteria: { content: { score: 150, reason: '' } } }), SpeechScoringSchema));
});
test('bỏ trích dẫn bịa, lấy mốc thời gian từ đoạn thật', () => {
  const tr = mockTranscript('pitching', 'vi', 60);
  const out = groundIssues({ issues: [
    { category: 'opening' as const, title: 'a', detail: '', fix: '', quote: tr.segments[1]!.text, start_sec: 999 },
    { category: 'content' as const, title: 'b', detail: '', fix: '', quote: 'câu này không hề có trong bài', start_sec: 3 },
  ], rewrites: [{ original: 'không có', improved: 'x' }] }, tr.text, tr.segments);
  assert.equal(out.issues[0]!.start_sec, tr.segments[1]!.start);
  assert.equal(out.issues[1]!.quote, null);
  assert.equal(out.rewrites.length, 0);
});
test('prompt chứa đủ ngữ cảnh, bọc transcript làm dữ liệu', () => {
  const tr = mockTranscript('interview', 'en', 90);
  const msgs = buildSpeechMessages({ goalName: 'Interview', persona, title: 'Tell me about yourself', uiLang: 'vi', speechLang: 'en', segments: tr.segments, metrics: speechMetrics(tr, 'en'), body: null });
  assert.equal(msgs.length, 2);
  assert.match(msgs[0]!.content, /in Vietnamese/);
  assert.match(msgs[0]!.content, /written in English/);
  assert.match(msgs[1]!.content, /<transcript>[\s\S]*\[00:00\]/);
  assert.match(buildScriptMessages({ goalName: 'Pitch', persona, title: 't', uiLang: 'en', speechLang: 'vi', text: 'abc', stats: { wordCount: 1, estSec: 1, paragraphs: 1, numbers: 0 }, targetMin: [3, 5] })[0]!.content, /opening/);
  assert.equal(PROMPT_VERSION, 'scoring-v1');
});
test('toàn bộ đường xử lý bài nói với STT + LLM mô phỏng', () => {
  const tr = mockTranscript('pitching', 'vi', 200);
  const m = speechMetrics(tr, 'vi');
  assert.ok(m.wpmAvg > 110 && m.wpmAvg < 160, `wpm ${m.wpmAvg}`);
  const llm = parseLlmJson(JSON.stringify(mockSpeechScoring({ transcript: tr, title: 'Gọi vốn ứng dụng đặt sân', uiLang: 'vi', persona })), SpeechScoringSchema);
  const r = buildSpeechReport({ goal: 'pitching', uiLang: 'vi', transcript: tr, metrics: m, body: null, llm: groundIssues(llm, tr.text, tr.segments) });
  assert.ok(r.overall >= 40 && r.overall <= 95);
  assert.equal(r.criteria.body, null);
  assert.ok(r.feedback.issues.length >= 1 && r.feedback.issues.every((i) => i.quote === null || tr.text.includes(i.quote!)));
  assert.equal(r.feedback.audience_questions.length, 3);
});
test('đường xử lý kịch bản với LLM mô phỏng', () => {
  const text = 'Mỗi tuần sinh viên mất 40 phút để tìm sân trống.\n\nỨng dụng của chúng em giúp đặt sân trong 3 phút với 12 sân đối tác.\n\nChúng em cần 1,5 tỷ đồng để mở rộng ra 50 sân.';
  const stats = scriptStats(text, [3, 5]);
  const r = buildScriptReport({ uiLang: 'en', stats, llm: mockScriptScoring({ text, title: 'Pitch', uiLang: 'en', persona, target: [3, 5] }) });
  assert.ok(r.criteria.opening! >= 80 && r.criteria.closing! >= 80);
  assert.ok(r.criteria.length! < 70, 'quá ngắn so với 3–5 phút');
});
