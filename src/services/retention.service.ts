import 'server-only';
import type { Db } from '@/repositories/types';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/urls';
import { BUCKETS } from '@/lib/storage';
import { libraryRepository } from '@/repositories/library.repository';
import { sessionRepository } from '@/repositories/session.repository';
import { profileRepository } from '@/repositories/profile.repository';
import { sendEmail, templates } from '@/services/email';

const log = logger.child({ module: 'retention' });
const BATCH = 200, DAY = 86400_000;

/**
 * Chạy hằng ngày (Vercel Cron → /api/cron/retention). Idempotent, giới hạn số bản ghi mỗi lần chạy.
 * 1. Nhắc qua email 3 ngày trước khi tệp bị xóa.
 * 2. Xóa tệp ghi âm/video gốc quá 30 ngày (giữ báo cáo + transcript).
 * 3. Dọn bài tải lên dang dở > 24 giờ.
 * 4. Dọn tệp tạm AI trong bucket "processing" > 24 giờ (dự phòng nếu job không tự xóa).
 */
export async function runRetention(db: Db, now = new Date()) {
  const report = { warnedUsers: 0, mediaDeleted: 0, abandonedUploads: 0, tempFilesDeleted: 0, errors: [] as string[] };

  // 1. Nhắc trước 3 ngày, gộp theo người dùng.
  const soon = await libraryRepository.expiringSoon(db, now.toISOString(), new Date(now.getTime() + 3 * DAY).toISOString(), BATCH);
  const byUser = new Map<string, typeof soon>();
  soon.forEach((i) => byUser.set(i.user_id, [...(byUser.get(i.user_id) ?? []), i]));
  for (const [userId, items] of byUser) {
    const p = await profileRepository.findById(db, userId);
    if (p) {
      const t = templates.retentionWarning({ name: p.full_name || p.email, lang: p.ui_language, items: items.map((i) => ({ title: i.title, expiresAt: i.media_expires_at! })), libraryUrl: appUrl('/app/library') });
      await sendEmail({ to: p.email, userId, template: 'retention_warning', ...t });
      report.warnedUsers++;
    }
    await db.from('library_items').update({ retention_warned_at: now.toISOString() }).in('id', items.map((i) => i.id));
  }

  // 2. Xóa tệp hết hạn.
  const expired = await libraryRepository.expiredMedia(db, now.toISOString(), BATCH);
  if (expired.length) {
    const { error } = await db.storage.from(BUCKETS.recordings).remove(expired.map((i) => i.storage_path!));
    if (error) report.errors.push(`remove expired: ${error.message}`);
    else { await libraryRepository.markMediaDeleted(db, expired.map((i) => i.id), 'retention'); report.mediaDeleted = expired.length; }
  }

  // 3. Tải lên dang dở.
  const stale = await sessionRepository.staleUploads(db, new Date(now.getTime() - DAY).toISOString(), BATCH);
  for (const s of stale) {
    const item = await libraryRepository.findOwned(db, s.user_id, s.library_item_id);
    if (item?.storage_path) await db.storage.from(BUCKETS.recordings).remove([item.storage_path]);
    if (item) await libraryRepository.remove(db, s.user_id, item.id);
    report.abandonedUploads++;
  }

  // 4. Tệp tạm AI: processing/<user_id>/<session_id>/*
  const { data: folders } = await db.storage.from(BUCKETS.processing).list('', { limit: 1000 });
  for (const f of folders ?? []) {
    const { data: files } = await db.storage.from(BUCKETS.processing).list(f.name, { limit: 1000 });
    const old = (files ?? []).filter((x) => x.created_at && now.getTime() - new Date(x.created_at).getTime() > DAY).map((x) => `${f.name}/${x.name}`);
    if (old.length) { const { error } = await db.storage.from(BUCKETS.processing).remove(old); if (!error) report.tempFilesDeleted += old.length; }
  }

  log.info('retention run', report);
  return report;
}
