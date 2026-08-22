// F-1f 착수 선행 조건 — 운영·스테이징 양쪽에서 조기진압·할론 실태 실측 (읽기 전용).
// ① 설치 고객 ② 묶음 시트에 걸린 응답 ③ STD-05·STD-10 시트 부재 확인(150 적용 전제)
import { readFileSync } from 'fs'
import { join } from 'path'

const token = readFileSync(join(process.env.TEMP, 'sbtok.txt'), 'utf8').trim()
const q = async (ref, query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`${ref} ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r.json()
}

const INSTALLED = `
SELECT c.customer_name, f.facility_code
  FROM fire_facilities f
  JOIN buildings b ON b.id = f.building_id
  JOIN customers c ON c.id = b.customer_id
 WHERE f.installed AND f.facility_code IN ('화재조기진압용 스프링클러설비', '할론소화설비')
 ORDER BY 2, 1`

const RESPONSES = `
SELECT c.customer_name, i.year, i.status, s.sheet_code, s.sheet_name, count(*) AS n
  FROM inspection_sheet_responses r
  JOIN inspections i ON i.id = r.inspection_id
  JOIN customers c ON c.id = i.customer_id
  JOIN inspection_sheet_items it ON it.item_code = r.item_code
  JOIN inspection_sheets s ON s.id = it.sheet_id
 WHERE s.sheet_name IN ('스프링클러설비', '할로겐화합물 및 불활성기체소화설비')
   AND c.id IN (
     SELECT b2.customer_id FROM fire_facilities f2
       JOIN buildings b2 ON b2.id = f2.building_id
      WHERE f2.installed AND f2.facility_code IN ('화재조기진압용 스프링클러설비', '할론소화설비'))
 GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2`

const SHEET_GAP = `
SELECT sheet_code, sheet_name FROM inspection_sheets
 WHERE sheet_code IN ('STD-05', 'STD-10') ORDER BY 1`

// 한글 술어가 조용히 0건을 주는 환경 오류를 배제하는 대조군 — 이게 0이면 위 결과도 못 믿는다
const CANARY = `
SELECT count(*) AS n FROM fire_facilities WHERE facility_code = '옥내소화전설비' AND installed`

for (const [label, ref] of [['운영', 'ryuozdhnilfjlahorizh'], ['스테이징', 'nwflnzugwylhpdyodyog']]) {
  console.log(`\n===== [${label}] =====`)
  const canary = await q(ref, CANARY)
  console.log(`  대조군(옥내소화전 설치 행): ${canary[0]?.n ?? '?'}건 ${Number(canary[0]?.n) > 0 ? '' : '⚠ 한글 술어 실패 의심 — 이하 무효'}`)
  const inst = await q(ref, INSTALLED)
  console.log(`  조기진압·할론 설치: ${inst.length}행`)
  for (const r of inst) console.log(`    · ${r.customer_name} — ${r.facility_code}`)
  const resp = await q(ref, RESPONSES)
  console.log(`  해당 고객의 묶음 시트 응답: ${resp.length}행`)
  for (const r of resp) console.log(`    · ${r.customer_name} ${r.year}(${r.status}) [${r.sheet_code}] ${r.sheet_name} — ${r.n}건`)
  const gap = await q(ref, SHEET_GAP)
  console.log(`  STD-05·STD-10 존재: ${gap.length}행 ${gap.length === 0 ? '(부재 확인 — 150 시딩 전제 성립)' : JSON.stringify(gap)}`)
}
