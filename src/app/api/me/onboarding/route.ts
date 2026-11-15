import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { zGoal, zLang } from '@/lib/validation';
import { profileService } from '@/services/profile.service';

/** POST /api/me/onboarding { defaultGoal, speakingLanguage, uiLanguage? } → lưu mục tiêu mặc định, đánh dấu đã onboarding. */
export const POST = handler(async (req) => {
  const { sb, user } = await requireUser();
  const input = await body(req, z.object({ defaultGoal: zGoal, speakingLanguage: zLang, uiLanguage: zLang.optional() }));
  return ok(await profileService.completeOnboarding(sb, user.id, input));
});
