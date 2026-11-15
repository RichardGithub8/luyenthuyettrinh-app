'use client';
import { useActionState } from 'react';
import { completeOnboarding } from './actions';

const GOALS = [['presentation', 'Thuyết trình'], ['reporting', 'Báo cáo'], ['interview', 'Phỏng vấn'], ['pitching', 'Gọi vốn'], ['debating', 'Tranh biện']];

export function OnboardingForm({ goal, lang }: { goal: string; lang: string }) {
  const [state, action, pending] = useActionState(completeOnboarding, null);
  return (
    <form action={action}>
      {state?.error && <div className="alert err" role="alert">{state.error}</div>}
      <label>Mục tiêu chính<select name="defaultGoal" defaultValue={goal}>{GOALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Ngôn ngữ bài nói<select name="speakingLanguage" defaultValue={lang}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
      <button disabled={pending}>Tiếp tục</button>
    </form>
  );
}
