/** Giới hạn theo gói. CẦN XÁC NHẬN với product owner trước khi ra mắt. */
export const PLANS = {
  free: { analysesPerMonth: 3, maxAnalyzeSec: 300, video: false, liveCoaching: false, compareMax: 3 },
  premium: { analysesPerMonth: 50, maxAnalyzeSec: 1800, video: true, liveCoaching: true, compareMax: 6 },
} as const;

export const PRICES_VND = { monthly: 149_000, yearly: 1_290_000 } as const;
export const MAX_RECORD_SEC = 1800;
export const COMPARE_MIN = 3;

export type PlanKey = keyof typeof PLANS;
