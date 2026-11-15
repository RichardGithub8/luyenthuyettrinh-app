import { handler, ok } from '@/lib/http';
import { createSupabaseServer } from '@/lib/supabase/server';
import { authService } from '@/services/auth.service';

/** POST /api/auth/logout */
export const POST = handler(async () => {
  await authService.logout(await createSupabaseServer());
  return ok({ redirectTo: '/' });
});
