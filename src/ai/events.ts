import 'server-only';
import type { Db } from '@/repositories/types';
import { logger } from '@/lib/logger';

/** Ghi nhật ký từng bước của job vào analysis_events (xem lại khi debug) và log JSON. */
export function jobEvents(db: Db, sessionId: string, runId?: string) {
  const log = logger.child({ module: 'pipeline', sessionId, runId });
  const write = async (level: 'debug' | 'info' | 'warn' | 'error', step: string, message: string, data?: Record<string, unknown>) => {
    log[level](`${step}: ${message}`, data);
    await db.from('analysis_events').insert({ session_id: sessionId, level, step, message, data: (data ?? null) as never }).then(({ error }) => { if (error) log.warn('event insert failed', { error: error.message }); });
  };
  return { info: (s: string, m: string, d?: Record<string, unknown>) => write('info', s, m, d), warn: (s: string, m: string, d?: Record<string, unknown>) => write('warn', s, m, d), error: (s: string, m: string, d?: Record<string, unknown>) => write('error', s, m, d) };
}
