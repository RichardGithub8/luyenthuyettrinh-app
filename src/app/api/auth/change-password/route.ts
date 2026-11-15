import { z } from 'zod';
import { handler, body, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { zPassword } from '@/lib/validation';
import { authService } from '@/services/auth.service';

/** POST /api/auth/change-password { currentPassword, newPassword } → cần đang đăng nhập; xác nhận lại mật khẩu cũ. */
export const POST = handler(async (req) => {
  const { sb, user } = await requireUser();
  const { currentPassword, newPassword } = await body(req, z.object({ currentPassword: z.string().min(1).max(72), newPassword: zPassword }));
  await authService.changePassword(sb, user.email!, currentPassword, newPassword);
  return ok({ changed: true });
});
