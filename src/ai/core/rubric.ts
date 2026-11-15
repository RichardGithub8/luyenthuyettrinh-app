import type { Goal } from './types.ts';

/** Trọng số chấm theo loại hình. Tiêu chí thiếu dữ liệu (vd. body với bài âm thanh) được bỏ ra và chia lại trọng số. */
export const SPEECH_WEIGHTS: Record<Goal, Record<string, number>> = {
  presentation: { content: 0.2, structure: 0.25, relevance: 0.1, pace: 0.15, fluency: 0.1, filler: 0.1, body: 0.1 },
  reporting:    { content: 0.25, structure: 0.25, relevance: 0.15, pace: 0.1, fluency: 0.1, filler: 0.1, body: 0.05 },
  interview:    { content: 0.2, structure: 0.2, relevance: 0.15, pace: 0.1, fluency: 0.15, filler: 0.1, body: 0.1 },
  pitching:     { content: 0.3, structure: 0.2, relevance: 0.1, pace: 0.1, fluency: 0.1, filler: 0.1, body: 0.1 },
  debating:     { content: 0.3, structure: 0.25, relevance: 0.1, pace: 0.1, fluency: 0.1, filler: 0.1, body: 0.05 },
};
export const SCRIPT_WEIGHTS: Record<string, number> = { content: 0.25, structure: 0.2, relevance: 0.15, opening: 0.1, closing: 0.1, length: 0.1, wording: 0.1 };
export const GOAL_TARGET_MIN: Record<Goal, [number, number]> = { presentation: [3, 7], reporting: [2, 5], interview: [1, 3], pitching: [3, 5], debating: [2, 4] };

export function weightedOverall(scores: Record<string, number | null | undefined>, weights: Record<string, number>) {
  let sum = 0, w = 0;
  for (const [k, wt] of Object.entries(weights)) { const s = scores[k]; if (s != null) { sum += s * wt; w += wt; } }
  return w ? Math.round(sum / w) : 0;
}
