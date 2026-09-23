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
  /* 사용자 「기본정보 저장버튼은 없네?」 — 종전엔 고쳐야만 버튼이 나타났다. 이제 늘 있고 변경 없으면 비활성. */
  /* ⚠ 옛 모양(`isDirty && canManage ?`)만 막으면 **다른 모양의 같은 게이트**(`canManage && isDirty &&`)가
     초록으로 새어 든다 — 변이 V1이 실제로 살아남았다(2026-09-23). 저장 줄을 여는 조건을 **직접** 본다. */
  // 2026-09-23 후속 — 저장 줄이 공용 SaveBar가 됐다(모양은 부품, 조건은 화면). 게이트를 여전히 **직접** 본다.
  ok('★ 저장 버튼이 **늘** 있다 (고쳐야만 나타나지 않는다)', () => {
    const i = infoJsx.indexOf('testId="info-save-bar"')
    const gate = i > 0 ? infoJsx.slice(infoJsx.lastIndexOf('{', infoJsx.lastIndexOf('(', i)), i) : ''
    return /saveTestId="info-save"/.test(infoJsx) && /dirty=\{isDirty\}/.test(infoJsx)
      && !/testId="info-save-bar"[^/]*alwaysEnabled/.test(infoJsx)
      && /^\{canManage && \($/m.test(gate.trim().split('\n')[0]) && !/isDirty/.test(gate)
  }, '(저장 줄 앞 조건에 isDirty가 끼어 있다)')
  ok('저장 줄 부품: 늘 그려지고 · sticky · [저장]은 변경 없으면 비활성 · 그룹 상자는 overflow-clip', () => {
    const sb = kf.slice(kf.indexOf('export function SaveBar'), kf.indexOf('export function RoleBadge'))
    return /className="sticky bottom-0/.test(sb) && /disabled=\{pending \|\| !canSave\}/.test(sb)
      && /const canSave = alwaysEnabled \|\| dirty/.test(sb) && !/\bif \(!dirty\) return null/.test(sb)
      && /overflow-clip/.test(kf) && !/overflow-hidden/.test(kf)
  })
  ok('담당 칸은 칸을 꽉 채운다(fill) — 옆 칸과 같은 높이, 안내 문구는 툴팁',
    /\n\s*fill\n/.test(page) && (() => {
      const a = read('../src/components/customers/assign-employee-inline.tsx')
      return /title="선택 즉시 저장 · 배정 알림 발송"/.test(a) && !/<span[^>]*>선택 즉시 저장 · 배정 알림 발송<\/span>/.test(a)
    })())
}

console.log('\n— ⑦ 건물·시설 탭 (「기본정보처럼」)')
{
  const bld = read('../src/components/customers/building-inline-panel.tsx')
  ok('★ 그룹 상자 · 제목은 「건물정보」 그대로(§10-2 ③)', /<GroupBox n=\{2\} title="건물정보" testId="building-group"/.test(bld))
  ok('★ 기준일 줄(accent)에 사용승인일·건축허가일', /\baccent\b/.test(subRowOf(bld, 'placeholder="고객 정보에서 입력"'))
    && subRowOf(bld, 'placeholder="고객 정보에서 입력"') === subRowOf(bld, 'id="bf-permit-date"'))
  ok('「비었을 때만 빨강」 표식(data-a9-blank)이 넷 다 살아 있다',
    (bld.match(/data-a9-blank=\{a9Blank\(/g) ?? []).length === 4)
  ok('건물 칸들이 소그룹 줄 순서: 건물 → 주소 → 기준일 → 규모 → 구조 → 시설 현황 → 메모', inOrder(bld, [
    ['건물', 'label="건물"'], ['주소', 'label="주소"'], ['기준일', 'label="기준일"'], ['규모', 'label="규모 (별지 9호)"'],
    ['구조', 'label="구조"'], ['시설 현황', '<FacilityStatusGrid'], ['메모', 'label="메모"'],
  ]).bad.length === 0)
  ok('저장 줄은 공용 SaveBar', /<SaveBar testId="building-save-bar"/.test(bld))
  ok('Cell span은 1·2·3·4만', [...bld.matchAll(/<Cell[^>]*?\bspan=\{(\d+)\}/g)].every(m => +m[1] >= 1 && +m[1] <= 4))
}

console.log('\n— ⑧ 관계인 탭 (「기본정보처럼」)')
{
  const fsm = read('../src/components/customers/fire-safety-manager-panel.tsx')
  const cts = read('../src/components/customers/edit-contacts-client.tsx')
  ok('★ 그룹 상자로 감싼다', /<GroupBox n=\{3\} title="관계인 정보" testId="contacts-group"/.test(page))
  ok('★ 소방안전관리 줄(accent)에 선임일·최근 교육이수일', /\baccent\b/.test(subRowOf(fsm, '>선임일</label>'))
    && subRowOf(fsm, '>선임일</label>') === subRowOf(fsm, '>최근 교육이수일</label>'))
  ok('★ 선임일이 패널의 **첫 날짜 칸**(E2E가 .first()로 잡는다)', () => {
    const d = fsm.indexOf('<DateInput')   // 패널의 첫 날짜 입력 — 바로 앞 라벨이 선임일이어야 한다
    return d > 0 && fsm.slice(Math.max(0, d - 200), d).includes('>선임일</label>')
  })
  ok('★ 라벨·입력이 같은 div의 직계(E2E `div:has(> label:has-text(...)) button`)',
    ['대표자 구분', '관리자 자격구분 ', '최근 교육이수일'].every(t =>
      new RegExp(`<div className="space-y-1\\.5">\\s*<label className=\\{labelCls\\}>${t}`).test(fsm)))
  ok('관계인 카드는 넓은 상자에서 2열(상자 폭 기준)', /grid grid-cols-1 @4xl:grid-cols-2 gap-3/.test(cts))
  ok('fsm-save·패널 id 유지', /saveTestId="fsm-save"/.test(fsm) && /id="c-fire-safety-manager"/.test(fsm))
  ok('★ 세 탭 모두 넓게', /wideKeys=\{\['info', 'buildings', 'contacts'/.test(page))
}

console.log('\n— ⑨ 나머지 탭 — 저장 줄 한 벌 · 넓게 (2026-09-23 「기본정보 저장버튼 형태가 동일하게 나머지 탭들도」)')
{
  /* 폼 저장이 있는 모든 화면. 여기 없는 두 곳은 **폼 저장이 아니라** 뺐다:
     revision-history(이력 행 편집의 행 단위 저장) · image-annotator(그림 편집 모달의 「이 그림으로 저장」). */
  const SURFACES: Array<[string, string, string?]> = [
    ['기본정보', 'edit-customer-info-client', 'info-save'], ['건물정보', 'building-inline-panel'],
    ['소방안전관리', 'fire-safety-manager-panel', 'fsm-save'],
    ['1.1', 'fire-plan-info-panel', 'fp-info-save'], ['1.4', 'plan-form14', 'form14-save'],
    ['1.10.3', 'plan-multi-use-card', 'form14-multi-use-save'], ['기타 항목', 'etc-items-panel', 'etc-items-save'],
    ['업무 실시사항', 'plan-annex-status-card', 'annex-status-save'], ['청구·수금', 'billing-client'],
    ['1.2', 'plan-form12'], ['1.3', 'plan-form13'], ['1.5', 'plan-form15'], ['1.6', 'plan-form16'], ['1.7', 'plan-form17'],
    ['1.10', 'plan-form110'], ['1.11', 'plan-form111'], ['1.12~1.15', 'plan-form1215'], ['표지', 'plan-form-cover'],
    ['2장', 'plan-ch2'], ['3장', 'plan-ch3'],
  ]
  const noBar: string[] = [], oldBtn: string[] = [], lostId: string[] = []
  for (const [name, file, tid] of SURFACES) {
    const s = read(`../src/components/customers/${file}.tsx`)
    if (!/<SaveBar\b/.test(s)) noBar.push(name)
    // 옛 모양의 흔적 — 브랜드 바탕 버튼 안에 <Save 아이콘 + 「저장」 글씨(인라인 복사본)
    if (/bg-brand[^"]*"[^>]*>\s*\{[^}]*<Save className/.test(s)) oldBtn.push(name)
    if (tid && !new RegExp(`saveTestId="${tid}"`).test(s)) lostId.push(`${name}(${tid})`)
  }
  ok(`★ 폼 저장 ${SURFACES.length}곳이 모두 공용 SaveBar를 쓴다`, noBar.length === 0, noBar.join(', '))
  ok('★ 옛 인라인 저장 버튼 복사본이 남아 있지 않다', oldBtn.length === 0, oldBtn.join(', '))
  ok('검사가 잡던 저장 testid가 SaveBar로 그대로 옮겨졌다', lostId.length === 0, lostId.join(', '))
  ok('소방계획서 서식 버튼 글씨에 「저장」 유지(plan-tab-view가 그 글씨로 미저장 표시를 지운다)',
    ['plan-form12', 'plan-form13', 'plan-form16', 'plan-form-cover', 'plan-ch2'].every(f =>
      /saveLabel="[^"]*저장"/.test(read(`../src/components/customers/${f}.tsx`))))
  ok('1.4 미저장·변경 없음 표식(testid)이 저장 줄 안에 살아 있다',
    (() => { const s = read('../src/components/customers/plan-form14.tsx'); return /form14-dirty-badge/.test(s) && /form14-clean-badge/.test(s) })())
  ok('★ 청구·수금·이력 탭도 넓게', /wideKeys=\{\['info', 'buildings', 'contacts', 'billing', 'history'\]\}/.test(page))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
