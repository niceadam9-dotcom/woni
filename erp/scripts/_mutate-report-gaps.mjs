// 변이 — test-report-gaps가 급소를 실제로 무는가 (2026-09-23). 실행: node scripts/_mutate-report-gaps.mjs
// 각 변이는 **정확히 1건** 치환돼야 한다(0건이면 변이가 안 돈 채 초록 — CRLF 함정). 끝나면 원본 복원.
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const NOTICE = 'src/lib/workbook-notice.ts'
const ROUTE = 'src/app/(dashboard)/customers/[id]/report-gaps/route.ts'
const COMP = 'src/components/customers/report-gaps.tsx'
const PAGE = 'src/app/(dashboard)/customers/[id]/page.tsx'
const M = [
  // ⚠ M1은 **동등 변이**다(2026-09-23 실측 생존) — 회차·본사 목적지(sheet·period·org…)는 TAB_OF_TARGET에
  //   애초에 없어 scope 필터가 없어도 같은 답이 나온다. 필터는 겹친 방어로 남긴다(표에 회차 목적지를
  //   실수로 넣는 날을 위해). 생존이 곧 구멍은 아니다 — 그 날은 ⑤의 「회차 축 목적지는 탭이 없다」가 문다.
  ['M1 고객 축 필터 제거(회차·본사가 탭에 샌다) — 동등 변이', NOTICE, "p.kind !== 'fixable' || p.scope !== 'customer' || !p.target", "p.kind !== 'fixable' || !p.target"],
  ['M2 공통 1.1 매핑 삭제', NOTICE, "  common11: 'facilities',\n", ''],
  ['M3 되감기 없음', NOTICE, ': [...REPORT_INPUT_TABS.slice(i + 1), ...REPORT_INPUT_TABS.slice(0, i)]', ': [...REPORT_INPUT_TABS.slice(i + 1)]'],
  ['M4 중복 제거 없음', NOTICE, '    if (seen.has(`${tab}|${short}`)) continue\n', ''],
  ['M5 송달 동의 목적지 되돌림', NOTICE, "{ test: /^송달 동의$/, kind: 'fixable', target: 'common11'", "{ test: /^송달 동의$/, kind: 'fixable', target: 'info'"],
  ['M6 회차 없음을 0으로', ROUTE, 'byTab: null })', 'byTab: groupReportGaps([]) })'],
  ['M7 남의 회차 대조 삭제', ROUTE, ".eq('id', inspectionId).eq('customer_id', customerId)", ".eq('id', inspectionId)"],
  ['M8 실패를 0으로 그림', COMP, 'if (!j) { setState(s => ({ ...s, loaded: true })); return }', "if (!j) { setState({ byTab: groupEmpty(), roundLabel: null, loaded: true }); return }"],
  ['M10 예정만 된 현재 회차에 막힘(대체 회차 없음)', ROUTE, 'downloadableInspectionId(cur) ? cur : (rounds.find(r => downloadableInspectionId(r)) ?? null)', 'cur'],
  ['M9 ←가 목록 고정', PAGE, "href={returnHref || '/customers'}", 'href="/customers"'],
]
let red = 0
for (const [name, file, a, b] of M) {
  const orig = readFileSync(file, 'utf8')
  const eol = orig.includes('\r\n') ? '\r\n' : '\n'
  const A = a.replaceAll('\n', eol), B = b.replaceAll('\n', eol)
  const n = orig.split(A).length - 1
  if (n !== 1) { console.log(`⚠ ${name}: 치환 ${n}건 — 변이 무효`); continue }
  writeFileSync(file, orig.replace(A, B))
  let failed = false
  try { execSync('npx tsx scripts/test-report-gaps.mts', { stdio: 'pipe' }) } catch { failed = true }
  finally { writeFileSync(file, orig) }
  if (failed) red++
  console.log(`${failed ? '🔴 잡힘' : '🟢 생존'}  ${name}`)
}
console.log(`\n변이 ${red}/${M.length} 잡힘`)
