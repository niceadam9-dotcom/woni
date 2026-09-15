/** 기본 담당자 규칙 검사 (2026-09-15) — 「일반관리」 고객이 미배정으로 남는 것을 막는 축.
 *
 *  이 축이 겨누는 사고는 **빈칸을 채우면서 문제를 숨기는 것**이다. 지금 빨간 「미배정」이
 *  "담당이 정해지지 않았다"를 알리는 유일한 신호라, 그대로 채우면 신호가 사라진다.
 *  그래서 판정은 「채우는가」보다 **「채우면 안 될 때 안 채우는가」**와 **「표식이 남는가」**다.
 *
 *  의존 0 — DB도 서버도 필요 없다. 실행: npx tsx scripts/test-default-assignee.mts
 */
import {
  shouldFillDefaultAssignee, defaultAssigneeTargets, assigneeLabel,
} from '../src/lib/default-assignee.ts'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${m}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`  ❌ ${m}${d ? ' — ' + d : ''}`) }
}
const KIM = 'kim-uuid'

console.log('── 1) 채우는 경우 — 「일반관리」 + 미배정 + 설정 있음, 셋이 다 참일 때만')
{
  ok(shouldFillDefaultAssignee({ inspection_type: '일반관리', assigned_employee_id: null }, KIM) === true,
    '🎯 일반관리 · 미배정 · 설정 있음 → 채운다')
}

console.log('\n── 2) 채우면 안 되는 경우 — 경계 셋 (여기가 이 검사의 핵심이다)')
{
  // ① 설정이 비었으면 아무 일도 하지 않는다. 지어내지 않는다.
  ok(shouldFillDefaultAssignee({ inspection_type: '일반관리', assigned_employee_id: null }, null) === false,
    '🎯 설정이 비면 안 채운다(종전대로 미배정)')
  ok(shouldFillDefaultAssignee({ inspection_type: '일반관리', assigned_employee_id: null }, '') === false,
    '설정이 빈 문자열이어도 안 채운다')
  // ② 사람이 고른 값을 기본값이 덮으면 되돌릴 수 없다.
  ok(shouldFillDefaultAssignee({ inspection_type: '일반관리', assigned_employee_id: 'other' }, KIM) === false,
    '🎯 이미 배정된 고객은 건드리지 않는다')
  // ③ 작동/종합의 미배정은 사유가 다르다(영업권 밖) — 이 규칙의 대상이 아니다.
  for (const t of ['작동', '종합', null, '', '일반']) {
    ok(shouldFillDefaultAssignee({ inspection_type: t, assigned_employee_id: null }, KIM) === false,
      `🎯 유형이 ${JSON.stringify(t)}이면 안 채운다`)
  }
}

console.log('\n── 3) 일괄 적용 대상 — 세는 쪽과 쓰는 쪽이 같은 함수라야 한다')
{
  const rows = [
    { id: 'a', inspection_type: '일반관리', assigned_employee_id: null },
    { id: 'b', inspection_type: '일반관리', assigned_employee_id: 'other' },   // 이미 배정
    { id: 'c', inspection_type: '작동', assigned_employee_id: null },           // 유형 밖
    { id: 'd', inspection_type: '일반관리', assigned_employee_id: null },
  ]
  const t = defaultAssigneeTargets(rows, KIM)
  ok(t.length === 2 && t.map(x => x.id).join(',') === 'a,d',
    '🎯 대상은 일반관리 · 미배정뿐', t.map(x => x.id).join(',') || '(없음)')
  ok(defaultAssigneeTargets(rows, null).length === 0, '설정이 비면 대상 0건')
  // 화면이 "N명"이라 말하고 다른 수를 바꾸는 일이 없도록 **같은 함수**가 둘을 답한다
  ok(defaultAssigneeTargets(rows, KIM).every(x => shouldFillDefaultAssignee(x, KIM)),
    '대상 집합의 전건이 개별 판정과 일치한다(두 함수가 갈리지 않는다)')
}

console.log('\n── 4) 표시 문구 — 「(기본)」은 출처가 default일 때만')
{
  ok(assigneeLabel('김흥준', 'default') === '김흥준 (기본)', '🎯 default → 「(기본)」')
  ok(assigneeLabel('김흥준', 'manual') === '김흥준', 'manual → 이름만')
  ok(assigneeLabel('김흥준', null) === '김흥준', '🎯 출처 미상(null) → 이름만(없던 표식이 생기지 않는다)')
  ok(assigneeLabel(null, 'default') === '미배정', '이름이 없으면 미배정 — 출처가 뭐든')
  /* 🚨 문구가 「(일반)」이 아닌 이유를 검사로 못 박는다 — 화면에서 「일반」은 이미 **점검유형
     라벨**이라(types/index.ts: '일반관리' → '일반') 담당 옆에 붙으면 유형인지 출처인지 갈린다. */
  ok(!assigneeLabel('김흥준', 'default').includes('(일반)'),
    '🎯 (음성) 「(일반)」을 쓰지 않는다 — 점검유형 라벨과 겹친다')
}

console.log('\n── 5) 배선 — 규칙을 쓰는 쪽이 제 손으로 다시 적지 않는가')
{
  const src = (p: string) => readFileSync(path.join(import.meta.dirname, '..', 'src', p), 'utf8')
  const actions = src('app/(dashboard)/customers/actions.ts')
  ok(actions.length > 1000, '분모 확인: 고객 액션 소스를 읽었다')
  ok(/shouldFillDefaultAssignee\(/.test(actions), '🎯 고객 등록이 규칙 함수를 부른다')
  ok(/defaultAssigneeTargets\(/.test(actions), '🎯 일괄 적용이 같은 대상 함수를 쓴다')
  /* 🚨 사람이 고른 순간 **manual로 승격**되지 않으면, 기본 배정된 고객을 손으로 다시 골라도
     「(기본)」이 남아 "아직 아무도 안 정했다"는 거짓 표식이 굳는다. */
  ok(/assigned_source:\s*employeeId\s*\?\s*'manual'\s*:\s*null/.test(actions),
    '🎯 수동 배정이 출처를 manual로 승격한다(해제하면 출처도 지운다)')
  /* 🚨 **사람이 고르는 경로가 둘이다** — 고객 상세 드롭다운과 지역별 일괄 배정.
     한쪽만 출처를 남기면 「사람이 고름」과 「출처 미상」을 나중에 가를 수 없고, 표시는 둘 다
     이름만이라 화면으로는 안 드러난다(조용히 어긋난다). 두 경로를 **함께** 센다. */
  ok((actions.match(/assigned_source:\s*employeeId\s*\?\s*'manual'\s*:\s*null/g) ?? []).length === 2,
    '🎯 사람이 고르는 경로 **둘 다** 출처를 manual로 남긴다(상세 드롭다운·지역별 일괄)',
    `${(actions.match(/assigned_source:\s*employeeId\s*\?\s*'manual'\s*:\s*null/g) ?? []).length}곳`)
  // 기본 배정은 알림을 보내지 않는다 — 빈칸을 메운 것이지 사람이 정한 일이 아니다
  const applyBlock = /export async function applyDefaultAssigneeAction[\s\S]*?\n}/.exec(actions)?.[0] ?? ''
  ok(applyBlock.length > 100, '분모 확인: 일괄 적용 블록을 찾았다')
  ok(!/notifyIfEnabled/.test(applyBlock), '🎯 (음성) 일괄 적용은 배정 알림을 보내지 않는다')
  ok(/_syncEmployeeToRelated/.test(applyBlock), '담당 전파는 한다(계획 항목까지 — INV-D14)')

  /* 🚨 표시 표면이 넷이다 — 하나라도 빠지면 그 화면에서만 「(기본)」이 사라져, 보는 자리에 따라
     "정식 배정"으로 읽힌다. **어느 표면이 빠졌는지**를 이름으로 말해 준다(전수 확인). */
  const SURFACES: Array<[string, string]> = [
    ['고객 요약 패널', 'components/customers/customer-summary-panel.tsx'],
    ['고객 상세 담당칸', 'components/customers/assign-employee-inline.tsx'],
    ['고객 목록', 'app/(dashboard)/customers/page.tsx'],
    ['지역별 담당 배정', 'components/customers/regional-assign-client.tsx'],
  ]
  /* 🚨 **파일에 있는가**만 물으면 안 된다 — 한 파일 안에 표시 분기가 둘이면(편집 가능/불가)
     한쪽을 되돌려도 다른 쪽 때문에 초록이 된다(변이 M9가 실증). 분기 수만큼 **세어** 묻는다. */
  const NEEDED: Record<string, number> = {
    'app/(dashboard)/customers/page.tsx': 2,   // 편집 가능(displayValue) + 읽기 전용(span)
  }
  for (const [label, file] of SURFACES) {
    const hits = (src(file).match(/assigneeLabel\(/g) ?? []).length
    const need = NEEDED[file] ?? 1
    ok(hits >= need, `🎯 ${label}이 같은 문구 함수를 쓴다`, `${hits}곳 (필요 ${need})`)
  }
  /* 🚨 배정 권한이 있으면 드롭다운이 그려져 **읽기 전용 라벨을 못 본다** — 정작 정식 배정으로
     바꿔야 할 사람이 그 사람이다. 그래서 선택 상자 옆에 배지가 따로 있어야 한다. */
  ok(/assign-default-badge/.test(src('components/customers/assign-employee-inline.tsx')),
    '🎯 드롭다운 옆에도 「기본」 배지가 있다(관리자가 못 보는 일이 없게)')
  // 목록·지역별 화면이 출처를 **조회에 싣는지** — 안 실으면 값이 undefined라 표식이 조용히 사라진다
  /* 🚨 같은 함정 — 타입 정의에 `assigned_source`가 있으면 **select에서 빠져도** 초록이다
     (변이 M11). 조회에 실리는지는 `select(...)` 안을 봐야 안다. 안 실리면 값이 undefined라
     표식이 조용히 사라진다. */
  ok(/assigned_employee_id,\s*assigned_source/.test(src('lib/customer-list.ts')),
    '목록 **조회**가 assigned_source를 싣는다')
  ok(/assigned_source/.test(src('app/(dashboard)/customers/regional-assign/page.tsx')),
    '지역별 배정 조회가 assigned_source를 싣는다')

  const card = src('components/admin/default-assignee-card.tsx')
  ok(/targetCount/.test(card), '화면이 대상 수를 서버에서 받는다(제 나름대로 세지 않는다)')
  ok(/applyDefaultAssigneeAction/.test(card) && /setDefaultAssigneeAction/.test(card),
    '🎯 설정 저장과 일괄 적용이 **다른 액션**이다(드롭다운 하나가 대량 쓰기를 일으키지 않는다)')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
