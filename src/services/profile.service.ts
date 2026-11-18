import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ProfileRow, GoalType, LangCode } from '@/types/database';
import { FREE_GOALS, PLANS, type PlanKey } from '@/config/plans';
import { AppError } from '@/lib/errors';
import { profileRepository, usageKeyOf } from '@/repositories/profile.repository';

type Db = SupabaseClient<Database>;
const ALL_GOALS: readonly GoalType[] = ['presentation', 'reporting', 'interview', 'pitching', 'debating'];

/** Gói đang có hiệu lực (gói trả phí đã hết hạn → free, kể cả khi cron dọn dẹp chưa chạy). */
export const activePlan = (p: Pick<ProfileRow, 'plan' | 'premium_expires_at'>, now = Date.now()): PlanKey =>
  p.plan !== 'free' && !!p.premium_expires_at && new Date(p.premium_expires_at).getTime() > now ? p.plan : 'free';
/** Quyền lợi cấp Premium (Premium hoặc thành viên Team). */
export const isPremium = (p: Pick<ProfileRow, 'plan' | 'premium_expires_at'>, now = Date.now()) => ['premium', 'team'].includes(activePlan(p, now));

/** Giới hạn thực tế của một hồ sơ: Pass lấy số lượt từ pass_credits (cộng dồn khi mua thêm). */
export function limitsOf(p: Pick<ProfileRow, 'plan' | 'premium_expires_at' | 'pass_credits'>) {
  const key = activePlan(p), base = PLANS[key];
  return { ...base, analysesPerPeriod: key === 'pass' ? Math.max(p.pass_credits, base.analysesPerPeriod) : base.analysesPerPeriod, goals: base.allGoals ? ALL_GOALS : FREE_GOALS };
}

/** Dữ liệu "tôi" trả cho client: hồ sơ + trạng thái gói + lượt còn lại. */
export function toMe(p: ProfileRow, used: number) {
  const planKey = activePlan(p), limits = limitsOf(p), key = usageKeyOf(p);
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
    isPremium: planKey === 'premium' || planKey === 'team',
    isPaid: planKey !== 'free',
    premiumExpiresAt: planKey === 'free' ? null : p.premium_expires_at,   // tên cũ, nghĩa: ngày gói trả phí hết hạn
    planStartedAt: p.plan_started_at,
    usage: { scope: key.scope, periodStart: key.period, used, limit: limits.analysesPerPeriod, remaining: Math.max(0, limits.analysesPerPeriod - used) },
    limits,
  };
}
export type Me = ReturnType<typeof toMe>;

export const profileService = {
  async getMe(db: Db, userId: string): Promise<Me> {
    const p = await profileRepository.findById(db, userId);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'profile' });
    return toMe(p, await profileRepository.analysesUsed(db, userId, usageKeyOf(p)));
  },
  async updateProfile(db: Db, userId: string, input: { fullName?: string; organization?: string | null }) {
    const p = await profileRepository.update(db, userId, {
      ...(input.fullName !== undefined && { full_name: input.fullName }),
      ...(input.organization !== undefined && { organization: input.organization || null }),
    });
    return toMe(p, await profileRepository.analysesUsed(db, userId, usageKeyOf(p)));
  },
  /** Ngôn ngữ giao diện và ngôn ngữ bài nói là hai cài đặt độc lập. */
  async updatePreferences(db: Db, userId: string, input: { uiLanguage?: LangCode; speakingLanguage?: LangCode; defaultGoal?: GoalType }) {
    const p = await profileRepository.update(db, userId, {
      ...(input.uiLanguage && { ui_language: input.uiLanguage }),
      ...(input.speakingLanguage && { speaking_language: input.speakingLanguage }),
      ...(input.defaultGoal && { default_goal: input.defaultGoal }),
    });
    return toMe(p, await profileRepository.analysesUsed(db, userId, usageKeyOf(p)));
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
    return toMe(p, await profileRepository.analysesUsed(db, userId, usageKeyOf(p)));
  },
};
