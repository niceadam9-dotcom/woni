// 크론 인증 하드닝 — CRON_SECRET 미설정 시 무인증으로 열리던 조건을 닫는다 (2026-08-19)
// 실행: node scripts/_harden-cron-auth.mjs        (미리보기)
//       node scripts/_harden-cron-auth.mjs --run  (치환)
//
// 종전: if (cronSecret && authHeader !== `Bearer ${cronSecret}`)
//   → CRON_SECRET이 빠지는 순간 검사 자체가 사라져 **누구나 호출**할 수 있다.
//     이 엔드포인트들은 점검 자동 시작·알림 발송·활동로그 삭제·청구 생성 같은 실제 변경을 한다.
// 이후: if (!cronSecret || authHeader !== `Bearer ${cronSecret}`)  (sync-holidays가 이미 쓰는 규약)
//
// 영향 범위 실측(2026-08-19): CRON_SECRET은 .env.local·.env.production 양쪽에 설정돼 있고,
//   저장소 안의 호출자(test-*.mts·_ex-remain.mjs 등)는 전부 Authorization 헤더를 붙인다.
//   즉 지금 환경에서 이 변경으로 깨지는 호출은 없다.
//
// PowerShell 대신 node로 하는 이유: PS 5.1은 BOM 없는 UTF-8을 CP949로 읽어 한글을 깨뜨린다.
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const APPLY = process.argv.includes('--run')
const ROOT = join(process.cwd(), 'src', 'app', 'api', 'cron')

const ROUTES = [
  'auto-start-inspections', 'convert-fireplan-pdf', 'defect-action-notify',
  'generate-monthly-bills', 'generate-yearly-plans', 'inspection-deadline-notify',
  'insurance-expiry-notify', 'law-revision-check', 'purge-activity-logs',
  'weekly-doc-briefing',
]

const OLD = '  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {'
const NEW = [
  '  // CRON_SECRET이 없으면 검사를 통째로 건너뛰던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 —',
  '  // 값이 빠지는 순간 이 엔드포인트가 누구에게나 열린다. 미설정이면 아예 거부한다(sync-holidays와 동일 규약).',
  '  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {',
].join('\n')

let changed = 0, already = 0, missing = []
for (const r of ROUTES) {
  const p = join(ROOT, r, 'route.ts')
  const src = readFileSync(p, 'utf8')
  if (src.includes('if (!cronSecret || authHeader !==')) { already++; console.log(`  = ${r} (이미 적용)`); continue }
  if (!src.includes(OLD)) { missing.push(r); console.log(`  ? ${r} — 예상 패턴 없음(수동 확인 필요)`); continue }
  const out = src.replace(OLD, NEW)
  if (APPLY) writeFileSync(p, out, 'utf8')
  changed++
  console.log(`  ${APPLY ? '✔' : '·'} ${r}`)
}

console.log(`\n대상 ${ROUTES.length} · ${APPLY ? '치환' : '치환 예정'} ${changed} · 이미 적용 ${already} · 패턴 불일치 ${missing.length}`)
if (missing.length > 0) console.log(`  ⚠ 수동 확인: ${missing.join(', ')}`)
if (!APPLY) console.log('\n미리보기입니다. 적용하려면 --run 을 붙이세요.')
