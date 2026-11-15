/**
 * Quy tắc nghiệp vụ quyết định một bài nộp được phân tích ngay hay phải chờ.
 * Hàm thuần (không I/O) để kiểm thử dễ dàng: tests/session.policy.test.ts.
 */
export type Kind = 'audio' | 'video' | 'script';
export type Decision =
  | { action: 'enqueue' }
  | { action: 'block'; status: 'pending_premium'; reason: 'over_free_duration' }
  | { action: 'block'; status: 'pending_quota'; reason: 'no_quota' };

export interface DecisionInput {
  kind: Kind;
  durationSec: number | null;
  isPlacement: boolean;
  maxAnalyzeSec: number;     // gói hiện tại: 300 (Miễn phí) / 1800 (Premium)
  remainingCredits: number;  // lượt còn lại trong tháng (kiểm tra sơ bộ; giữ chỗ thật bằng reserve_analysis_credit)
}

export function decideAnalysis(i: DecisionInput): Decision {
  // Quy tắc 3: bài ghi âm/video dài hơn giới hạn gói → chỉ lưu thư viện, chờ Premium.
  if (i.kind !== 'script' && !i.isPlacement && (i.durationSec ?? 0) > i.maxAnalyzeSec) {
    return { action: 'block', status: 'pending_premium', reason: 'over_free_duration' };
  }
  // Hết lượt tháng → lưu và chờ (sau khi nâng cấp hoặc sang tháng mới thì phân tích được).
  if (!i.isPlacement && i.remainingCredits <= 0) return { action: 'block', status: 'pending_quota', reason: 'no_quota' };
  return { action: 'enqueue' };
}

/** Trạng thái được phép yêu cầu phân tích (lần đầu, chạy lại sau lỗi, hoặc mở khóa sau khi nâng cấp). */
export const ANALYZABLE_FROM = ['uploaded', 'pending_premium', 'pending_quota', 'failed'] as const;
export const canRequestAnalysis = (status: string) => (ANALYZABLE_FROM as readonly string[]).includes(status);

/** Bài test đầu vào: tối đa 60 giây (+ 30 giây dung sai), không tính lượt, chỉ làm một lần. */
export const PLACEMENT_MAX_SEC = 90;

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
