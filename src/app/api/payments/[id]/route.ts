import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zUuid } from '@/lib/validation-practice';
import { paymentService } from '@/services/payment.service';

/** GET /api/payments/:id → status (the return page polls this until it leaves "pending"). */
export const GET = handler<{ id: string }>(async (_req, _ctx, { id }) => {
  const { user } = await requireUser();
  return ok(await paymentService.get(supabaseAdmin(), user.id, parse(zUuid, id)));
});
