import 'server-only';
import type { Db } from '@/repositories/types';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { BUCKETS } from '@/lib/storage';
import { profileRepository } from '@/repositories/profile.repository';
import { sendEmail, templates } from '@/services/email';

const log = logger.child({ module: 'account' });

/** Xóa toàn bộ tệp trong một thư mục người dùng (phân trang). */
async function purgeFolder(db: Db, bucket: string, prefix: string) {
  let removed = 0;
  for (;;) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw new AppError('INTERNAL', undefined, error);
    const files = (data ?? []).filter((f) => f.id);   // f.id null = thư mục con
    if (!files.length) return removed;
    const { error: e2 } = await db.storage.from(bucket).remove(files.map((f) => `${prefix}/${f.name}`));
    if (e2) throw new AppError('INTERNAL', undefined, e2);
    removed += files.length;
  }
}

export const accountService = {
  /**
   * Xóa tài khoản: xóa tệp trong Storage trước, rồi xóa user ở Auth → cascade xóa profile, thư viện, buổi luyện,
   * báo cáo, transcript, tiến độ, thanh toán. Email xác nhận được gửi trước khi mất địa chỉ.
   */
  async deleteAccount(admin: Db, userId: string, confirmEmail: string) {
    const p = await profileRepository.findById(admin, userId);
    if (!p) throw new AppError('NOT_FOUND', { resource: 'profile' });
    if (p.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) throw new AppError('VALIDATION_FAILED', { fields: { confirmEmail: ['EMAIL_MISMATCH'] } });
    const files = await purgeFolder(admin, BUCKETS.recordings, userId);
    await purgeFolder(admin, BUCKETS.processing, userId).catch(() => 0);
    await sendEmail({ to: p.email, userId: null, template: 'account_deleted', ...templates.accountDeleted({ name: p.full_name || p.email, lang: p.ui_language }) });
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new AppError('INTERNAL', undefined, error);
    log.info('account deleted', { userId, files });
    return { deleted: true };
  },
};
