// 소방계획서_49 §10-2 ① — 「고객을 만들면 건물이 반드시 1동 생긴다」 정적 검사
//
// 왜 있는가: `fire_facilities.building_id`가 NOT NULL이라 **건물 0동 고객은 1.4를 저장할 수
// 없다**. 1.4는 점검표의 설치 축이므로 그 고객은 점검표·별지 9호·소방계획서가 연쇄로 막힌다.
// 📏 스테이징 실측(2026-09-11): 활성 고객 304명 중 **16명이 건물 행 0건**이었다.
// 원인은 `createCustomerAction`의 건물 생성이 주소·용도·층수 유무를 따지는 **조건부**였던 것.
//
// 🚨 이 축을 단언하는 검사가 **한 건도 없었다** — 그래서 조건을 되살려도 스위트가 초록이었다.
//    이 파일이 그 구멍을 막는다. 핵심은 「조건이 없는가」이고, 그걸 **함수 안에서** 본다
//    (파일 전체에서 리터럴을 세면 다른 함수의 같은 문자열에 매치돼 변이가 살아난다 — 45차 교훈).
//
// 서버·DB 없이 **소스만** 읽는다(무서버 게이트에 얹을 수 있어야 한다).
// 실행: npx tsx scripts/test-49-building-always.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** `const <name> = (async () => {` 부터 균형 잡힌 닫는 괄호까지 — 함수 **안**만 돌려준다.
 *  이게 이 검사의 핵심 장치다: 범위를 좁히지 않으면 어떤 단언도 옆 함수에 걸려 변이를 놓친다. */
function fnBody(src: string, name: string): string | null {
  const head = `const ${name} = (async () => {`
  const i = src.indexOf(head)
  if (i < 0) return null
  let depth = 0, j = i + head.length - 1
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1) }
  }
  return null
}

console.log('— 소방계획서_49 §10-2 ① 건물 1동 불변식')

const ACTIONS = read('src', 'app', '(dashboard)', 'customers', 'actions.ts')
const body = fnBody(ACTIONS, 'buildingTask')

// ── A. 추출 자체가 성공해야 한다 (공허 통과 차단) ──────────────────────────────
// 이름이 바뀌거나 화살표 함수 형태가 달라지면 아래 전부가 "조건 없음"으로 **거짓 초록**이 된다.
check('[A] buildingTask 함수 본문 추출 성공', body != null,
  body ? `${body.length}자` : '추출 실패 — 아래 단언은 모두 무의미하다')
if (!body) {
  console.log(`\n결과: ${pass} pass / ${fail + 1} fail — 추출 실패로 중단`)
  process.exit(1)
}

// ── B. 가드는 customer_name **하나**뿐이다 (양성 단언) ─────────────────────────
check('[B1] 가드가 `if (input.customer_name) {`', /if\s*\(\s*input\.customer_name\s*\)\s*\{/.test(body))

// ── C. 폐지된 조건이 되살아나지 않았다 (음성 단언 — B와 쌍) ────────────────────
// 조건 자리에만 겨눈다. 같은 필드가 **값으로** 쓰이는 줄(buildingBase 조립)은 정상이므로
// `input.customer_name && (` 형태와 가드 안의 `||` 연쇄만 본다.
check('[C1] `customer_name && (` 조건 복합이 없다', !/input\.customer_name\s*&&\s*\(/.test(body))
const guardLine = body.match(/if\s*\([^)]*input\.customer_name[^)]*\)/)?.[0] ?? ''
check('[C2] 가드에 `||`가 없다', !guardLine.includes('||'), guardLine.slice(0, 80))
for (const f of ['input.address', 'input.zipcode', 'input.building_purpose', 'input.building_floors_above']) {
  check(`[C3] 가드에 ${f} 없음`, !guardLine.includes(f))
}

// ── D. 건물명·폴백 — 값이 하나도 없어도 insert가 성립하는 경로가 있다 ──────────
check('[D1] building_name의 원천이 고객명', /building_name:\s*input\.customer_name/.test(body))
check('[D2] 가장 마른 폴백 payload(buildingBase 단독)가 attempts에 있다',
  /attempts[\s\S]*?\n\s*buildingBase,\s*\n\s*\]/.test(body))
check('[D3] 42703 폴백 루프가 남아 있다', /42703/.test(body))

// ── E. 근거 고정 — 왜 0동이 치명적인가를 스키마로 못 박는다 ────────────────────
// 이 단언이 깨지면(building_id가 nullable이 되면) 이 검사의 전제가 사라진다. 그때는
// 검사를 지우는 게 아니라 **왜 전제가 바뀌었는지** 확인해야 한다.
const MIG = read('supabase', 'migrations', '067_fire_facilities.sql')
check('[E1] fire_facilities.building_id가 NOT NULL', /building_id\s+UUID\s+NOT\s+NULL/i.test(MIG))

// ── F. 0동 고객이 크래시하지 않는다 (기존 가드 보존) ───────────────────────────
// 백필 전까지 16명이 이 경로로 들어온다. 문구가 아니라 **가드의 존재**를 본다 —
// 타 세션이 이 파일을 고치고 있어(2026-09-11 실측 ` M`) 문구를 고정하면 남과 싸운다.
const FORM14 = read('src', 'components', 'customers', 'plan-form14.tsx')
check('[F1] plan-form14에 건물 부재 조기 반환 가드가 있다', /if\s*\(\s*!b\s*\)\s*\{/.test(FORM14))

// ── G. 이 검사가 실제로 무는지 — 자기 점검 ─────────────────────────────────────
// 폐지된 조건 원문을 넣었다고 **가정**하고 같은 술어를 돌려 본다. 통과해 버리면 단언이 헐렁하다.
{
  const mutated = body.replace(/if\s*\(\s*input\.customer_name\s*\)/,
    'if (input.customer_name && (input.address || input.zipcode || input.building_purpose || input.building_floors_above))')
  const mutatedGuard = mutated.match(/if\s*\([^)]*input\.customer_name[^)]*\)/)?.[0] ?? ''
  const caught = /input\.customer_name\s*&&\s*\(/.test(mutated) || mutatedGuard.includes('||')
  check('[G1] 변이(조건 되살리기)를 이 검사가 잡는다', caught, caught ? '빨강으로 전환됨' : '🚨 변이가 살아남았다')
}

// ── H. §10-2 ②③ 「건물정보」 전환 ───────────────────────────────────────────────
// 🚨 주석 안에 **복원용 스니펫**이 있어 `건물 등록`·`Plus` 문자열이 남아 있다. 날 것 그대로
//    grep하면 버튼이 없는데도 「있다」로 읽는다 → **주석을 걷어낸 뒤** 판정한다.
const PANEL_RAW = read('src', 'components', 'customers', 'building-inline-panel.tsx')
const PANEL = PANEL_RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
check('[H0] 주석 제거가 실제로 줄였다 (계측기 자기검증)', PANEL.length < PANEL_RAW.length,
  `${PANEL_RAW.length} → ${PANEL.length}자`)
check('[H1] 제목이 「건물정보」', /<h2[^>]*>건물정보<\/h2>/.test(PANEL))
check('[H2] 「건물 목록」 제목이 남아 있지 않다', !/<h2[^>]*>건물 목록<\/h2>/.test(PANEL))
check('[H3] [+ 건물 등록] 버튼 JSX가 없다 (주석 밖)', !/onClick=\{openNew\}/.test(PANEL))
check('[H4] lucide import에 Plus가 없다',
  !/\bPlus\b/.test(PANEL.match(/^import .*lucide-react.*$/m)?.[0] ?? ''))
// 되살릴 길이 남아 있는가 — 「지웠다」와 「못 되살린다」는 다르다
check('[H5] openNew는 남아 있다 (복원·딥링크 경로)', /function openNew\(\)/.test(PANEL))

// ── I. 순수 함수를 **실제로 호출**한다 — 정규식이 아니라 동작을 문다 ───────────
const { shouldHideBuildingTable, initialBuildingPanelTarget } =
  await import('../src/lib/building-panel-open.ts')
const { primaryBuilding } = await import('../src/lib/primary-building.ts')

const one = [{ id: 'b1' }]
const two = [{ id: 'b1' }, { id: 'b2' }]
check('[I1] 1동 + 그 동 펼침 → 표 감춤', shouldHideBuildingTable({ buildings: one, editing: 'b1' }) === true)
// 🎯 이 차수에서 가장 중요한 단언 — 「감추는가」가 아니라 **「감추면 안 될 때 안 감추는가」**.
//    버튼이 없어졌으므로 2동 고객에게는 **표가 유일한 편집 경로**다. 여기가 물면 그들이 갇힌다.
check('[I2] 🎯 2동 → 표 감추지 않음 (기존 다동 고객의 유일한 편집 경로)',
  shouldHideBuildingTable({ buildings: two, editing: 'b1' }) === false)
check('[I3] 등록 폼(new) → 표 감추지 않음', shouldHideBuildingTable({ buildings: one, editing: 'new' }) === false)
check('[I4] 닫힘 → 표 감추지 않음', shouldHideBuildingTable({ buildings: one, editing: null }) === false)
// 버튼이 없어도 첫 동을 만들 수 있다는 근거 — 깨지면 0동 고객이 영원히 막힌다
check('[I5] 0동 + 등록권한 → 등록 폼 자동 열림 (버튼 없이 첫 동을 만드는 경로)',
  initialBuildingPanelTarget({ buildings: [], canManage: true }) === 'new')
check('[I6] 0동 + 권한 없음 → 열지 않음', initialBuildingPanelTarget({ buildings: [], canManage: false }) === null)
check('[I7] 1동 → 그 동을 펼친다', initialBuildingPanelTarget({ buildings: one, canManage: true }) === 'b1')

// ── J. 두 문서가 같은 동을 인쇄한다 (§10-3) ────────────────────────────────────
// 소방계획서 생성기는 `buildings[0]`을, 별지 9호 2쪽·1.1은 `primaryBuilding`을 쓴다.
// 1동이면 두 식이 같은 답을 내야 한다 — 갈라지면 한 대상물이 두 얼굴로 인쇄된다.
{
  const solo = [{ id: 'b1', is_active: true, is_primary: null, created_at: '2026-01-01' }]
  check('[J1] 1동이면 buildings[0] === primaryBuilding', primaryBuilding(solo)?.id === solo[0].id)
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
