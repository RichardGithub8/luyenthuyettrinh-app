import 'server-only';
import { after } from 'next/server';
import { tasks } from '@trigger.dev/sdk';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { analyzeSession } from '@/trigger/analyze-session';

/**
 * Hàng đợi phân tích:
 * - "trigger": Trigger.dev (production). Có retry, timeout, giới hạn chạy song song, dashboard theo dõi.
 * - "inline": chạy ngay trong Next.js sau khi trả response (next/server after()). Dùng khi chưa có khóa
 *   Trigger.dev để demo/dev. Có retry đơn giản; phù hợp bài ngắn vì bị giới hạn maxDuration của function.
 */
export interface AnalysisQueue { readonly name: string; enqueue(sessionId: string, attempt: number): Promise<{ runId: string }> }

class TriggerQueue implements AnalysisQueue {
  readonly name = 'trigger';
  async enqueue(sessionId: string, attempt: number) {
    const handle = await tasks.trigger<typeof analyzeSession>('analyze-session', { sessionId }, {
      idempotencyKey: `analyze:${sessionId}:${attempt}`,   // bấm nhiều lần / request trùng không tạo nhiều job
      tags: [`session_${sessionId}`],
    });
    return { runId: handle.id };
  }
}

class InlineQueue implements AnalysisQueue {
  readonly name = 'inline';
  async enqueue(sessionId: string) {
    const runId = `inline_${crypto.randomUUID()}`;
    after(async () => {
      const { runAnalysis } = await import('@/ai/pipeline');
      const { markFailed, classifyFailure } = await import('@/ai/failure');
      const { PipelineError } = await import('@/ai/core/types');
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await runAnalysis(sessionId, { runId, attempt }); return; }
        catch (e) {
          const retryable = !(e instanceof PipelineError) || e.retryable;
          logger.warn('inline analysis attempt failed', { sessionId, attempt, retryable, error: String(e) });
          if (!retryable || attempt === 3) { const c = classifyFailure(e); await markFailed(sessionId, c.code, c.message, c.timedOut); return; }
          await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
        }
      }
    });
    return { runId };
  }
}

let queue: AnalysisQueue | null = null;
export function analysisQueue(): AnalysisQueue {
  if (queue) return queue;
  const env = serverEnv(), want = env.ANALYSIS_QUEUE ?? (env.TRIGGER_SECRET_KEY ? 'trigger' : 'inline');
  if (want === 'trigger' && !env.TRIGGER_SECRET_KEY) logger.warn('ANALYSIS_QUEUE=trigger nhưng thiếu TRIGGER_SECRET_KEY → dùng inline');
  queue = want === 'trigger' && env.TRIGGER_SECRET_KEY ? new TriggerQueue() : new InlineQueue();
  logger.info('analysis queue', { queue: queue.name });
  return queue;
}
