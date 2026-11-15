/**
 * Đơn giá để ước tính chi phí mỗi bài (lưu vào analysis_results.cost_usd).
 * CẦN CẬP NHẬT theo bảng giá hiện hành: https://groq.com/pricing · https://api-docs.deepseek.com/quick_start/pricing
 */
export const AI_PRICING = {
  stt: { 'whisper-large-v3-turbo': { usdPerHour: 0.04, minBilledSec: 10 } } as Record<string, { usdPerHour: number; minBilledSec: number }>,
  llm: { 'deepseek-chat': { inputPerM: 0.27, cachedInputPerM: 0.07, outputPerM: 1.1 } } as Record<string, { inputPerM: number; cachedInputPerM: number; outputPerM: number }>,
};
export function sttCost(model: string, sec: number) {
  const p = AI_PRICING.stt[model]; return p ? (Math.max(sec, p.minBilledSec) / 3600) * p.usdPerHour : 0;
}
export function llmCost(model: string, u: { input: number; cachedInput?: number; output: number }) {
  const p = AI_PRICING.llm[model]; if (!p) return 0;
  const cached = u.cachedInput ?? 0;
  return ((u.input - cached) * p.inputPerM + cached * p.cachedInputPerM + u.output * p.outputPerM) / 1_000_000;
}
