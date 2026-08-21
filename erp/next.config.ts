import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false, // SEC-F: X-Powered-By 숨김
  // 갑지 워크북 템플릿(소방계획서_27) — standalone은 파일 추적 기반이라 fs로만 읽는 바이너리가
  // 번들에서 빠진다. 이 라우트에 명시로 딸려 보낸다 (번들 문서 output.md — 키는 라우트 경로).
  outputFileTracingIncludes: {
    '/inspections/[id]/workbook': ['./templates/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  // SEC-F: 보안 응답 헤더 (클릭재킹·MIME 스니핑·리퍼러 방어). HSTS는 프로덕션 HTTPS에서만 적용
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      ...(process.env.NODE_ENV === 'production'
        ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
        : []),
    ]
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
