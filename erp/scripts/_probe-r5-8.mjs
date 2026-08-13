// R5-8 뒷부분 정적 검증 — ④에 기산 근거 표시 + 그 자리에서 종료일 수정
// 실행: node scripts/_probe-r5-8.mjs   (서버·DB 불필요, _probe-c1-blocks.mjs와 같은 방식)
import { readFileSync } from 'fs'

const tl = readFileSync('src/components/inspections/inspection-timeline-client.tsx', 'utf8')
const pg = readFileSync('src/app/(dashboard)/inspections/[id]/page.tsx', 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ④ 블록만 잘라낸다 — 기산 표시가 엉뚱한 단계에 붙어도 통과하는 일이 없도록
const s4start = tl.indexOf("has('submit9')")
const s4end = tl.indexOf("has('repair')")
const step4 = s4start > 0 && s4end > s4start ? tl.slice(s4start, s4end) : ''

console.log('\n— R5-8 ④ 기산 근거')
ok('④ 블록을 잘라낼 수 있다(검사 범위 확보)', step4.length > 500, `len=${step4.length}`)
ok('④ 안에 기산 근거가 표시된다', /기산:/.test(step4))
ok('기산 근거가 종료일 + 15일 = 기한을 모두 밝힌다',
  /종료일/.test(step4) && /\+ 15일/.test(step4) && /기한/.test(step4))
ok('종료일이 없으면 시작일 기산임을 밝히고 경고한다',
  /시작일/.test(step4) && /종료일 미지정/.test(step4))
ok("종전 고정 문구 '(점검 후 15일)'은 남지 않았다 — 기산일을 안 밝히던 표기",
  !/점검 후 15일/.test(tl))

console.log('\n— R5-8 ④에서 고치기')
ok('④ 안에 [종료일 고치기]가 있다', /종료일 고치기/.test(step4))
ok('④ 안에 날짜 입력·저장·취소가 있다',
  /DateInput[\s\S]{0,300}anchorEnd/.test(step4) && /saveAnchor/.test(step4) && /취소/.test(step4))
ok('수정은 canManage일 때만 노출된다', (step4.match(/canManage && anchorEdit/) ?? []).length > 0)
ok('저장은 ①과 같은 액션(updateInspectionMultidayAction)을 쓴다 — 두 자리가 갈라지지 않는다',
  /function saveAnchor\(\)[\s\S]{0,400}updateInspectionMultidayAction/.test(tl))
ok('일수는 기존 값을 보존한다(종료일만 고친다)',
  /function saveAnchor\(\)[\s\S]{0,400}days: data\.period\?\.days \?\? 1/.test(tl))
ok('저장 후 새로고침해 마감일 재계산 결과를 반영한다',
  /function saveAnchor\(\)[\s\S]{0,600}router\.refresh\(\)/.test(tl))

console.log('\n— 데이터 배선')
ok('TimelineData에 period 타입이 있다', /period\?: \{ start: string \| null; end: string \| null; days: number \}/.test(tl))
ok('page.tsx가 period를 실제로 채운다(start·end·days)',
  /period: \{[\s\S]{0,300}inspection_start_date[\s\S]{0,300}inspection_end_date[\s\S]{0,300}inspection_days/.test(pg))
ok('기한(due9)과 기산일이 같은 원천을 본다 — end 우선, 없으면 start',
  /const endDate = \(iRec\.inspection_end_date as string \| null\) \?\? \(iRec\.inspection_start_date as string \| null\)/.test(pg)
  && /const due9 = endDate \? addDays\(endDate, 15\) : null/.test(pg))

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
