import { getAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { paymentService } from '@/services/payment.service';
import { profileService } from '@/services/profile.service';

export const dynamic = 'force-dynamic';

/** Demo billing page: plan status, result of the last checkout, payment history. */
export default async function Billing({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment } = await searchParams;
  const { user } = await getAuth();
  const db = supabaseAdmin();
  const [me, history] = await Promise.all([profileService.getMe(db, user!.id), paymentService.list(db, user!.id)]);
  return (
    <main className="wrap" style={{ maxWidth: 720 }}>
      {payment && <div className="alert">payment = {payment}</div>}
      <div className="card">
        <h1>{me.isPremium ? 'Premium' : 'Miễn phí / Free'}</h1>
        <pre>{JSON.stringify({ plan: me.plan, usage: me.usage, providers: paymentService.providers(), history }, null, 2)}</pre>
      </div>
    </main>
  );
}
