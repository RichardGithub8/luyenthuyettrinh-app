import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ProfileRow, UsageScope } from '@/types/database';
import { AppError } from '@/lib/errors';

type Db = SupabaseClient<Database>;
/** Cột người dùng được phép tự sửa (khớp GRANT UPDATE trong migration). */
export type ProfilePatch = Partial<Pick<ProfileRow, 'full_name' | 'organization' | 'avatar_url' | 'default_goal' | 'ui_language' | 'speaking_language' | 'onboarded_at'>>;

/** Đầu kỳ tính lượt theo giờ Việt Nam (khớp public.current_usage_period()). */
export const usagePeriod = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 7) + '-01';
const vnDate = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export type UsageKey = { scope: UsageScope; period: string };
/** Khớp public.usage_key(): gói Pass đang chạy tính lượt theo "cửa sổ Pass" (từ ngày kích hoạt), còn lại theo tháng. */
export function usageKeyOf(p: Pick<ProfileRow, 'plan' | 'premium_expires_at' | 'plan_started_at'>, now = new Date()): UsageKey {
  const passActive = p.plan === 'pass' && !!p.premium_expires_at && new Date(p.premium_expires_at).getTime() > now.getTime() && !!p.plan_started_at;
  return passActive ? { scope: 'pass', period: vnDate(new Date(p.plan_started_at!)) } : { scope: 'month', period: usagePeriod(now) };
}

export const profileRepository = {
  async findById(db: Db, id: string): Promise<ProfileRow | null> {
    const { data, error } = await db.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw new AppError('INTERNAL', undefined, error);
    return data;
  },
  async update(db: Db, id: string, patch: ProfilePatch): Promise<ProfileRow> {
    const { data, error } = await db.from('profiles').update(patch).eq('id', id).select('*').single();
    if (error) throw new AppError('INTERNAL', undefined, error);
    return data;
  },
  async analysesUsed(db: Db, userId: string, key: UsageKey = { scope: 'month', period: usagePeriod() }): Promise<number> {
    const { data, error } = await db.from('usage_counters').select('analyses_used').eq('user_id', userId).eq('scope', key.scope).eq('period_start', key.period).maybeSingle();
    if (error) throw new AppError('INTERNAL', undefined, error);
    return data?.analyses_used ?? 0;
  },
};
