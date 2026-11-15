import 'server-only';
import type { Db } from '@/repositories/types';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { BUCKETS, SIGNED_READ_TTL_SEC, downloadName } from '@/lib/storage';
import { libraryRepository } from '@/repositories/library.repository';
import { sessionRepository } from '@/repositories/session.repository';

const log = logger.child({ module: 'library' });
export type LibraryFilter = 'all' | 'audio' | 'video' | 'script' | 'pending';

export const libraryService = {
  /** Thư viện: mọi bài đã luyện, kèm trạng thái buổi luyện mới nhất, điểm và tình trạng tệp (còn / đã xóa). */
  async list(db: Db, userId: string, o: { filter: LibraryFilter; q?: string; before?: string; limit?: number }) {
    const limit = Math.min(o.limit ?? 30, 100);
    const items = await libraryRepository.list(db, userId, { kind: ['audio', 'video', 'script'].includes(o.filter) ? (o.filter as 'audio') : undefined, q: o.q, before: o.before, limit: limit + 1 });
    const page = items.slice(0, limit);
    const sessions = await sessionRepository.byLibraryItems(db, userId, page.map((i) => i.id));
    const latest = new Map<string, (typeof sessions)[number]>();
    sessions.forEach((s) => { if (!latest.has(s.library_item_id)) latest.set(s.library_item_id, s); });
    const slugs = await sessionRepository.lessonSlugs(db, [...latest.values()].map((s) => s.lesson_id));
    const results = await sessionRepository.resultsForSessions(db, userId, [...latest.values()].map((s) => s.id));
    const scoreOf = new Map(results.map((r) => [r.session_id, r.overall_score]));
    let rows = page.map((i) => {
      const s = latest.get(i.id);
      return {
        id: i.id, kind: i.kind, title: i.title, createdAt: i.created_at, durationSec: i.duration_sec, sizeBytes: i.size_bytes, wordCount: i.word_count,
        media: i.kind === 'script' ? null : { available: !i.media_deleted_at, expiresAt: i.media_expires_at, deletedAt: i.media_deleted_at, deletedReason: i.media_delete_reason },
        session: s ? { id: s.id, status: s.status, blockedReason: s.blocked_reason, goal: s.goal, speakingLanguage: s.speaking_language, lessonId: s.lesson_id, lessonSlug: s.lesson_id ? slugs.get(s.lesson_id) ?? null : null, isPlacement: s.is_placement, score: scoreOf.get(s.id) ?? null, errorCode: s.last_error_code } : null,
      };
    });
    if (o.filter === 'pending') rows = rows.filter((r) => r.session && ['pending_premium', 'pending_quota', 'failed'].includes(r.session.status));
    return { items: rows, nextCursor: items.length > limit ? page[page.length - 1]!.created_at : null };
  },

  async get(db: Db, userId: string, id: string) {
    const i = await libraryRepository.findOwned(db, userId, id);
    if (!i) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    return { id: i.id, kind: i.kind, title: i.title, scriptText: i.script_text, durationSec: i.duration_sec, createdAt: i.created_at, mediaExpiresAt: i.media_expires_at, mediaDeletedAt: i.media_deleted_at };
  },

  /** URL ký có hạn 5 phút để nghe lại / xem lại / tải về. Tệp đã bị xóa → 410 MEDIA_EXPIRED. */
  async mediaUrl(db: Db, userId: string, id: string, download: boolean) {
    const i = await libraryRepository.findOwned(db, userId, id);
    if (!i) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    if (i.kind === 'script' || !i.storage_path) throw new AppError('INVALID_STATE', { reason: 'no_media' });
    if (i.media_deleted_at) throw new AppError('MEDIA_EXPIRED', { reason: i.media_delete_reason });
    if (!i.upload_completed_at) throw new AppError('UPLOAD_NOT_FOUND');
    const { data, error } = await db.storage.from(BUCKETS.recordings).createSignedUrl(i.storage_path, SIGNED_READ_TTL_SEC, download ? { download: downloadName(i.title, i.storage_path) } : undefined);
    if (error || !data) throw new AppError('INTERNAL', undefined, error);
    return { url: data.signedUrl, expiresInSec: SIGNED_READ_TTL_SEC, mimeType: i.mime_type };
  },

  /** Người dùng tự xóa video/âm thanh. Báo cáo và bản chép lời được GIỮ. Bài đang chờ phân tích bị hủy (không còn tệp). */
  async deleteMedia(db: Db, userId: string, id: string) {
    const i = await libraryRepository.findOwned(db, userId, id);
    if (!i) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    if (i.kind === 'script' || !i.storage_path) throw new AppError('INVALID_STATE', { reason: 'no_media' });
    if (i.media_deleted_at) return { deleted: true, alreadyDeleted: true };
    if (await sessionRepository.activeForItem(db, i.id)) throw new AppError('MEDIA_IN_USE');
    const { error } = await db.storage.from(BUCKETS.recordings).remove([i.storage_path]);
    if (error) throw new AppError('INTERNAL', undefined, error);
    await libraryRepository.markMediaDeleted(db, [i.id], 'user');
    await sessionRepository.cancelPendingForItem(db, i.id);
    log.info('media deleted by user', { itemId: i.id });
    return { deleted: true };
  },

  /** Xóa hẳn một bài: tệp + mục thư viện + buổi luyện + báo cáo (cascade). */
  async deleteItem(db: Db, userId: string, id: string) {
    const i = await libraryRepository.findOwned(db, userId, id);
    if (!i) throw new AppError('NOT_FOUND', { resource: 'library_item' });
    if (await sessionRepository.activeForItem(db, i.id)) throw new AppError('MEDIA_IN_USE');
    if (i.storage_path && !i.media_deleted_at) {
      const { error } = await db.storage.from(BUCKETS.recordings).remove([i.storage_path]);
      if (error) throw new AppError('INTERNAL', undefined, error);
    }
    await libraryRepository.remove(db, userId, i.id);
    log.info('library item deleted', { itemId: i.id });
    return { deleted: true };
  },
};
