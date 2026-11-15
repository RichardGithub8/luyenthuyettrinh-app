import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { zGoal, zLang } from '@/lib/validation';
import { profileService } from '@/services/profile.service';

const Input = z.object({ uiLanguage: zLang.optional(), speakingLanguage: zLang.optional(), defaultGoal: zGoal.optional() })
  .refine((v) => Object.keys(v).length > 0, { error: 'EMPTY_PATCH' });

/** PATCH /api/me/preferences: ngôn ngữ giao diện, ngôn ngữ bài nói, mục tiêu mặc định (độc lập nhau). */
export const PATCH = handler(async (req) => {
  const { sb, user } = await requireUser();
  const me = await profileService.updatePreferences(sb, user.id, await body(req, Input));
  const res = ok(me);
  res.cookies.set('ui_lang', me.uiLanguage, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
});
