/** 변이 실험 — 새 검사가 **실제로 무는지** 잰다. 4차 독립 판정이 종전 프로브를 이 방법으로
 *  반증했다(37 변이 중 24개 초록). 초록은 물린다는 증거가 아니므로 스스로 같은 실험을 한다.
 *
 *  격리 워크트리에서만 돌린다(공유 트리 금지). 변이 → 프로브 실행 → 원복.
 *  실행: node scripts/_45-mutate.mjs   (워크트리의 erp/ 안에서) */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** 4차 판정이 「초록이었다」고 보고한 변이들을 그대로 재현한다 */
const MUTATIONS = [
  // J16 A2 — DB에 completed를 쓰게 하던 바로 그 가드
  ['A2 hasSheetDefect의 축 가드 삭제', 'src/lib/inspection-step-status.ts',
    /  if \(e\.axisIncomplete\) return true\n  return e\.defectsTotal > 0/, '  return e.defectsTotal > 0'],
  // J16 A2b — 형제 함수의 같은 줄(종전엔 서로의 문자열로 공허 통과)
  ['A2b isForced5Void의 축 가드 삭제', 'src/lib/inspection-step-status.ts',
    /  if \(e\.axisIncomplete\) return true\n  if \(\(e\.unregisteredX/, '  if ((e.unregisteredX'],
  // J16 A1 — 타입에서 축만 제거
  ['A1 StepEvidence의 축 필드를 선택으로', 'src/lib/inspection-step-status.ts',
    /  axisIncomplete: boolean \| undefined\n  \/\*\* ⑥/, '  axisIncomplete?: boolean\n  /** ⑥'],
  // J16 C5 — 「전체」 보기를 range 단발로 원복
  ['C5 「전체」를 range 단발로 원복', 'src/app/(dashboard)/inspections/page.tsx',
    /: fetchAllRows<Record<string, unknown>>\(\(f, t\) => query\n {10}\.order\('created_at', \{ ascending: false \}\)\.order\('id'\)\.range\(f, t\)\)\n {10}\.then\(r => \(\{ data: r\.rows as unknown\[\], count: r\.rows\.length, truncated: !!r\.error \|\| r\.truncated \}\)\),/,
    ": query.order('created_at', { ascending: false }).range(from, 99999)\n          .then(r => ({ data: r.data as unknown[] | null, count: r.count ?? null, truncated: false })),"],
  // J16 B1 — 「셋 중 둘」 재현(목록)
  ['B1 목록: 3개 중 하나를 맨몸으로', 'src/app/(dashboard)/inspections/page.tsx',
    /fetchAllRowsByIds<\{ inspection_id: string \}, string>\(ids, \(c, from, to\) => admin\.from\('inspection_defects'\)\n {8}\.select\('inspection_id'\)\.in\('inspection_id', c\)\.order\('id'\)\.range\(from, to\)\),/,
    "fetchAllRows<{ inspection_id: string }>((from, to) => admin.from('inspection_defects')\n        .select('inspection_id').in('inspection_id', ids).order('id').range(from, to)),"],
  // J16 C2 — 「셋 중 둘」 재현(공용 모듈)
  ['C2 공용 모듈: 3개 중 하나를 맨몸으로', 'src/lib/active-steps.ts',
    /fetchAllRowsByIds<\{ inspection_id: string \}, string>\(ids, \(c, from, to\) => admin\n {6}\.from\('inspection_defects'\)/,
    "fetchAllRows<{ inspection_id: string }>((from, to) => admin\n      .from('inspection_defects')"],
  // J16 B4 — 사이드바 차감 제거(영구 빨강 복귀), import는 유지
  ['B4 사이드바 차감 제거(호출문은 유지)', 'src/app/(dashboard)/layout.tsx',
    /redCount: Math\.max\(0, \(redRes\.count \?\? 0\) - naCount\(redNaRes\.rows\)\),/,
    'redCount: redRes.count ?? 0,'],
  // J16 W2 — 회차 카드 sheetX 인자 제거(어느 검사도 안 덮던 자리)
  ['W2 회차 카드 sheetX 인자 제거', 'src/components/customers/plan-annex-round-card.tsx',
    /sheetX: r\.docs\.sheetX, /, ''],
  // J16 A11 / B8 — 청크 상수를 벽 위로
  ['A11 IN_CHUNK_SIZE를 1500으로', 'src/lib/supabase/paginate.ts',
    /IN_CHUNK_SIZE = 150/, 'IN_CHUNK_SIZE = 1500'],
  // 4차 판정 신규 결함 재현 — 작업대가 축을 버림
  ['R1 작업대가 축을 다시 버림', 'src/components/inspections/inspection-workbench.tsx',
    /defectsTotal: defectStat\.total, sheetX, axisIncomplete: data\.evidence\?\.axisIncomplete,/,
    'defectsTotal: defectStat.total, sheetX,'],
  // 4차 R-8 재현 — 모바일이 6행을 그대로 셈
  ['R8 모바일이 6행을 그대로 셈', '../mobile/app/(app)/inspections/[id].tsx',
    /\{visibleSteps\.filter\(s => s\.status === 'completed'\)\.length\}\/\{visibleSteps\.length\}/,
    "{steps.filter(s => s.status === 'completed').length}/{steps.length}"],
  // 4차 R-2 재현 — 크론 멱등 조회를 다시 무분할로
  ['R2 크론 멱등 조회를 무분할로', 'src/app/api/cron/inspection-deadline-notify/route.ts',
    /fetchAllRowsByIds<\{ reference_id: string \| null \}, string>\(\n {6}stepIds, \(c, from, to\) => admin/,
    "fetchAllRows<{ reference_id: string | null }>((from, to) => admin"],
]

function run() {
  try {
    const out = execFileSync('node', ['scripts/_probe-45-neighbors.mjs'], { encoding: 'utf8' })
    return { rc: 0, tail: (out.match(/결과: .*/) ?? [''])[0] }
  } catch (e) {
    const out = (e.stdout ?? '') + (e.stderr ?? '')
    return { rc: e.status ?? 1, tail: (out.match(/결과: .*/) ?? [''])[0] }
  }
}

const base = run()
console.log(`기준선(변이 없음): rc=${base.rc} · ${base.tail}\n`)
console.log('| 변이 | 적용됨 | 결과 | 판정 |')
console.log('|---|---|---|---|')

let bit = 0, miss = 0, notApplied = 0
for (const [name, file, re, repl] of MUTATIONS) {
  const before = readFileSync(file, 'utf8')
  const after = before.replace(re, repl)
  if (after === before) { notApplied++; console.log(`| ${name} | ❌ **패턴 불일치** | — | ⚠측정불가 |`); continue }
  writeFileSync(file, after, 'utf8')
  const r = run()
  writeFileSync(file, before, 'utf8')
  const red = r.rc !== 0
  if (red) bit++; else miss++
  console.log(`| ${name} | ✔ | ${r.tail} | ${red ? '✅ 문다' : '🚨 **무는 척**'} |`)
}

console.log(`\n문다 ${bit} · 무는 척 ${miss} · 측정불가 ${notApplied} / 총 ${MUTATIONS.length}`)
const after = run()
console.log(`원복 확인: rc=${after.rc} · ${after.tail}`)
process.exit(miss > 0 ? 1 : 0)
