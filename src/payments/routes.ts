import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { PaymentProvider } from '@/types/database';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/urls';
import { landingPath } from '@/payments/core';
import { gateway } from '@/payments/gateways';
import { paymentService } from '@/services/payment.service';

const query = (req: NextRequest) => Object.fromEntries(req.nextUrl.searchParams);

/** Server-to-server IPN. Public route: trust comes only from the signature. */
export function ipnRoute(provider: PaymentProvider) {
  const handle = async (req: NextRequest) => {
    const gw = gateway(provider);
    if (!gw) return NextResponse.json({ ack: 'not_found' }, { status: 404 });
    try {
      let input: Record<string, unknown> = query(req);
      if (req.method === 'POST') input = (await req.json().catch(() => null)) ?? {};
      const { ack } = await paymentService.handleCallback(supabaseAdmin(), provider, input, 'ipn');
      return gw.ipnReply(ack);
    } catch (e) {
      logger.error('ipn error', { provider, error: String(e) });
      return gw.ipnReply('error');   // non-2xx → gateway retries later
    }
  };
  return { GET: handle, POST: handle };
}

/**
 * Browser return from the gateway. Signed like the IPN, so it can also confirm the payment
 * (IPNs can't reach localhost / may arrive late). Then redirect to the waiting talk, never the dashboard.
 */
export function returnRoute(provider: PaymentProvider) {
  return async (req: NextRequest) => {
    try {
      const { payment } = await paymentService.handleCallback(supabaseAdmin(), provider, query(req), 'return');
      if (!payment) return NextResponse.redirect(appUrl('/app/billing?payment=invalid'), 303);
      const status = payment.status === 'pending' ? 'processing' : payment.status;
      return NextResponse.redirect(appUrl(landingPath({ status, resumeSessionId: payment.resume_session_id, returnPath: payment.return_path, paymentId: payment.id })), 303);
    } catch (e) {
      logger.error('payment return error', { provider, error: String(e) });
      return NextResponse.redirect(appUrl('/app/billing?payment=error'), 303);
    }
  };
}
