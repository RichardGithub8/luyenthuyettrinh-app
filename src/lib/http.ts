import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, ERRORS, type UiLang } from '@/lib/errors';
import { createLogger, type Logger } from '@/lib/logger';

export interface Ctx { requestId: string; lang: UiLang; log: Logger }

/** Ngôn ngữ thông báo lỗi: header x-ui-language → cookie ui_lang → Accept-Language → vi. */
export function langOf(req: Request): UiLang {
  const h = req.headers.get('x-ui-language') ?? (req as NextRequest).cookies?.get?.('ui_lang')?.value ?? req.headers.get('accept-language') ?? '';
  return h.trim().toLowerCase().startsWith('en') ? 'en' : 'vi';
}

export const ok = <T>(data: T, init?: ResponseInit) => NextResponse.json({ data }, init);

export function fail(e: AppError, ctx: Ctx) {
  return NextResponse.json(
    { error: { code: e.code, message: e.message_(ctx.lang), details: e.details ?? undefined, requestId: ctx.requestId } },
    { status: e.status, headers: { 'x-request-id': ctx.requestId } },
  );
}

/** Bọc Route Handler: gắn requestId, log, chuẩn hóa lỗi. Lỗi lạ → 500 kèm log đầy đủ, không lộ chi tiết cho client. */
export function handler<P = unknown>(fn: (req: NextRequest, ctx: Ctx, params: P) => Promise<Response>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const ctx: Ctx = { requestId, lang: langOf(req), log: createLogger({ requestId, method: req.method, path: req.nextUrl.pathname }) };
    const t0 = Date.now();
    try {
      const res = await fn(req, ctx, await route.params);
      ctx.log.info('request', { status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (err) {
      if (err instanceof AppError) {
        ctx.log[err.status >= 500 ? 'error' : 'warn']('request failed', { code: err.code, status: err.status, ms: Date.now() - t0, cause: String(err.cause ?? '') });
        return fail(err, ctx);
      }
      ctx.log.error('unhandled error', { ms: Date.now() - t0, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) });
      return fail(new AppError('INTERNAL'), ctx);
    }
  };
}

/** Đọc và kiểm tra JSON body. Lỗi → VALIDATION_FAILED với danh sách trường lỗi. */
export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new AppError('VALIDATION_FAILED', { _body: ['INVALID_JSON'] }); }
  return parse(schema, raw);
}
export function parse<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string[]> = {};
  r.error.issues.forEach((i) => { const k = i.path.join('.') || '_'; const list = (fields[k] ??= []); if (!list.includes(i.message)) list.push(i.message); });
  if (Object.values(fields).flat().includes('WEAK_PASSWORD') && Object.keys(fields).length === 1) throw new AppError('WEAK_PASSWORD', { fields });
  throw new AppError('VALIDATION_FAILED', { fields });
}
export { ERRORS };
