'use client';
import { api } from '@/components/api';

export function LogoutButton() {
  return <button className="ghost" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = '/'; }}>Đăng xuất</button>;
}
