import { z } from 'zod';
import { handler, ok, body } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamService } from '@/services/team.service';

/** GET /api/team → { team | null, invites } (thống kê thành viên chỉ có khi tôi là trưởng nhóm). */
export const GET = handler(async () => {
  const { user } = await requireUser();
  return ok(await teamService.view(supabaseAdmin(), user.id, user.email ?? ''));
});

/** PATCH /api/team { name } → đổi tên nhóm (trưởng nhóm). */
export const PATCH = handler(async (req) => {
  const { user } = await requireUser();
  const { name } = await body(req, z.object({ name: z.string().trim().min(1).max(80) }));
  await teamService.rename(supabaseAdmin(), user.id, name);
  return ok(await teamService.view(supabaseAdmin(), user.id, user.email ?? ''));
});
