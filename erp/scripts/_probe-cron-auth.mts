/** 크론 엔드포인트 인증 — 전 라우트가 무자격 호출을 거부하는가 (2026-08-19)
 *  실행: npx tsx scripts/_probe-cron-auth.mts
 *
 *  왜: 종전 조건이 `if (cronSecret && authHeader !== …)`라 **CRON_SECRET이 없으면 검사 자체가
 *  사라졌다**. 이 엔드포인트들은 점검 자동 시작·알림 발송·활동로그 삭제·청구 생성 같은 실제
 *  변경을 하므로, 열려 있으면 외부에서 아무나 그 일을 시킬 수 있다.
 *
 *  이 프로브가 지키는 것은 **목록 전체**다. 라우트를 새로 추가하면서 옛 패턴을 복붙하면
 *  그 하나만 조용히 열린다 — 그래서 파일 시스템에서 라우트를 훑어 자동으로 대상에 넣는다.
 *
 *  ⚠ 인증 통과 경로는 부르지 않는다. 진짜로 실행되면 알림이 나가고 로그가 지워진다.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CRON_DIR = join(process.cwd(), 'src', 'app', 'api', 'cron')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const routes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort()

console.log(`크론 라우트 ${routes.length}개 발견\n`)

// ── ① 소스 규약 — 미설정 시 거부하는 형태인가 ────────────────
console.log('— 소스: CRON_SECRET 미설정이면 거부하는 형태인가')
for (const r of routes) {
  const src = readFileSync(join(CRON_DIR, r, 'route.ts'), 'utf8')
  const hardened = /if \(!cronSecret \|\| /.test(src)
  const legacy = /if \(cronSecret && /.test(src)
  check(`${r} — !cronSecret || 형태`, hardened && !legacy,
    legacy ? '옛 형태(cronSecret &&)가 남아 있다 — 값이 빠지면 열린다' : '인증 분기를 찾지 못했다')
}

// ── ② 런타임 — 헤더 없이/틀린 값으로 부르면 401 ──────────────
console.log('\n— 런타임: 무자격 호출은 401')
for (const r of routes) {
  const url = `${BASE}/api/cron/${r}`
  try {
    const noHeader = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    check(`${r} — 헤더 없음 → 401`, noHeader.status === 401, `HTTP ${noHeader.status}`)

    const badHeader = await fetch(url, {
      headers: { Authorization: 'Bearer wrong-secret-probe' },
      signal: AbortSignal.timeout(30_000),
    })
    check(`${r} — 틀린 토큰 → 401`, badHeader.status === 401, `HTTP ${badHeader.status}`)
  } catch (e) {
    // 타임아웃도 실패로 본다 — 401이면 즉시 끝나야 한다. 오래 걸린다는 건 인증 전에 일을 했다는 뜻이다
    check(`${r} — 무자격 호출 응답`, false, (e as Error).message)
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
