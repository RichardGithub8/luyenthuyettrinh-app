'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export default function Forgot() {
  const [sent, setSent] = useState('');
  return (
    <main className="wrap"><div className="card">
      <h1>Quên mật khẩu</h1>
      {sent ? <div className="alert ok" role="status">Nếu {sent} có tài khoản, link đặt lại mật khẩu đã được gửi tới hộp thư. Link có hiệu lực trong 1 giờ.</div> : <>
        <p className="muted">Nhập email đã đăng ký để nhận link đặt lại mật khẩu.</p>
        <AuthForm endpoint="/api/auth/forgot-password" submit="Gửi link" fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }]} onDone={(_, v) => setSent(v.email ?? '')} />
      </>}
      <div className="links" style={{ marginTop: 14 }}><Link href="/login">Quay lại đăng nhập</Link></div>
    </div></main>
  );
}
