'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/components/api';

function Verify() {
  const email = useSearchParams().get('email') ?? '';
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <main className="wrap"><div className="card">
      <h1>Kiểm tra hộp thư</h1>
      <p className="muted">Chúng tôi đã gửi link xác thực tới <b>{email}</b>. Bấm vào link để kích hoạt tài khoản.</p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'err'}`} role="status" style={{ marginBottom: 14 }}>{msg.text}</div>}
      <button className="ghost" onClick={async () => {
        try { await api('/api/auth/resend-verification', { json: { email } }); setMsg({ ok: true, text: 'Đã gửi lại email xác thực.' }); }
        catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : String(e) }); }
      }}>Gửi lại email</button>
      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>Chạy local: email nằm trong Inbucket tại http://127.0.0.1:54324</p>
    </div></main>
  );
}
export default function Page() { return <Suspense><Verify /></Suspense>; }
