// 마이그레이션 142 운영 적용 — 공통 수기 프리셋 폐지에 따른 유형별 문구 이관
// 실행: node scripts/_apply-142-prod.mjs        (미리보기)
//       node scripts/_apply-142-prod.mjs --run  (적용, 토큰: %TEMP%/sbtok.txt)
//
// 왜 필요한가: 프리셋(_presets/{유형}.json → 생성 HTML 전역 문자열 치환)을 폐지했다.
//   상가형·공장형 문구가 코드에서 사라졌으므로, 라이브러리 항목으로 들어가 있지 않으면
//   그 유형 고객의 문서가 주택형(양식 기본값)으로 되돌아간다.
//
// 멱등: 전 INSERT가 WHERE NOT EXISTS (section_key, title) 가드라 재실행이 안전하다.
// is_default는 건드리지 않는다 — 자동주입 대상이 바뀌면 신규 고객 문서가 조용히 달라진다.
//
// ⚠ 139(holidays_source)는 여전히 건너뛴다(소방계획서_25 몫). 142는 139에 의존하지 않는다.
import { readFileSync } from 'fs'
import { join } from 'path'

const tokPath = join(process.env.TEMP, 'sbtok.txt')
let token
try { token = readFileSync(tokPath, 'utf8').trim() } catch {
  console.error(`토큰이 없습니다: ${tokPath} — scripts/_restore-sbtok.ps1로 복원하세요.`)
  process.exit(1)
}
const APPLY = process.argv.includes('--run')
const PROD = 'ryuozdhnilfjlahorizh'

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

// 이관 대상 6행이 들어갔는지 + ⭐기본이 흔들리지 않았는지(섹션당 최대 1개)
const TITLES = [
  '상가형 훈련 시나리오', '공장형 훈련 시나리오',
  '상가형 피난유도', '공장형 피난유도',
  '상가형 팀별임무(초기소화)', '공장형 팀별임무(초기소화)',
]
const STATE = `
  SELECT
    to_regclass('public.plan_text_library') IS NOT NULL AS table_exists,
    (SELECT count(*) FROM plan_text_library WHERE title IN (${TITLES.map(t => `'${t}'`).join(',')})) AS migrated,
    (SELECT count(*) FROM plan_text_library WHERE is_active) AS active_rows,
    (SELECT count(*) FROM plan_text_library WHERE is_active AND is_default) AS active_defaults,
    (SELECT coalesce(string_agg(section_key || ':' || title, ' | '), '(없음)')
       FROM plan_text_library WHERE is_active AND is_default) AS default_rows
`

const ok2xx = r => r.status >= 200 && r.status < 300
const before = await q(STATE)
if (!ok2xx(before)) { console.error('상태 조회 실패:', before.status, JSON.stringify(before.body)); process.exit(1) }
console.log('적용 전:', JSON.stringify(before.body[0], null, 1))

if (!before.body[0].table_exists) {
  console.error('\n❌ plan_text_library가 운영에 없습니다 — 선행 마이그레이션(119)이 미적용입니다. 중단.')
  process.exit(1)
}

// process.exit()는 대기 중인 fetch 핸들과 부딪혀 libuv assertion으로 죽는다(실측) — exitCode만 쓴다
if (!APPLY) {
  console.log('\n미리보기입니다 — 적용하려면 --run')
} else {
  const sql = readFileSync('supabase/migrations/142_plan_text_building_type_presets.sql', 'utf8')
  const r = await q(sql)
  if (!ok2xx(r)) {
    console.error(`❌ 142 적용 실패 — status ${r.status}`, JSON.stringify(r.body))
    process.exitCode = 1
  } else {
    console.log(`OK   142_plan_text_building_type_presets.sql — status ${r.status}`)

    const after = await q(STATE)
    const s = after.body[0]
    console.log('\n적용 후:', JSON.stringify(s, null, 1))

    const migratedOk = Number(s.migrated) === TITLES.length
    const defaultsOk = Number(s.active_defaults) <= 1
    const defaultUnchanged = s.default_rows === before.body[0].default_rows
    console.log(migratedOk ? `✅ 이관 ${s.migrated}/${TITLES.length}행` : `❌ 이관 ${s.migrated}/${TITLES.length}행`)
    console.log(defaultsOk ? '✅ 활성 ⭐기본 1개 이하(제약 유지)' : `❌ 활성 ⭐기본 ${s.active_defaults}개`)
    console.log(defaultUnchanged ? '✅ ⭐기본이 바뀌지 않았다' : `❌ ⭐기본이 바뀌었다: ${before.body[0].default_rows} → ${s.default_rows}`)
    process.exitCode = migratedOk && defaultsOk && defaultUnchanged ? 0 : 1
  }
}
