'use client';
import { useState } from 'react';
import { api, ApiError } from './api';

/** Form dùng chung: gửi JSON tới API, hiển thị lỗi theo mã, gọi onDone khi thành công. */
export function AuthForm<T>({ endpoint, fields, submit, onDone, extra }: {
  endpoint: string;
  fields: { name: string; label: string; type?: string; autoComplete?: string }[];
  submit: string;
  onDone: (data: T, values: Record<string, string>) => void;
  extra?: Record<string, string>;
}) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <form noValidate onSubmit={async (e) => {
      e.preventDefault(); setErr(''); setBusy(true);
      const values = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
      try { onDone(await api<T>(endpoint, { json: { ...values, ...extra } }), values); }
      catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); }
      finally { setBusy(false); }
    }}>
      {err && <div className="alert err" role="alert">{err}</div>}
      {fields.map((f) => <label key={f.name}>{f.label}<input name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} required /></label>)}
      <button disabled={busy}>{busy ? '…' : submit}</button>
    </form>
  );
}
