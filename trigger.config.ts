import { defineConfig } from '@trigger.dev/sdk';
import { ffmpeg } from '@trigger.dev/build/extensions/core';
import { esbuildPlugin } from '@trigger.dev/build/extensions';

/**
 * Trigger.dev: `npx trigger.dev@4.7.7 dev` (local) · `npx trigger.dev@4.7.7 deploy` (cloud).
 * Biến môi trường của job (Supabase, Groq, DeepSeek…) đặt trong Trigger.dev Dashboard → Environment Variables.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? 'proj_set_TRIGGER_PROJECT_ID',
  dirs: ['./src/trigger'],
  runtime: 'node',
  maxDuration: 600,
  retries: { enabledInDev: true, default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, randomize: true } },
  build: {
    extensions: [
      ffmpeg(),   // tách âm thanh từ video trước khi gửi Groq
      // Các module dùng chung với Next.js có `import 'server-only'` (chỉ hợp lệ trong React Server).
      // Trong worker Node của Trigger.dev, thay bằng module rỗng.
      esbuildPlugin({
        name: 'server-only-shim',
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'ltt-shim' }));
          build.onLoad({ filter: /.*/, namespace: 'ltt-shim' }, () => ({ contents: 'export {}', loader: 'js' }));
        },
      }),
    ],
  },
});
