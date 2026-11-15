import 'server-only';
import { createSupabaseServer } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';

/** Lấy client theo phiên và user hiện tại (đã xác minh với Auth server). */
export async function getAuth() {
  const sb = await createSupabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

/** Bắt buộc đăng nhập (dùng trong API). Không có phiên → 401 UNAUTHENTICATED. */
export async function requireUser() {
  const { sb, user } = await getAuth();
  if (!user) throw new AppError('UNAUTHENTICATED');
  return { sb, user };
}
