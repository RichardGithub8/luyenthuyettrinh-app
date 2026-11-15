import 'server-only';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) || 'info'] ?? 20;

/** Che bớt email trong log: minh@test.vn → m***@test.vn */
export const maskEmail = (e?: string | null) => (e ? e.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : e);

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

/** Log dạng JSON một dòng: dễ đọc trên Vercel/Trigger.dev và lọc theo requestId/sessionId. */
export function createLogger(ctx: Record<string, unknown> = {}): Logger {
  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx, ...data });
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (c) => createLogger({ ...ctx, ...c }),
  };
}
export const logger = createLogger({ app: 'ltt' });
