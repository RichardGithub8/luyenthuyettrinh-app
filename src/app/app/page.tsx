import { getAuth } from '@/lib/auth';
import { profileService } from '@/services/profile.service';
import { LogoutButton } from './logout';

export default async function Dashboard() {
  const { sb, user } = await getAuth();
  const me = await profileService.getMe(sb, user!.id);
  return (
    <main className="wrap" style={{ maxWidth: 640 }}><div className="card">
      <h1>Chào {me.fullName}</h1>
      <p className="muted">Gói {me.isPremium ? 'Premium' : 'Miễn phí'} · còn {me.usage.remaining}/{me.usage.limit} lượt tháng này.</p>
      <pre>{JSON.stringify(me, null, 2)}</pre>
      <LogoutButton />
    </div></main>
  );
}
