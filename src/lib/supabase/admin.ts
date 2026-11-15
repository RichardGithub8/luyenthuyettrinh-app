import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { serverEnv } from '@/lib/env';

let admin: ReturnType<typeof createClient<Database>> | null = null;

/** Client service_role: BỎ QUA RLS. Chỉ dùng trong service/job sau khi đã kiểm tra quyền và quy tắc nghiệp vụ. */
export function supabaseAdmin() {
  if (!admin) {
    const env = serverEnv();
    admin = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
export type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;
