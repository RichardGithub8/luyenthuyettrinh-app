'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { zGoal, zLang } from '@/lib/validation';
import { profileService } from '@/services/profile.service';

/** Server Action: lưu mục tiêu mặc định + ngôn ngữ bài nói, rồi vào ứng dụng. */
export async function completeOnboarding(_: unknown, form: FormData) {
  const parsed = z.object({ defaultGoal: zGoal, speakingLanguage: zLang }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'Hãy chọn mục tiêu và ngôn ngữ bài nói.' };
  const { sb, user } = await requireUser();
  await profileService.completeOnboarding(sb, user.id, parsed.data);
  redirect('/app');
}
