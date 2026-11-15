import { task, AbortTaskRunError } from '@trigger.dev/sdk';
import { runAnalysis } from '@/ai/pipeline';
import { markFailed, classifyFailure } from '@/ai/failure';
import { PipelineError } from '@/ai/core/types';

/**
 * Job phân tích một buổi luyện.
 * - Thử lại tối đa 3 lần với backoff (5s → 60s) cho lỗi tạm thời: mạng, 429, 5xx, JSON sai.
 * - Lỗi vĩnh viễn (không có giọng nói, tệp hỏng) → AbortTaskRunError, dừng ngay, không tốn thêm lượt gọi API.
 * - Quá 10 phút → Trigger.dev dừng run; onFailure đánh dấu timed_out và hoàn lượt.
 * - Tối đa 5 job chạy cùng lúc để không vượt rate limit Groq/DeepSeek.
 */
export const analyzeSession = task({
  id: 'analyze-session',
  maxDuration: 600,
  concurrency: { total: 5 },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, randomize: true },
  run: async (payload: { sessionId: string }, { ctx }) => {
    try {
      return await runAnalysis(payload.sessionId, { runId: ctx.run.id, attempt: ctx.attempt.number });
    } catch (e) {
      if (e instanceof PipelineError && !e.retryable) throw new AbortTaskRunError(`${e.code}: ${e.message}`);
      throw e;
    }
  },
  onFailure: async ({ payload, error }) => {
    const c = classifyFailure(error);
    await markFailed(payload.sessionId, c.code, c.message, c.timedOut);
  },
});
