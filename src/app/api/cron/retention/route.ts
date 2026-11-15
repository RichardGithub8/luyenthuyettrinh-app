import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runRetention } from '@/services/retention.service';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

/** GET /api/cron/retention (daily): media retention + billing expiry. Vercel Cron gửi "Authorization: Bearer <CRON_SECRET>". */
export async function GET(req: NextRequest) {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const valid = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!valid) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  try {
    const db = supabaseAdmin();
    const retention = await runRetention(db);
    const { data: billing, error } = await db.rpc('expire_billing');   // pending payments + ended subscriptions
    if (error) throw error;
    return NextResponse.json({ data: { retention, billing } });
  }
  catch (e) { logger.error('retention failed', { error: String(e) }); return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 }); }
}
