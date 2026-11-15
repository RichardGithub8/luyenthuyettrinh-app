import { z } from 'zod';
import { PipelineError, type Segment } from './types.ts';

/** Định dạng JSON bắt buộc LLM trả về. Điểm của tiêu chí đo bằng code (tốc độ, từ đệm, cơ thể) KHÔNG nằm ở đây. */
const Criterion = z.object({ score: z.number().min(0).max(100), reason: z.string().max(500) });
const Issue = z.object({
  category: z.enum(['content', 'structure', 'relevance', 'opening', 'closing', 'clarity', 'delivery']),
  title: z.string().min(1).max(140), detail: z.string().max(500), fix: z.string().max(500),
  quote: z.string().max(500).nullable().optional(), start_sec: z.number().min(0).nullable().optional(),
});
const Common = {
  summary: z.string().min(1).max(800),
  strengths: z.array(z.string().max(300)).max(3).default([]),
  issues: z.array(Issue).max(5).default([]),
  rewrites: z.array(z.object({ original: z.string().max(600), improved: z.string().max(600) })).max(3).default([]),
  audience_questions: z.array(z.string().max(300)).max(3).default([]),
};
export const SpeechScoringSchema = z.object({ ...Common, criteria: z.object({ content: Criterion, structure: Criterion, relevance: Criterion }) });
export const ScriptScoringSchema = z.object({ ...Common, criteria: z.object({ content: Criterion, structure: Criterion, relevance: Criterion, opening: Criterion, closing: Criterion }) });
export type SpeechScoring = z.infer<typeof SpeechScoringSchema>;
export type ScriptScoring = z.infer<typeof ScriptScoringSchema>;

/** Đọc JSON từ LLM: bỏ ```json, lấy object ngoài cùng, kiểm tra schema. Lỗi → PipelineError có thể thử lại (repair). */
export function parseLlmJson<S extends z.ZodType>(raw: string, schema: S): z.infer<S> {
  const s = raw.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new PipelineError('SCORING_INVALID', true, 'no JSON object in reply');
  let obj: unknown;
  try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new PipelineError('SCORING_INVALID', true, `JSON parse: ${String(e)}`); }
  const r = schema.safeParse(obj);
  if (!r.success) throw new PipelineError('SCORING_INVALID', true, r.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

const squash = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * Chống "bịa trích dẫn": quote phải nằm nguyên văn trong bài; nếu không thì bỏ quote.
 * Mốc thời gian lấy từ đoạn chứa quote (không tin số giây LLM tự đưa).
 */
export function groundIssues<T extends { issues: z.infer<typeof Issue>[]; rewrites: { original: string; improved: string }[] }>(out: T, fullText: string, segments: Segment[]): T {
  const hay = squash(fullText);
  const issues = out.issues.map((i) => {
    const q = i.quote ? squash(i.quote) : '';
    if (!q || !hay.includes(q)) return { ...i, quote: null, start_sec: null };
    const seg = segments.find((s) => squash(s.text).includes(q.slice(0, 40)));
    return { ...i, start_sec: seg ? seg.start : null };
  });
  const rewrites = out.rewrites.filter((r) => hay.includes(squash(r.original).slice(0, 60)));
  return { ...out, issues, rewrites };
}
