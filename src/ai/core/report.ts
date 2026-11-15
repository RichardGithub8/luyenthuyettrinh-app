import { bodyScores, type BodyMetrics } from './body.ts';
import { deliveryNotes, fillerScore, fluencyScore, paceScore, type SpeechMetrics, type scriptStats } from './metrics.ts';
import { SCRIPT_WEIGHTS, SPEECH_WEIGHTS, weightedOverall } from './rubric.ts';
import type { ScriptScoring, SpeechScoring } from './schema.ts';
import type { Goal, Lang, Transcript } from './types.ts';

const round = (n: number) => Math.round(n);

/** Gộp điểm đo bằng code + điểm LLM thành báo cáo lưu vào analysis_results. */
export function buildSpeechReport(i: { goal: Goal; uiLang: Lang; transcript: Transcript; metrics: SpeechMetrics; body: BodyMetrics | null; llm: SpeechScoring }) {
  const b = i.body ? bodyScores(i.body) : null;
  const criteria: Record<string, number | null> = {
    content: round(i.llm.criteria.content.score), structure: round(i.llm.criteria.structure.score), relevance: round(i.llm.criteria.relevance.score),
    pace: paceScore(i.metrics), fluency: fluencyScore(i.metrics), filler: fillerScore(i.metrics), body: b ? b.overall : null,
  };
  return {
    overall: weightedOverall(criteria, SPEECH_WEIGHTS[i.goal]),
    criteria,
    feedback: {
      lang: i.uiLang, summary: i.llm.summary, strengths: i.llm.strengths, issues: i.llm.issues, rewrites: i.llm.rewrites,
      audience_questions: i.llm.audience_questions,
      criteria_reasons: { content: i.llm.criteria.content.reason, structure: i.llm.criteria.structure.reason, relevance: i.llm.criteria.relevance.reason },
      delivery_notes: [...deliveryNotes(i.metrics), ...(b ? b.notes : i.body === null ? [] : [])],
    },
    speechMetrics: { ...i.metrics, fillers: i.metrics.fillers.slice(0, 300) },
    bodyMetrics: i.body && b ? { ...i.body, scores: { eye: b.eye, gesture: b.gesture, posture: b.posture, expression: b.expression } } : null,
    transcript: { language: i.transcript.language, segments: i.transcript.segments },
  };
}

export function buildScriptReport(i: { uiLang: Lang; stats: ReturnType<typeof scriptStats>; llm: ScriptScoring }) {
  const c = i.llm.criteria;
  const criteria: Record<string, number | null> = {
    content: round(c.content.score), structure: round(c.structure.score), relevance: round(c.relevance.score),
    opening: round(c.opening.score), closing: round(c.closing.score), length: i.stats.lengthScore, wording: i.stats.wordingScore,
  };
  return {
    overall: weightedOverall(criteria, SCRIPT_WEIGHTS),
    criteria,
    feedback: {
      lang: i.uiLang, summary: i.llm.summary, strengths: i.llm.strengths, issues: i.llm.issues, rewrites: i.llm.rewrites, audience_questions: i.llm.audience_questions,
      criteria_reasons: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.reason])),
      script_stats: i.stats,
    },
  };
}
