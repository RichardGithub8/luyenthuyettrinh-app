import { z } from 'zod';
import { handler, ok, body } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { paymentService } from '@/services/payment.service';

const Create = z.object({
  provider: z.enum(['momo', 'vnpay', 'mock']),
  cycle: z.enum(['monthly', 'yearly']),
  resumeSessionId: z.uuid().optional(),                                    // talk to analyse right after paying
  returnPath: z.string().max(300).regex(/^\/(?!\/)[^\s\\]*$/).optional(),   // where to land when there is no talk
});
const clientIp = (h: Headers) => h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '127.0.0.1';

/** GET /api/payments → payment history (newest first). */
export const GET = handler(async () => {
  const { user } = await requireUser();
  return ok(await paymentService.list(supabaseAdmin(), user.id));
});

/** POST /api/payments → create order, returns { checkoutUrl } to redirect the browser to. */
export const POST = handler(async (req, ctx) => {
  const { user } = await requireUser();
  const i = await body(req, Create);
  return ok(await paymentService.create(supabaseAdmin(), user.id, i, { ip: clientIp(req.headers), lang: ctx.lang }), { status: 201 });
});
