'use client';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export default function Register() {
  return (
    <main className="wrap"><div className="card">
      <h1>Tạo tài khoản</h1>
      <p className="muted">Miễn phí 3 lượt phân tích mỗi tháng.</p>
      <AuthForm<{ email: string; needsVerification: boolean }> endpoint="/api/auth/register" submit="Tạo tài khoản" extra={{ uiLanguage: 'vi' }}
        fields={[{ name: 'fullName', label: 'Họ và tên', autoComplete: 'name' }, { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }, { name: 'password', label: 'Mật khẩu (≥ 8 ký tự, có chữ và số)', type: 'password', autoComplete: 'new-password' }]}
        onDone={(d) => { window.location.href = d.needsVerification ? `/verify-email?email=${encodeURIComponent(d.email)}` : '/onboarding'; }} />
      <div className="links" style={{ marginTop: 14 }}><span>Đã có tài khoản?</span><Link href="/login">Đăng nhập</Link></div>
    </div></main>
  );
}
