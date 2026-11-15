'use client';
/** Gọi API nội bộ, trả về { data } hoặc ném lỗi có code + message đã dịch theo ngôn ngữ giao diện. */
export class ApiError extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } }
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'vi';
  const res = await fetch(path, {
    ...init,
    method: init.method ?? (init.json ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-ui-language': lang, ...init.headers },
    body: init.json ? JSON.stringify(init.json) : init.body,
  }).catch(() => { throw new ApiError('NETWORK', lang === 'en' ? 'You appear to be offline. Check your connection.' : 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'); });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(payload?.error?.code ?? 'INTERNAL', payload?.error?.message ?? 'Đã có lỗi xảy ra.', payload?.error?.details);
  return payload.data as T;
}
