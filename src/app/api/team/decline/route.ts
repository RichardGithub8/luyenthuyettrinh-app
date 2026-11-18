import { z } from 'zod';
import { handler, ok, body } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamService } from '@/services/team.service';

/** POST /api/team/decline { teamId } → từ chối lời mời gửi tới email của tôi. */
export const POST = handler(async (req) => {
  const { user } = await requireUser();
  const { teamId } = await body(req, z.object({ teamId: z.uuid() }));
  await teamService.decline(supabaseAdmin(), user.email ?? '', teamId);
  return ok(await teamService.view(supabaseAdmin(), user.id, user.email ?? ''));
});
