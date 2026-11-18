import { z } from 'zod';
import { handler, ok, body } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { teamService } from '@/services/team.service';

/** POST /api/team/members { email } → mời một người (trưởng nhóm; tối đa 5 tài khoản kể cả lời mời đang chờ). */
export const POST = handler(async (req, ctx) => {
  const { user } = await requireUser();
  const { email } = await body(req, z.object({ email: z.email().max(254) }));
  await teamService.invite(supabaseAdmin(), user.id, email, ctx.lang);
  return ok(await teamService.view(supabaseAdmin(), user.id, user.email ?? ''), { status: 201 });
});

/** DELETE /api/team/members?email= → trưởng nhóm xóa thành viên/lời mời; thành viên dùng email của mình để rời nhóm. */
export const DELETE = handler(async (req) => {
  const { user } = await requireUser();
  const email = req.nextUrl.searchParams.get('email') ?? '';
  if (!z.email().safeParse(email).success) throw new AppError('VALIDATION_FAILED', { fields: { email: ['INVALID_EMAIL'] } });
  await teamService.remove(supabaseAdmin(), user.id, user.email ?? '', email);
  return ok(await teamService.view(supabaseAdmin(), user.id, user.email ?? ''));
});
