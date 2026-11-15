import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { profileService } from '@/services/profile.service';
import { OnboardingForm } from './form';

export default async function Onboarding() {
  const { sb, user } = await getAuth();
  if (!user) redirect('/login?returnUrl=/onboarding');
  const me = await profileService.getMe(sb, user.id);
  if (me.onboarded) redirect('/app');
  return <main className="wrap"><div className="card"><h1>Thiết lập tài khoản</h1><p className="muted">Mục tiêu được lưu làm mặc định, mỗi buổi luyện đổi nhanh được.</p><OnboardingForm goal={me.defaultGoal} lang={me.speakingLanguage} /></div></main>;
}
