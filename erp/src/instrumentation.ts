import type { Instrumentation } from 'next'

/** 관측 진입점 (통합 실행계획 A3, 2026-10-02) — Next instrumentation 규약(node_modules/next/dist/docs/01-app/02-guides/instrumentation.md)
 *
 *  서버(nodejs 런타임)에서만 Sentry를 켠다. 클라이언트 번들에는 아무것도 넣지 않는다 — 105~107회차에서 줄인
 *  세 화면 속도를 관측 때문에 되돌리지 않기 위해서다(브라우저 오류 수집은 뒤 단계에서 따로 결정).
 *  SENTRY_DSN이 없으면 init을 건너뛰고, 코드 곳곳의 Sentry.capture*는 조용히 무시된다(로컬·CI·DSN 발급 전 운영).
 *  환경 구분은 SENTRY_ENVIRONMENT(production·staging), 없으면 NODE_ENV. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.GIT_SHA || undefined,
    tracesSampleRate: 0,          // 성능 트레이스는 끈다 — 오류·크론 실패만 본다
    // 🚨 v11은 sendDefaultPii 대신 dataCollection이고 **기본값이 전부 수집**이다(헤더·쿠키·본문·쿼리·DB 바인딩 값·
    //    스택 지역변수). 관계인 이름·전화·주소가 서버 액션 인자와 쿼리 값으로 흐르므로 전부 끈다.
    //    오류 메시지·스택 위치·태그(job)만 보낸다.
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      databaseQueryData: false, queues: false, stackFrameVariables: false,
      genAI: { inputs: false, outputs: false }, graphQL: { document: false, variables: false },
    },
    maxBreadcrumbs: 20,
  })
}

/** 서버 렌더·라우트 핸들러·서버 액션에서 Next가 잡은 오류를 Sentry로. DSN이 없으면 no-op. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.SENTRY_DSN) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(err, request, context)
}
