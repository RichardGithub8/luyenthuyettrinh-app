import { NextResponse } from 'next/server';
import { handler } from '@/lib/http';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

/** GET /api/auth/oauth/google?next=/app → 302 tới trang đăng nhập Google. */
export const GET = handler(async (req) => {
  const url = await authService.googleSignInUrl(await createSupabaseServer(), req.nextUrl.searchParams.get('next') ?? '/app');
  return NextResponse.redirect(url);
});
