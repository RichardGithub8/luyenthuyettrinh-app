import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** GET /api/health → kiểm tra app và kết nối database. */
export async function GET() {
  const t0 = Date.now();
  try {
    const { error } = await supabaseAdmin().from('courses').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, db: 'up', ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ ok: false, db: 'down', error: e instanceof Error ? e.message : (e as { message?: string })?.message ?? JSON.stringify(e) }, { status: 503 });
  }
}
