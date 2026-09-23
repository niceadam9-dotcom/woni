/** 고객 화면 「그룹 단위 정렬」 + 핵심 칸 강조 — 등록 화면 · 기본정보 탭 (2026-09-23)
 *  실행: npx tsx scripts/test-customer-new-layout.mts   — **서버·DB 불필요**
 *
 *  사용자 요청(한 날 여러 번에 걸쳐 다듬어진 최종형):
 *   「산만하게 조회되지 않게 — 그룹 단위로 묶어서 정렬(기본정보·건물·시설·관계인)」
 *   「고객명·담당직원 처음 입력」 「사용승인일·점검일자는 중요하니 눈에 띄게 디자인」 「오른쪽 공간을 넓게」
 *
 *  여기서 지키는 것:
 *   ① 첫 커서는 고객명 · 주소 검색이 **이미 친 고객명을 덮지 않는다**(고객명이 첫 칸이면 이름부터 친다)
 *   ② 등록 화면 = ①기본정보 ②건물·시설 ③관계인 **세 그룹 상자**, 이 순서. 첫 줄 = 고객명 | 담당직원
 *   ③ ★ 기준일(사용승인일·점검일자)은 **강조 줄(accent)** 안에, 큰 칸(keyInputCls), 역할 배지(기산점/참고)
 *   ④ 배지 판정은 `anchorRoles` → `resolveAnchor` **한 벌** — 값으로 3상태를 돌려 본다
 *   ⑤ 격자 폭은 span 1·2·3·4만 · 열 수는 **상자 폭**(컨테이너 쿼리)으로 — 상세 탭은 요약 패널 옆이라 좁다
 *   ⑥ 기본정보 탭도 같은 부품 · 첫 줄 고객명 | 담당(슬롯) · 법정 시기 배지가 기준일 줄 안 · wideKeys로 넓게
 */
import { readFileSync } from 'node:fs'
import { codeOnly } from './_code-only.mts'
import { anchorRoles } from '../src/lib/anchor-role.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (p: string) => codeOnly(readFileSync(new URL(p, import.meta.url), 'utf8'))
const src = read('../src/components/customers/customer-new-client.tsx')
const jsx = src.slice(Math.max(0, src.indexOf('  return (\n    <form')))
const info = read('../src/components/customers/edit-customer-info-client.tsx')
const infoJsx = info.slice(Math.max(0, info.indexOf('  return (\n    <form')))
const kf = read('../src/components/customers/key-fields.tsx')
const tabs = read('../src/components/customers/customer-tabs.tsx')
const page = read('../src/app/(dashboard)/customers/[id]/page.tsx')

/** 순서 단언 — 표식들이 이 순서로 나오는가 */
const inOrder = (text: string, marks: Array<[string, string]>) => {
  const at = marks.map(([n, m]) => [n, text.indexOf(m)] as const)
  const missing = at.filter(([, i]) => i < 0).map(([n]) => n)
  const bad: string[] = []
  for (let k = 1; k < at.length; k++) if (at[k - 1][1] >= 0 && at[k][1] >= 0 && !(at[k - 1][1] < at[k][1])) bad.push(`${at[k - 1][0]} ≮ ${at[k][0]}`)
  return { missing, bad }
}
/** 표식 m이 들어 있는 **소그룹 줄(SubRow)** 의 여는 태그 */
const subRowOf = (text: string, m: string) => {
  const i = text.indexOf(m)
  const s = text.lastIndexOf('<SubRow', i)
  return s < 0 ? '' : text.slice(s, text.indexOf('>', s) + 1)
}

console.log('— ① 첫 커서 · 이름 덮기 가드')
ok('★ 고객명 칸에 autoFocus', /id="new-customer-name"\s*\n\s*ref=\{customerNameRef\}\s*\n\s*autoFocus\b/.test(jsx))
ok('autoFocus는 하나뿐', (jsx.match(/\bautoFocus\b/g) ?? []).length === 1)
{
  const i = src.indexOf('function handleAddressSearch()')
  const body = i > 0 ? src.slice(i, src.indexOf('checkAddressAction(data.roadAddress)', i)) : ''
  ok('판정은 칸의 **현재값**(ref)', /const typedName = \(customerNameRef\.current\?\.value \?\? ''\)\.trim\(\)/.test(body))
  ok('★ 친 이름이 있으면 건물명을 뽑지 않는다', /const building = typedName \? '' : extractBuildingName\(data\.roadAddress\)/.test(body))
  ok('★ setForm도 비었을 때만', /customer_name: prev\.customer_name\.trim\(\) \? prev\.customer_name : building/.test(body))
}

console.log('\n— ② 등록 화면 = 세 그룹 상자, 이 순서')
{
  const { missing, bad } = inOrder(jsx, [
    ['① 기본정보', 'title="기본정보"'], ['고객명', 'id="new-customer-name"'], ['담당직원', 'id="new-assignee"'],
    ['사용승인일', 'id="new-use-approval"'], ['점검일자', 'id="new-anchor-date"'], ['점검유형', 'name="inspection_category"'],
    ['주소', 'id="new-address"'], ['② 건물·시설', 'title="건물·시설"'], ['건물용도', 'ariaLabel="건물용도"'],
    ['③ 관계인', 'title="관계인"'], ['대표', 'id="contact-대표-name"'], ['비고', 'id="new-notes"'], ['하단 바', 'data-testid="new-submit-bar"'],
  ])
  ok('표식이 전부 있다', missing.length === 0, missing.join(', '))
  ok('★ 순서: ①(고객명·담당·사용승인일·점검일자·유형·주소) → ②(용도) → ③(대표·비고) → 하단 바', bad.length === 0, bad.join(' · '))
  ok('★ 첫 줄 = 고객명 | 담당직원 (같은 소그룹 줄)', () => {
    const a = jsx.indexOf('id="new-customer-name"'), b = jsx.indexOf('id="new-assignee"')
    return a > 0 && b > a && !jsx.slice(a, b).includes('<SubRow')
  })
  ok('그룹 상자는 정확히 셋', (jsx.match(/<GroupBox\b/g) ?? []).length === 3)
  ok('접이(④ 추가 정보)가 없다 — 넓게 쓰니 다 펼친다', !/showOptional|new-optional-toggle/.test(src))
  ok('읽기전용 우편번호·지번 입력칸이 없다', !/readOnly/.test(jsx) && /data-testid="new-address-meta"/.test(jsx))
  ok('하단 바 sticky', /data-testid="new-submit-bar"\s*\n\s*className="sticky bottom-0/.test(jsx))
  ok('칩 순서 = 화면 순서', () => {
    const m = src.match(/const requiredChecks[\s\S]*?\n  \]/)
    const items = m ? [...m[0].matchAll(/\n\s*\['([^']+)'/g)].map(x => x[1]) : []
    return JSON.stringify(items) === JSON.stringify(['고객명', '주소', '사용승인일', '점검일자', '점검유형', '대표 관계인'])
  })
}

console.log('\n— ③ ★ 기준일 강조 (등록)')
ok('★ 두 날짜가 **강조 줄(accent)** 안', /\baccent\b/.test(subRowOf(jsx, 'id="new-use-approval"'))
  && subRowOf(jsx, 'id="new-use-approval"') === subRowOf(jsx, 'id="new-anchor-date"'))
ok('★ 두 날짜 칸이 큰 칸(keyInputCls)', ['new-use-approval', 'new-anchor-date'].every(id => {
  const i = jsx.indexOf(`id="${id}"`); return i > 0 && /keyInputCls/.test(jsx.slice(i, i + 300))
}))
ok('★ 역할 배지가 두 칸에 (anchorRoles 판정)', /RoleBadge role=\{roles\.approval\}/.test(jsx) && /RoleBadge role=\{roles\.plan\}/.test(jsx)
  && /const roles = anchorRoles\(/.test(src))
ok('배지 판정 입력에 예외 스위치(anchorManual)가 들어간다 — 사용자가 「점검일자 쓰기」를 켜면 배지도 따라간다',
  /plan_anchor_manual: anchorManual/.test(src.slice(src.indexOf('const roles = anchorRoles('))))
ok('고객명도 큰 칸', (() => { const i = jsx.indexOf('id="new-customer-name"'); return /keyInputCls/.test(jsx.slice(i, i + 700)) })())
ok('빈 필수칸 강조(emptyRequiredCls)가 필수 칸들에 걸린다', (jsx.match(/emptyRequiredCls/g) ?? []).length >= 5)

console.log('\n— ④ ★ 배지 판정 = resolveAnchor (값으로)')
{
  const A = '2015-05-20', P = '2026-09-24'
  const r1 = anchorRoles({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: false })
  ok('사용승인일 있음 · 예외 끔 → 사용승인일=기산점, 점검일자=참고', r1.approval === 'anchor' && r1.plan === 'reference', JSON.stringify(r1))
  const r2 = anchorRoles({ use_approval_date: null, plan_anchor_date: P, plan_anchor_manual: false })
  ok('사용승인일 없음 → 점검일자=기산점(잠정), 사용승인일=빈칸', r2.approval === 'empty' && r2.plan === 'anchor', JSON.stringify(r2))
  const r3 = anchorRoles({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: true })
  ok('★ 예외 켬(manual) → 점검일자=기산점, 사용승인일=참고', r3.approval === 'reference' && r3.plan === 'anchor', JSON.stringify(r3))
  const r4 = anchorRoles({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: null })
  ok('레거시(manual=null) → 점검일자가 이긴다(코드가 실제로 하는 그대로)', r4.plan === 'anchor' && r4.approval === 'reference', JSON.stringify(r4))
  const r5 = anchorRoles({ use_approval_date: null, plan_anchor_date: null, plan_anchor_manual: false })
  ok('둘 다 없음 → 배지 없음', r5.approval === 'empty' && r5.plan === 'empty')
}

console.log('\n— ⑤ 격자 규칙 (공용 부품)')
ok('Cell 폭은 span 1·2·3·4 넷뿐', /span\?: 1 \| 2 \| 3 \| 4/.test(kf) && /const SPAN: Record<1 \| 2 \| 3 \| 4, string>/.test(kf))
ok('★ 열 수는 상자 폭(@container)으로 — 화면 폭 아님', /@container/.test(kf) && /@4xl:grid-cols-4/.test(kf) && !/\bxl:grid-cols-4/.test(kf))
ok('등록·기본정보 JSX가 Cell에 span 1·2·3·4 외 값을 쓰지 않는다', () => {
  const spans = [...(jsx + infoJsx).matchAll(/<Cell[^>]*?\bspan=\{(\d+)\}/g)].map(m => +m[1])
  return spans.length > 0 && spans.every(n => n >= 1 && n <= 4)
})

console.log('\n— ⑥ 기본정보 탭')
{
  const { missing, bad } = inOrder(infoJsx, [
    ['고객명', 'id="cf-name"'], ['담당(슬롯)', '{assigneeSlot}'], ['관할 소방서', 'id="cf-station"'],
    ['사용승인일', 'id="cf-approval"'], ['점검일자', 'id="cf-plan"'], ['법정 시기', '{legalBadge'],
    ['점검유형', '{typeSlot}'], ['계약일', 'id="cf-contract"'], ['주소', 'id="cf-address"'], ['비고', 'id="cf-notes"'],
  ])
  ok('표식이 전부 있다', missing.length === 0, missing.join(', '))
  ok('★ 순서: 고객명 → 담당 → 소방서 → 사용승인일 → 점검일자 → 법정 시기 → 유형 → 계약일 → 주소 → 비고', bad.length === 0, bad.join(' · '))
  ok('★ 고객명 | 담당이 같은 첫 줄', () => {
    const a = infoJsx.indexOf('id="cf-name"'), b = infoJsx.indexOf('{assigneeSlot}')
    return a > 0 && b > a && !infoJsx.slice(a, b).includes('<SubRow')
  })
  ok('★ 기준일 두 칸 + 법정 시기가 한 강조 줄 안', /\baccent\b/.test(subRowOf(infoJsx, 'id="cf-approval"'))
    && subRowOf(infoJsx, 'id="cf-approval"') === subRowOf(infoJsx, 'id="cf-plan"')
    && subRowOf(infoJsx, 'id="cf-plan"') === subRowOf(infoJsx, '{legalBadge'))
  ok('역할 배지가 두 칸에', /RoleBadge role=\{roles\.approval\}/.test(infoJsx) && /RoleBadge role=\{roles\.plan\}/.test(infoJsx))
  ok('배지와 법정 시기가 **같은 입력**(anchorInput)을 본다 — 둘이 갈라지지 않게',
    /const roles = anchorRoles\(anchorInput\)/.test(info) && /resolveAnchor\(anchorInput\)/.test(info))
  ok('페이지가 담당을 슬롯으로 넣는다(폼 밖 머리에 따로 뜨지 않는다)',
    /assigneeSlot=\{/.test(page) && /unassigned=\{!customer\.assigned_employee_id\}/.test(page))
  ok('★ 기본정보 탭은 넓게(wideKeys) — 요약 패널은 유지', /wideKeys=\{\['info'/.test(page)
    && /isFull \|\| isWide \? '' : 'max-w-3xl'/.test(tabs) && /\{summary && !isFull && summary\}/.test(tabs))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
