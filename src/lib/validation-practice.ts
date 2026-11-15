import { z } from 'zod';
import { zGoal, zLang } from '@/lib/validation';

/** Ngữ cảnh chung của một buổi luyện: mục tiêu đổi nhanh, ngôn ngữ bài nói, đề bài hoặc bài học. */
export const zPracticeContext = z.object({
  goal: zGoal.optional(),
  speakingLanguage: zLang.optional(),
  promptId: z.uuid().optional(),
  customTitle: z.string().trim().max(200).optional(),
  lessonSlug: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  isPlacement: z.boolean().optional(),
});
export const zUuid = z.uuid();
