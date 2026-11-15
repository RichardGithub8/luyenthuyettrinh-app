import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { paymentService } from '@/services/payment.service';

/** POST /api/payments/:id/cancel → user closed the checkout. */
export const POST = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await paymentService.cancel(supabaseAdmin(), user.id, parse(zUuid, id)));
});
