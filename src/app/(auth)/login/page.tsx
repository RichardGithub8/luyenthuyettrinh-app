'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

const CALLBACK_ERRORS: Record<string, string> = {
  LINK_EXPIRED: 'Liên kết đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.',
  OAUTH_FAILED: 'Không đăng nhập được bằng Google. Vui lòng thử lại.',
  AUTH_FAILED: 'Không xử lý được yêu cầu. Vui lòng thử lại.',
};

function Login() {
  const sp = useSearchParams(), returnUrl = sp.get('returnUrl') ?? '/app', err = sp.get('error');
  return (
    <main className="wrap"><div className="card">
      <h1>Đăng nhập</h1>
      <p className="muted">{sp.get('returnUrl') ? 'Đăng nhập để tiếp tục tới trang bạn vừa mở.' : 'Tiếp tục luyện tập.'}</p>
      {err && <div className="alert err" role="alert" style={{ marginBottom: 14 }}>{CALLBACK_ERRORS[err] ?? CALLBACK_ERRORS.AUTH_FAILED}</div>}
      <a className="btn ghost" style={{ display: 'block', marginBottom: 14 }} href={`/api/auth/oauth/google?next=${encodeURIComponent(returnUrl)}`}>Tiếp tục với Google</a>
      <AuthForm<{ redirectTo: string }> endpoint="/api/auth/login" submit="Đăng nhập" extra={{ returnUrl }}
        fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }, { name: 'password', label: 'Mật khẩu', type: 'password', autoComplete: 'current-password' }]}
        onDone={(d) => { window.location.href = d.redirectTo; }} />
      <div className="links" style={{ marginTop: 14 }}><Link href="/forgot-password">Quên mật khẩu?</Link><Link href="/register">Đăng ký</Link></div>
    </div></main>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
