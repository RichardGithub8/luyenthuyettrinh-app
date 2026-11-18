import type { BillingCycle, GoalType, PlanTier, Product } from '../types/database';

/**
 * Gói và quyền lợi theo bảng giá chốt của chủ sản phẩm (2026-11-18). Nguồn duy nhất cho giới hạn phía máy chủ.
 *   free    3 lượt/tháng, 5 phút/bài, chỉ ghi âm trực tiếp hoặc chấm kịch bản, 2 loại hình (thuyết trình, báo cáo).
 *   pass    15 lượt/7 ngày, 20 phút/bài, mọi hình thức nộp bài, cả 5 loại hình, báo cáo dòng thời gian + câu hỏi khán giả AI.
 *   premium 90 lượt/tháng (dùng hợp lý), 30 phút/bài, mọi công cụ AI, nhắc nhở thời gian thực, lưu lịch sử và so sánh tiến bộ.
 *   team    như premium cho từng thành viên (tối đa 5 tài khoản), thêm bảng điều khiển nhóm và kịch bản dùng chung.
 * Chưa làm nên KHÔNG quảng cáo: chấm ngữ điệu (tone), hàng đợi ưu tiên cho Team.
 * `analysesPerPeriod` của Pass là mặc định cho một lần kích hoạt; thực tế lấy từ profiles.pass_credits (cộng dồn khi mua thêm).
 */
export const PLANS = {
  free:    { analysesPerPeriod: 3,  period: 'month', maxAnalyzeSec: 300,  video: false, upload: false, liveCoaching: false, allGoals: false, timeline: false, audienceQa: false, history: false, compareMax: 0 },
  pass:    { analysesPerPeriod: 15, period: 'pass',  maxAnalyzeSec: 1200, video: true,  upload: true,  liveCoaching: false, allGoals: true,  timeline: true,  audienceQa: true,  history: false, compareMax: 0 },
  premium: { analysesPerPeriod: 90, period: 'month', maxAnalyzeSec: 1800, video: true,  upload: true,  liveCoaching: true,  allGoals: true,  timeline: true,  audienceQa: true,  history: true,  compareMax: 6 },
  team:    { analysesPerPeriod: 90, period: 'month', maxAnalyzeSec: 1800, video: true,  upload: true,  liveCoaching: true,  allGoals: true,  timeline: true,  audienceQa: true,  history: true,  compareMax: 6 },
} as const satisfies Record<PlanTier, unknown>;
export type PlanKey = keyof typeof PLANS;
export type PlanLimits = (typeof PLANS)[PlanKey];

/** Loại hình luyện tập mở cho gói Miễn phí. */
export const FREE_GOALS: readonly GoalType[] = ['presentation', 'reporting'];

/** Giá (VND) theo sản phẩm và chu kỳ. Pass là gói một lần, có hiệu lực 7 ngày. */
export const PRICES_VND = {
  pass:    { once: 59_000 },
  premium: { monthly: 79_000, semiannual: 399_000 },
  team:    { monthly: 299_000, semiannual: 1_490_000 },
} as const satisfies Record<Product, Partial<Record<BillingCycle, number>>>;

export function priceOf(product: Product, cycle: BillingCycle): number | null {
  const table = PRICES_VND[product] as Partial<Record<BillingCycle, number>>;
  return table[cycle] ?? null;
}

/** Thứ hạng để chặn mua gói thấp hơn gói đang dùng. */
export const PLAN_RANK: Record<PlanTier, number> = { free: 0, pass: 1, premium: 2, team: 3 };

export const TEAM_MAX_MEMBERS = 5;   // tính cả trưởng nhóm và lời mời đang chờ
export const PASS_DAYS = 7;
export const MAX_RECORD_SEC = 1800;
export const COMPARE_MIN = 3;
