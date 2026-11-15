import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { publicEnv } from '@/lib/env';

/** Client theo phiên người dùng (cookie). Mọi truy vấn chịu RLS. Dùng trong Route Handler, Server Action, Server Component. */
export async function createSupabaseServer() {
  const env = publicEnv();
  const store = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Component không được ghi cookie; middleware đã làm mới phiên nên bỏ qua an toàn.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* read-only context */ }
      },
    },
  });
}
export type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServer>>;
