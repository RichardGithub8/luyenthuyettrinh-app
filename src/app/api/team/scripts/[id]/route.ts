import { z } from 'zod';
import { handler, ok, parse } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamService } from '@/services/team.service';

/** DELETE /api/team/scripts/:id → tác giả hoặc trưởng nhóm xóa kịch bản. */
export const DELETE = handler<{ id: string }>(async (_req, _ctx, params) => {
  const { user } = await requireUser();
  const id = parse(z.uuid(), params.id);
  await teamService.removeScript(supabaseAdmin(), user.id, id);
  return ok({ id });
});
