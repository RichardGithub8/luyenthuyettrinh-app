import { handler, ok } from '@/lib/http';
import { paymentService } from '@/services/payment.service';

/** GET /api/public/billing → enabled payment methods + prices (for the pricing page / checkout modal). */
export const GET = handler(async () => ok(paymentService.providers()));
