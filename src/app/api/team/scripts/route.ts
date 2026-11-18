import { z } from 'zod';
import { handler, ok, body } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamService } from '@/services/team.service';

/** GET /api/team/scripts → kịch bản và tài liệu luyện tập dùng chung trong nhóm. */
export const GET = handler(async () => {
  const { user } = await requireUser();
  return ok({ items: await teamService.listScripts(supabaseAdmin(), user.id) });
});

/** POST /api/team/scripts { title, body } → chia sẻ một kịch bản với cả nhóm. */
export const POST = handler(async (req) => {
  const { user } = await requireUser();
  const i = await body(req, z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(20000) }));
  return ok(await teamService.addScript(supabaseAdmin(), user.id, i), { status: 201 });
});
