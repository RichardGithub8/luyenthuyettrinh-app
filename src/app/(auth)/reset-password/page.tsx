'use client';
import { AuthForm } from '@/components/AuthForm';

/** Truy cập được sau khi bấm link trong email (middleware yêu cầu phiên khôi phục). */
export default function Reset() {
  return (
    <main className="wrap"><div className="card">
      <h1>Đặt mật khẩu mới</h1>
      <p className="muted">Tối thiểu 8 ký tự, có cả chữ và số.</p>
      <AuthForm<{ redirectTo: string }> endpoint="/api/auth/reset-password" submit="Lưu mật khẩu" fields={[{ name: 'password', label: 'Mật khẩu mới', type: 'password', autoComplete: 'new-password' }]} onDone={(d) => { window.location.href = d.redirectTo; }} />
    </div></main>
  );
}
