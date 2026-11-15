import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { paymentReturnUrl } from '@/lib/urls';
import { paymentService } from '@/services/payment.service';

const Form = z.object({ paymentId: z.uuid(), outcome: z.enum(['succeeded', 'failed', 'cancelled']) });

/**
 * POST /api/payments/mock/simulate (form or JSON) — the mock checkout page's buttons.
 * Runs the signed IPN path, then 303-redirects to the gateway-style return URL like a real gateway would.
 */
export const POST = handler(async (req) => {
  const { user } = await requireUser();
  const raw = req.headers.get('content-type')?.includes('application/json') ? await req.json().catch(() => ({})) : Object.fromEntries(await req.formData());
  const i = parse(Form, raw);
  const { returnQuery } = await paymentService.simulate(supabaseAdmin(), user.id, i.paymentId, i.outcome);
  return NextResponse.redirect(`${paymentReturnUrl('mock', i.paymentId)}&${returnQuery}`, 303);
});
export const maxDuration = 300;
