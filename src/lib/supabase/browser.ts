'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/** Client trình duyệt: chỉ dùng để đọc dữ liệu của chính người dùng (RLS) hoặc nghe realtime. */
export const createSupabaseBrowser = () =>
  createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
