import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  // The frontend SPA (public/index.html, synced by `npm run spa:sync`) is the home page.
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/index.html' }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
