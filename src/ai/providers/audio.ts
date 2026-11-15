import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Db } from '@/repositories/types';
import { BUCKETS } from '@/lib/storage';
import { serverEnv } from '@/lib/env';
import { PipelineError } from '@/ai/core/types';

const GROQ_MAX_BYTES = 24 * 1024 * 1024;

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(serverEnv().FFMPEG_PATH || process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => reject(e));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err}`))));
  });
}

/**
 * Lấy âm thanh để gửi STT.
 * - Âm thanh nhỏ hơn 24 MB: gửi nguyên bản.
 * - Video hoặc tệp lớn: tách/nén thành MP3 mono 16 kHz 32 kbps (30 phút ≈ 7 MB) bằng ffmpeg,
 *   cache ở bucket "processing" để lần thử lại không phải xử lý lại. Tệp tạm được xóa khi job xong.
 */
export async function prepareAudio(db: Db, o: { userId: string; sessionId: string; storagePath: string; kind: 'audio' | 'video'; sizeBytes: number | null }) {
  const cachePath = `${o.userId}/${o.sessionId}/audio.mp3`;
  const cached = await db.storage.from(BUCKETS.processing).download(cachePath);
  if (cached.data) return { blob: cached.data, filename: 'audio.mp3', transcoded: true };

  const orig = await db.storage.from(BUCKETS.recordings).download(o.storagePath);
  if (orig.error || !orig.data) throw new PipelineError('MEDIA_MISSING', false, `cannot download ${o.storagePath}: ${orig.error?.message}`);
  const ext = path.extname(o.storagePath) || '.webm';
  if (o.kind === 'audio' && orig.data.size <= GROQ_MAX_BYTES) return { blob: orig.data, filename: `audio${ext}`, transcoded: false };

  const dir = await mkdtemp(path.join(tmpdir(), 'ltt-'));
  try {
    const input = path.join(dir, `in${ext}`), output = path.join(dir, 'out.mp3');
    await writeFile(input, Buffer.from(await orig.data.arrayBuffer()));
    try { await runFfmpeg(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', output]); }
    catch (e) {
      // Không có ffmpeg (chạy inline ở máy dev): tệp đủ nhỏ thì gửi nguyên bản, Groq nhận được mp4/webm.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && orig.data.size <= GROQ_MAX_BYTES) return { blob: orig.data, filename: `media${ext}`, transcoded: false };
      throw new PipelineError((e as NodeJS.ErrnoException).code === 'ENOENT' ? 'TRANSCODE_UNAVAILABLE' : 'AUDIO_UNREADABLE', false, String(e).slice(0, 500));
    }
    const buf = await readFile(output);
    if (buf.byteLength > GROQ_MAX_BYTES) throw new PipelineError('AUDIO_TOO_LARGE', false, `${buf.byteLength} bytes after transcode`);
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    await db.storage.from(BUCKETS.processing).upload(cachePath, blob, { contentType: 'audio/mpeg', upsert: true });
    return { blob, filename: 'audio.mp3', transcoded: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Xóa tệp tạm của một buổi luyện (gọi khi job xong hoặc thất bại hẳn). */
export async function cleanupTemp(db: Db, userId: string, sessionId: string) {
  const prefix = `${userId}/${sessionId}`;
  const { data } = await db.storage.from(BUCKETS.processing).list(prefix);
  if (data?.length) await db.storage.from(BUCKETS.processing).remove(data.map((f) => `${prefix}/${f.name}`));
}
