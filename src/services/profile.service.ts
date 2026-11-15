import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ProfileRow, GoalType, LangCode } from '@/types/database';
import { PLANS, type PlanKey } from '@/config/plans';
import { AppError } from '@/lib/errors';
import { profileRepository, usagePeriod } from '@/repositories/profile.repository';

type Db = SupabaseClient<Database>;

export const isPremium = (p: Pick<ProfileRow, 'plan' | 'premium_expires_at'>, now = Date.now()) =>
  p.plan === 'premium' && !!p.premium_expires_at && new Date(p.premium_expires_at).getTime() > now;

/** Dữ liệu "tôi" trả cho client: hồ sơ + trạng thái gói + lượt còn lại. */
export function toMe(p: ProfileRow, used: number) {
  const planKey: PlanKey = isPremium(p) ? 'premium' : 'free';
  const limits = PLANS[planKey];
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    organization: p.organization,
    avatarUrl: p.avatar_url,
    defaultGoal: p.default_goal,
    uiLanguage: p.ui_language,
    speakingLanguage: p.speaking_language,
    onboarded: !!p.onboarded_at,
    plan: planKey,
    isPremium: planKey === 'premium',
    premiumExpiresAt: p.premium_expires_at,
    usage: { periodStart: usagePeriod(), used, limit: limits.analysesPerMonth, remaining: Math.max(0, limits.analysesPerMonth - used) },
    limits,
  };
}
export type Me = ReturnType<typeof toMe>;

export const profileService = {
  async getMe(db: Db, userId: string): Promise<Me> {
    const p = await profileRepository.findById(db, userId);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'profile' });
    return toMe(p, await profileRepository.analysesUsed(db, userId));
  },
  async updateProfile(db: Db, userId: string, input: { fullName?: string; organization?: string | null }) {
    const p = await profileRepository.update(db, userId, {
      ...(input.fullName !== undefined && { full_name: input.fullName }),
      ...(input.organization !== undefined && { organization: input.organization || null }),
    });
    return toMe(p, await profileRepository.analysesUsed(db, userId));
  },
  /** Ngôn ngữ giao diện và ngôn ngữ bài nói là hai cài đặt độc lập. */
  async updatePreferences(db: Db, userId: string, input: { uiLanguage?: LangCode; speakingLanguage?: LangCode; defaultGoal?: GoalType }) {
    const p = await profileRepository.update(db, userId, {
      ...(input.uiLanguage && { ui_language: input.uiLanguage }),
      ...(input.speakingLanguage && { speaking_language: input.speakingLanguage }),
      ...(input.defaultGoal && { default_goal: input.defaultGoal }),
    });
    return toMe(p, await profileRepository.analysesUsed(db, userId));
  },
  /** Chọn mục tiêu một lần lúc onboarding → lưu làm mặc định. Gọi lại được (idempotent). */
  async completeOnboarding(db: Db, userId: string, input: { defaultGoal: GoalType; speakingLanguage: LangCode; uiLanguage?: LangCode }) {
    const current = await profileRepository.findById(db, userId);
    if (!current) throw new AppError('NOT_FOUND', { resource: 'profile' });
    const p = await profileRepository.update(db, userId, {
      default_goal: input.defaultGoal,
      speaking_language: input.speakingLanguage,
      ...(input.uiLanguage && { ui_language: input.uiLanguage }),
      onboarded_at: current.onboarded_at ?? new Date().toISOString(),
    });
    return toMe(p, await profileRepository.analysesUsed(db, userId));
  },
};
