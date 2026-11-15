/** Quy ước lưu trữ tệp. Đường dẫn luôn bắt đầu bằng user_id để policy Storage chặn được theo thư mục. */
export const BUCKETS = { recordings: 'recordings', processing: 'processing' } as const;

export const MEDIA_TYPES: Record<string, { ext: string; kind: 'audio' | 'video' }> = {
  'audio/mpeg': { ext: 'mp3', kind: 'audio' }, 'audio/mp3': { ext: 'mp3', kind: 'audio' },
  'audio/wav': { ext: 'wav', kind: 'audio' }, 'audio/x-wav': { ext: 'wav', kind: 'audio' },
  'audio/mp4': { ext: 'm4a', kind: 'audio' }, 'audio/x-m4a': { ext: 'm4a', kind: 'audio' }, 'audio/m4a': { ext: 'm4a', kind: 'audio' },
  'audio/webm': { ext: 'webm', kind: 'audio' }, 'audio/ogg': { ext: 'ogg', kind: 'audio' },
  'video/mp4': { ext: 'mp4', kind: 'video' }, 'video/webm': { ext: 'webm', kind: 'video' }, 'video/quicktime': { ext: 'mov', kind: 'video' },
};
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const SIGNED_UPLOAD_TTL_SEC = 2 * 60 * 60;   // giới hạn của Supabase signed upload URL
export const SIGNED_READ_TTL_SEC = 5 * 60;

/** "audio/webm;codecs=opus" → "audio/webm" */
export const baseMime = (m: string) => m.split(';')[0]!.trim().toLowerCase();
export const mediaPath = (userId: string, itemId: string, mime: string) => `${userId}/${itemId}.${MEDIA_TYPES[baseMime(mime)]?.ext ?? 'bin'}`;
export const fileNameOf = (path: string) => path.split('/').pop()!;
export const downloadName = (title: string, path: string) =>
  `${title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'bai-noi'}.${path.split('.').pop()}`;
