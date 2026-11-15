import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { profileService } from '@/services/profile.service';
import { accountService } from '@/services/account.service';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { zEmail } from '@/lib/validation';

/** GET /api/me → hồ sơ, gói, lượt còn lại. */
export const GET = handler(async () => {
  const { sb, user } = await requireUser();
  return ok(await profileService.getMe(sb, user.id));
});

const Patch = z.object({ fullName: z.string().trim().min(1).max(120).optional(), organization: z.string().trim().max(160).nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { error: 'EMPTY_PATCH' });

/** PATCH /api/me { fullName?, organization? } */
export const PATCH = handler(async (req) => {
  const { sb, user } = await requireUser();
  return ok(await profileService.updateProfile(sb, user.id, await body(req, Patch)));
});

/** DELETE /api/me { confirmEmail } → xóa vĩnh viễn tài khoản cùng mọi bản ghi, báo cáo, transcript. */
export const DELETE = handler(async (req) => {
  const { sb, user } = await requireUser();
  const { confirmEmail } = await body(req, z.object({ confirmEmail: zEmail }));
  const result = await accountService.deleteAccount(supabaseAdmin(), user.id, confirmEmail);
  await sb.auth.signOut().catch(() => undefined);
  return ok({ ...result, redirectTo: '/' });
});
