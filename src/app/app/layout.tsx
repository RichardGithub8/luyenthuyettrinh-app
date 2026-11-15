import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { profileService } from '@/services/profile.service';

/** Bảo vệ toàn bộ /app: chưa đăng nhập → /login (middleware), chưa onboarding → /onboarding. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { sb, user } = await getAuth();
  if (!user) redirect('/login?returnUrl=/app');
  const me = await profileService.getMe(sb, user.id);
  if (!me.onboarded) redirect('/onboarding');
  return <>{children}</>;
}
