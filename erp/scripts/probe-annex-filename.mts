/** 별지 저장명 규약 프로브 (사용자 확정 규약, 2026-08-20)
 *    4호  {생성연도}_소방시설_{작동|종합}점검 결과보고서_{고객명}
 *    9호  {생성연도}_소방시설등 자체점검_실시결과보고서_{고객명}   (작동·종합 동일)
 *    그 외 종전 규약 {고객명}_{문서명}_{YYYY-MM-DD}
 *  실행: npx tsx scripts/probe-annex-filename.mts */
import { annexDownloadName, annexSubType, annexDocUrl } from '../src/lib/annex-filename.js'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`${ok ? '✅' : '❌'} ${name}\n     got  ${String(got)}${ok ? '' : `\n     want ${String(want)}`}`)
}

const CUST = '승진빌딩'
const AT = '2026-08-19T04:05:06.000Z'

/* ── 별지 4호 — 작동/종합 분기 ── */
eq('4호 PDF · 작동(자체)',
  annexDownloadName({ kind: 'report4', ext: 'pdf', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '2026_소방시설_작동점검 결과보고서_승진빌딩.pdf')
eq('4호 HWP · 작동(자체)',
  annexDownloadName({ kind: 'report4', ext: 'hwp', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '2026_소방시설_작동점검 결과보고서_승진빌딩.hwp')
eq('4호 PDF · 종합(자체)',
  annexDownloadName({ kind: 'report4', ext: 'pdf', customerName: CUST, inspectionType: '종합', planType: 'special_종합', createdAt: AT }),
  '2026_소방시설_종합점검 결과보고서_승진빌딩.pdf')

/* plan_type이 유형과 어긋나면 plan_type(회차 성격)이 이긴다 — 배지(inspectionNatureBadge)와 같은 축 */
eq('4호 · 고객은 종합인데 이 회차는 작동 → 작동',
  annexDownloadName({ kind: 'report4', ext: 'pdf', customerName: CUST, inspectionType: '종합', planType: 'special_작동', createdAt: AT }),
  '2026_소방시설_작동점검 결과보고서_승진빌딩.pdf')
/* 레거시 자체점검(plan_type null) — 일반관리는 작동점검으로 본다 */
eq('4호 · 일반관리 레거시(plan_type null) → 작동',
  annexDownloadName({ kind: 'report4', ext: 'pdf', customerName: CUST, inspectionType: '일반관리', planType: null, createdAt: AT }),
  '2026_소방시설_작동점검 결과보고서_승진빌딩.pdf')
eq('4호 · 종합 레거시(plan_type null) → 종합',
  annexDownloadName({ kind: 'report4', ext: 'pdf', customerName: CUST, inspectionType: '종합', planType: null, createdAt: AT }),
  '2026_소방시설_종합점검 결과보고서_승진빌딩.pdf')

/* ── 별지 9호 — 작동·종합 동일 ── */
eq('9호 PDF · 작동',
  annexDownloadName({ kind: 'report9', ext: 'pdf', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '2026_소방시설등 자체점검_실시결과보고서_승진빌딩.pdf')
eq('9호 HWP · 종합 (문구 동일)',
  annexDownloadName({ kind: 'report9', ext: 'hwp', customerName: CUST, inspectionType: '종합', planType: 'special_종합', createdAt: AT }),
  '2026_소방시설등 자체점검_실시결과보고서_승진빌딩.hwp')

/* ── 연도 축 = 문서 생성일 (점검 연도가 아니다) ── */
eq('9호 · 해 넘겨 재생성하면 그 해가 붙는다',
  annexDownloadName({ kind: 'report9', ext: 'pdf', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: '2027-01-04T00:00:00.000Z' }),
  '2027_소방시설등 자체점검_실시결과보고서_승진빌딩.pdf')

/* ── 나머지 별지는 종전 규약 유지 ── */
eq('10호 · 종전 규약',
  annexDownloadName({ kind: 'report10', ext: 'hwp', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '승진빌딩_이행계획서_2026-08-19.hwp')
eq('11호 · 종전 규약',
  annexDownloadName({ kind: 'report11', ext: 'pdf', customerName: CUST, inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '승진빌딩_이행완료 보고서_2026-08-19.pdf')
eq('외관점검표 · 종전 규약',
  annexDownloadName({ kind: 'exterior', ext: 'pdf', customerName: CUST, inspectionType: '일반관리', planType: 'monthly', createdAt: AT }),
  '승진빌딩_외관점검표_2026-08-19.pdf')

/* ── 파일명 금지 문자 ── */
eq('고객명에 슬래시·콜론이 있어도 파일명이 깨지지 않는다',
  annexDownloadName({ kind: 'report9', ext: 'pdf', customerName: 'A/B:C*D', inspectionType: '작동', planType: 'special_작동', createdAt: AT }),
  '2026_소방시설등 자체점검_실시결과보고서_A_B_C_D.pdf')

/* ── 작동/종합 축 단독 ── */
eq('annexSubType · special_종합', annexSubType('작동', 'special_종합'), '종합')
eq('annexSubType · 폴백', annexSubType(null, null), '작동')

/* ── URL 빌더: 전체 경로를 줘도 파일명만 나간다(경로 노출·조작 없음) ── */
eq('annexDocUrl · 전체 경로 입력',
  annexDocUrl('11111111-2222-3333-4444-555555555555', 'cust-id/inspections/insp-id/report9_1755831234.pdf'),
  '/inspections/11111111-2222-3333-4444-555555555555/doc?file=report9_1755831234.pdf')

/* ── 원천이 하나인지 — 별지 저장명을 손으로 조립하는 곳이 또 생기면 여기서 잡는다.
      종전에 이름이 5곳(문서 현황·생성물 목록·자동완성·최신본 액션·메일 첨부)에서 따로 만들어져
      같은 문서가 화면마다 다른 이름으로 저장됐다. ── */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
})
/** 손으로 조립한 별지 저장명의 흔적 — 이 문자열들은 annex-filename.ts 안에만 있어야 한다 */
const BANNED = ['_실시결과 보고서_', '_소방시설등점검표_', '_자체점검결과보고서', '소방시설등 자체점검_실시결과보고서', '점검 결과보고서_']
// lib/message-template.ts는 **관계인 메일 첨부명의 사용자 편집 기본값**이라 축이 다르다.
// 실제로 쓰이는 값은 DB의 message_templates.attachment_name 행이고, 그게 코드 기본값을 이긴다 —
// 즉 여긴 코드를 고쳐도 안 바뀐다. 다운로드 규약과 맞추려면 설정 화면(또는 DB)에서 바꿔야 한다.
const TEMPLATE_DEFAULTS = join('lib', 'message-template.ts')
const offenders: string[] = []
for (const f of walk(SRC)) {
  if (f.endsWith(join('lib', 'annex-filename.ts')) || f.endsWith(TEMPLATE_DEFAULTS)) continue
  const body = readFileSync(f, 'utf8')
  for (const b of BANNED) if (body.includes(b)) offenders.push(`${f.slice(SRC.length)} :: ${b}`)
}
eq('별지 저장명 조립은 annex-filename.ts 한 곳뿐', offenders.join(' | ') || '(없음)', '(없음)')

console.log(`\n${fail === 0 ? '✅ 전건 통과' : '❌ 실패 있음'} — ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
