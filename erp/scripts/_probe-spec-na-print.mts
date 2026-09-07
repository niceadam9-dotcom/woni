// 세부제원 자동 ／ — **인쇄 축** 검증 (2026-09-07). 화면이 ／인데 문서가 빈칸이면 실패다.
//
//  assembleReport9의 annex4.sheetSections(별지 4호 부속 점검표 결과칸)를 직접 읽는다.
//  대조군 → 개방형 → 폐쇄형 3상태를 같은 점검 건으로 돌려 델타를 본다.
//  ⚠ '미입력 N건' 경고(missing)도 함께 본다 — 자동 ／가 됐는데 경고가 그대로면 카운터가 갈린 것이다.
//
// 실행: npx tsx scripts/_probe-spec-na-print.mts
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'
import { assembleReport9 } from '../src/lib/report9-assemble'

const EMAIL = 'spec-na-print@erp-test.com'
const FAC = '연결살수설비'
const OPEN_ONLY = ['27-A-003', '27-A-011']
const CLOSED_ONLY = ['27-C-003', '27-C-004']
let userId = ''
let customerId = ''
let buildingId = ''
let inspId = ''

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

async function setHeadType(v: string | null) {
  await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
  if (v === null) return
  await raw.from('customer_facility_specs').insert({
    customer_id: customerId, building_id: buildingId, section_key: 's38_activity',
    spec: { sprinkler_connect: { head_type: v } },
  })
}

/** 부속 점검표에서 이 코드들의 결과칸 마크를 뽑는다(null = 빈칸으로 인쇄) */
async function marksOf(codes: string[]): Promise<{ marks: Record<string, string | null>; blankWarn: string }> {
  const r9 = await assembleReport9(raw, customerId, inspId)
  const out: Record<string, string | null> = {}
  for (const sec of r9.annex4.sheetSections) {
    for (const it of sec.items) if (codes.includes(it.code)) out[it.code] = it.mark
  }
  return { marks: out, blankWarn: r9.missing.find((m: string) => m.includes('점검표 항목 미입력')) ?? '' }
}
const blankCount = (w: string) => { const m = /미입력 (\d+)건/.exec(w); return m ? Number(m[1]) : -1 }

try {
  userId = await mkUser({ email: EMAIL, name: '인쇄판정프로브', employeeId: 'E2E-SNP' })
  customerId = await mkCustomer({ customer_name: '인쇄판정프로브고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId })
    .select('id').single()
  buildingId = bld!.id
  await raw.from('fire_facilities').insert([
    { building_id: buildingId, category: '소화활동설비', facility_code: FAC, installed: true },
  ])
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '종합', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id

  const ALL = [...OPEN_ONLY, ...CLOSED_ONLY]

  // ── ① 대조군 — 제원이 비면 4칸 모두 빈칸으로 인쇄된다(종전 동작) ──────────
  await setHeadType(null)
  const base = await marksOf(ALL)
  check('① 제원 미입력 — 4칸 전부 빈칸(종전 동작 그대로)',
    ALL.every(c => base.marks[c] === null), JSON.stringify(base.marks))
  const baseBlank = blankCount(base.blankWarn)
  check('① 대조군 미입력 경고 확보', baseBlank > 4, base.blankWarn)

  // ── ② 개방형 → 폐쇄형 전용만 ／로 인쇄 ─────────────────────────────────
  await setHeadType('개방형')
  const open = await marksOf(ALL)
  check('② 개방형 — 폐쇄형 전용(27-C-003·004)이 문서에 ／로 인쇄',
    CLOSED_ONLY.every(c => open.marks[c] === 'N'), JSON.stringify(open.marks))
  check('② 개방형 — 개방형 전용은 여전히 빈칸(사람이 채울 칸)',
    OPEN_ONLY.every(c => open.marks[c] === null), JSON.stringify(open.marks))
  check('② 미입력 경고가 잠긴 수만큼 줄었다(카운터와 인쇄가 같은 축)',
    blankCount(open.blankWarn) === baseBlank - CLOSED_ONLY.length,
    `${blankCount(open.blankWarn)} (대조군 ${baseBlank})`)

  // ── ③ 폐쇄형 → 정반대 ─────────────────────────────────────────────────
  await setHeadType('폐쇄형')
  const closed = await marksOf(ALL)
  check('③ 폐쇄형 — 개방형 전용(27-A-003·011)이 ／로 인쇄',
    OPEN_ONLY.every(c => closed.marks[c] === 'N'), JSON.stringify(closed.marks))
  check('③ 폐쇄형 — 폐쇄형 전용은 빈칸',
    CLOSED_ONLY.every(c => closed.marks[c] === null), JSON.stringify(closed.marks))

  // ── ④ 사람이 넣은 값이 자동 ／를 이긴다(순서 규약) ────────────────────────
  await raw.from('inspection_sheet_responses').insert(
    OPEN_ONLY.map(c => ({ inspection_id: inspId, item_code: c, result: 'O', month: 0 })))
  const overridden = await marksOf(ALL)
  check('④ 응답이 있으면 자동 ／가 아니라 그 값(○)이 인쇄된다',
    OPEN_ONLY.every(c => overridden.marks[c] === 'O'), JSON.stringify(overridden.marks))
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 400))
} finally {
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (customerId) {
    await raw.from('customer_facility_specs').delete().eq('customer_id', customerId)
    await cleanupCustomer(customerId)
  }
  if (userId) await delUser(userId)
  summary()
}
