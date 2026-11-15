import { z } from 'zod';
import { clamp } from './metrics.ts';

/** Chỉ số ngôn ngữ cơ thể do MediaPipe tính trên trình duyệt (src/client/body-language/tracker.ts). */
export const BodyMetricsSchema = z.object({
  version: z.literal(1),
  durationSec: z.number().min(1).max(3600),
  samples: z.number().int().min(1).max(100_000),
  eyeContactRatio: z.number().min(0).max(1),
  handsVisibleRatio: z.number().min(0).max(1),
  gestureRatePerMin: z.number().min(0).max(200),
  postureShiftsPerMin: z.number().min(0).max(120),
  avgShoulderTiltDeg: z.number().min(0).max(90),
  smileRatio: z.number().min(0).max(1),
  timeline: z.array(z.object({ t: z.number().min(0), eye: z.union([z.literal(0), z.literal(1)]), gesture: z.union([z.literal(0), z.literal(1)]) })).max(600).optional(),
});
export type BodyMetrics = z.infer<typeof BodyMetricsSchema>;

/** Điểm ngôn ngữ cơ thể và các ghi chú (mã) để giao diện hiển thị. */
export function bodyScores(b: BodyMetrics) {
  const eye = clamp(40 + b.eyeContactRatio * 70, 30, 98);
  const gesture = clamp(b.gestureRatePerMin >= 4 && b.gestureRatePerMin <= 15 ? 90 : b.gestureRatePerMin < 4 ? 60 + b.gestureRatePerMin * 7 : 90 - (b.gestureRatePerMin - 15) * 2, 35, 95);
  const posture = clamp(95 - Math.max(0, b.postureShiftsPerMin - 2) * 8 - Math.max(0, b.avgShoulderTiltDeg - 5) * 3, 35, 98);
  const expression = clamp(b.smileRatio >= 0.1 && b.smileRatio <= 0.5 ? 88 : b.smileRatio < 0.1 ? 60 + b.smileRatio * 250 : 80, 40, 95);
  const overall = Math.round(eye * 0.45 + gesture * 0.2 + posture * 0.2 + expression * 0.15);
  const notes: { code: string; data: Record<string, number> }[] = [];
  if (b.eyeContactRatio < 0.5) notes.push({ code: 'eye_low', data: { ratio: Math.round(b.eyeContactRatio * 100) } });
  if (b.gestureRatePerMin < 3) notes.push({ code: 'gesture_low', data: { perMin: b.gestureRatePerMin } });
  if (b.postureShiftsPerMin > 4) notes.push({ code: 'posture_sway', data: { perMin: b.postureShiftsPerMin } });
  if (b.smileRatio < 0.05) notes.push({ code: 'expression_flat', data: {} });
  return { eye, gesture, posture, expression, overall, notes };
}
