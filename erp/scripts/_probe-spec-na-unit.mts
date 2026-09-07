// 세부제원 조건부 자동 ／ — 순수 판정 + 카탈로그 정합 프로브 (2026-09-07)
//
//  ① 규칙이 겨누는 코드가 **실제 카탈로그에 있는가** — 오타 하나면 그 규칙은 영원히 무발화(조용한 실패)
//  ② ③(미입력·갈림)에서 절대 판정하지 않는가 — 이걸 어기면 점검 안 한 칸이 ／로 인쇄된다
//  ③ 각 규칙이 양방향으로 갈리는가 — 한 방향만 보면 '늘 참'인 규칙을 통과시킨다
//
// 실행: npx tsx scripts/_probe-spec-na-unit.mts
// @ts-expect-error mjs 헬퍼
import { raw, check, summary } from './_e2e-helpers.mjs'
import { specNaReasons, SPEC_NA_RULES, SPEC_NA_TARGET_CODES, type SpecRow } from '../src/lib/sheet-spec-na'
import { FACILITY_SPEC_SECTIONS } from '../src/lib/facility-spec-schema'

const row = (section: string, spec: Record<string, unknown>): SpecRow => ({ section_key: section, spec })
const na = (rows: SpecRow[]) => new Set(Object.keys(specNaReasons(rows)))

// ── ① 카탈로그 정합 — 규칙 코드 전수가 DB에 실재하는가 ──────────────────────
// ⚠ 반드시 페이징한다. 단일 select는 **1000행에서 조용히 잘려**(risk_supabase_1000row_cap)
//    멀쩡한 규칙 6건을 '없는 코드'로 오보했다 — 이 프로브 자신이 첫 실행에서 그 함정에 빠졌다.
const catalog = new Set<string>()
for (let from = 0; ; from += 1000) {
  const { data } = await raw.from('inspection_sheet_items').select('item_code').range(from, from + 999)
  const page = (data ?? []) as Array<{ item_code: string }>
  for (const i of page) catalog.add(i.item_code)
  if (page.length < 1000) break
}
check('① 카탈로그 페이징 — 1000행 상한을 넘겼다', catalog.size > 1000, `${catalog.size}개`)
const ghost = SPEC_NA_TARGET_CODES.filter(c => !catalog.has(c))
check(`① 규칙 코드 ${SPEC_NA_TARGET_CODES.length}건 전부 카탈로그에 실재`, ghost.length === 0,
  ghost.length ? `없는 코드: ${ghost.join(', ')}` : '')

// ── ①-b 스키마 정합 — 규칙이 가리키는 [섹션.블록.필드]가 실재하는가 ──────────
const badPath: string[] = []
for (const r of SPEC_NA_RULES) {
  const [s, b, f] = r.path
  const sec = FACILITY_SPEC_SECTIONS.find(x => x.key === s)
  const blk = sec?.blocks.find(x => x.key === b)
  if (!blk?.fields.some(x => x.key === f)) badPath.push(r.path.join('.'))
}
check('①-b 규칙 경로 전부 스키마에 실재', badPath.length === 0, badPath.join(', '))

// ── ①-c 선택지 정합 — na()가 겨누는 값이 그 필드의 options 안에 있는가 ────────
//    (options에 없는 값을 겨누면 영원히 거짓 = 무발화. 오타를 여기서 잡는다)
const unreachable: string[] = []
for (const r of SPEC_NA_RULES) {
  const [s, b, f] = r.path
  const fld = FACILITY_SPEC_SECTIONS.find(x => x.key === s)?.blocks.find(x => x.key === b)?.fields.find(x => x.key === f)
  const opts = fld?.options ?? []
  if (opts.length === 0) continue
  // select는 값 하나, multicheck는 배열 하나로 각각 시험한다
  const fires = fld!.type === 'multicheck'
    ? opts.some(o => r.na([o]))
    : opts.some(o => r.na(o))
  if (!fires) unreachable.push(`${r.codes[0]} (${r.path.join('.')})`)
}
check('①-c 규칙마다 실제 선택지 중 발화하는 값이 있다', unreachable.length === 0, unreachable.join(' / '))

// ── ② ③ 규약 — 모르면 판정하지 않는다 ────────────────────────────────────
check('② 제원 행 자체가 없으면 판정 0', na([]).size === 0)
check('② 섹션은 있는데 블록이 비면 판정 0', na([row('s38_activity', {})]).size === 0)
check('② 필드가 빈 문자열이면 판정 0',
  na([row('s38_activity', { sprinkler_connect: { head_type: '' } })]).size === 0)
check('② multicheck 빈 배열이면 판정 0 (미입력과 구별 불가)',
  na([row('s32_water_common', { emergency_power: { types: [] } })]).size === 0)
check('② 목록에 없는 값이면 판정 0(오타·신규 선택지 안전)',
  na([row('s38_activity', { sprinkler_connect: { head_type: '반개방형' } })]).size === 0)

// ── ②-b 다건물 갈림 — 동마다 다르면 사람이 판단한다 ─────────────────────────
const splitBuildings = [
  row('s38_activity', { sprinkler_connect: { head_type: '개방형' } }),
  row('s38_activity', { sprinkler_connect: { head_type: '폐쇄형' } }),
]
check('②-b 동마다 헤드 형식이 다르면 어느 쪽도 판정 안 함', na(splitBuildings).size === 0,
  [...na(splitBuildings)].join(','))
check('②-c 같은 값이 두 동에 있으면 판정한다(갈림이 아니다)',
  na([
    row('s38_activity', { sprinkler_connect: { head_type: '개방형' } }),
    row('s38_activity', { sprinkler_connect: { head_type: '개방형' } }),
  ]).has('27-C-004'))

// ── ③ 양방향 — 사용자 발단 사례(27-C-004 폐쇄형 헤드) ───────────────────────
const openHead = na([row('s38_activity', { sprinkler_connect: { head_type: '개방형' } })])
check('③ 개방형 → 폐쇄형 전용(27-C-003·004) 자동 ／',
  openHead.has('27-C-003') && openHead.has('27-C-004'))
check('③ 개방형 → 개방형 전용(27-A-003·011)은 그대로 입력 대상',
  !openHead.has('27-A-003') && !openHead.has('27-A-011'))
const closedHead = na([row('s38_activity', { sprinkler_connect: { head_type: '폐쇄형' } })])
check('③ 폐쇄형 → 개방형 전용(27-A-003·011) 자동 ／',
  closedHead.has('27-A-003') && closedHead.has('27-A-011'))
check('③ 폐쇄형 → 폐쇄형 전용(27-C-003·004)은 그대로 입력 대상',
  !closedHead.has('27-C-003') && !closedHead.has('27-C-004'))

// ── ③-b 나머지 규칙 양방향 표본 ─────────────────────────────────────────────
const wet = na([row('s33_water_each', { sprinkler: { type: '습식' } })])
check('③-b 스프링클러 습식 → 감지기 연동(3-G-002·012) ／, 유수검지(3-G-001·011) 유지',
  wet.has('3-G-002') && wet.has('3-G-012') && !wet.has('3-G-001') && !wet.has('3-G-011'))
const deluge = na([row('s33_water_each', { sprinkler: { type: '일제살수식' } })])
check('③-b 일제살수식 → 유수검지·폐쇄형 송수구(3-I-005) ／',
  deluge.has('3-G-001') && deluge.has('3-G-011') && deluge.has('3-I-005'))
const gasElec = na([row('s34_gas', { gas_system: { starter_type: '전기식' } })])
check('③-b 가스 전기식 → 가스압력식·기계식 전용만 ／ (이산화탄소 9 포함 4시트)',
  !gasElec.has('9-C-022') && !gasElec.has('10-C-022')
  && gasElec.has('9-C-023') && gasElec.has('9-C-025')
  && gasElec.has('10-C-023') && gasElec.has('12-D-024') && gasElec.size === 12, `${gasElec.size}건`)
const battery = na([row('s36_evac', { portable_light: { power: '건전지식' } })])
check('③-b 휴대용 건전지식 → 충전식 항목(22-B-007)만 ／',
  battery.has('22-B-007') && !battery.has('22-B-006'))
const gen = na([row('s32_water_common', { emergency_power: { types: ['축전지설비'] } })])
check('③-b 비상전원에 자가발전 없음 → 수계 8시트 자가발전 전용 16건 ／',
  gen.has('2-G-003') && gen.has('8-K-003') && gen.has('13-F-004') && gen.size === 16, `${gen.size}건`)
const genOk = na([row('s32_water_common', { emergency_power: { types: ['자가발전설비', '축전지설비'] } })])
check('③-b 자가발전 포함 → 그 항목들은 입력 대상', genOk.size === 0)

// ── ③-c 계열 침범 금지 — 수계 비상전원이 가스계·제연 항목을 건드리면 안 된다 ──
check('③-c 수계 비상전원 판정이 가스계(10-K-002)·제연(24-E-002)까지 번지지 않는다',
  !gen.has('10-K-002') && !gen.has('24-E-002') && !gen.has('28-A-003'))

summary()
