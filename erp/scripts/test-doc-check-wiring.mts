// 문서 체크칸 배선 전수 불변식 — 「사람이 체크한 것은 문서에도 체크된다」 (2026-09-21 신설)
//
// 왜 생겼나 — 같은 결함이 최소 네 번 재발했다:
//   2026-08-08 소화기구·피난기구 하위가 `ck(false)` 하드코딩이라 입력해도 늘 빈 칸
//   2026-09-0x 1.4 · 1.8 · 1.10.1 앵커 0칸(엑셀이 그 칸을 아예 안 채웠다)
//   2026-09-21 기타 3종이 **체크까지 점검표 응답에서** 뽑아, 대장 ☑가 문서엔 빈 상자(용문3 신고)
// 셋 다 증상이 같다: **화면에서는 체크했는데 문서에는 안 나온다.** 그리고 셋 다 tsc·소스 단언을
// 통과했다 — 모양은 멀쩡하고 값만 안 흐르는 부류라, 검사는 **실제 산출물을 열어 봐야** 한다.
//
// 불변식(둘 다 행위 단언 — 소스가 아니라 받은 파일을 읽는다):
//   A(양성) 대장을 **전건** 체크하고 점검표 응답을 **0건**으로 두면, 배선된 체크칸은 **전부 √**.
//           ← 새 행을 응답 축으로 배선하면 여기서 빨개진다(기타 3종 결함의 정확한 재현).
//           ← 새 행을 배선하지 않아도 빨개진다(앵커 0칸의 재현).
//   B(음성) 대장이 **비어 있으면** 그 칸들은 **전부 빈 상자**. ← 무조건 √를 찍는 반대 결함을 막는다.
//
// 축이 셋이라 fixture도 셋을 함께 심는다(하나라도 빠지면 그 축이 조용히 빠진다):
//   · 소방시설 40종 + 소화기구 하위 5종 + 기타 3종 → fire_facilities(대장)
//   · 피난기구 하위 3칸 → customer_facility_specs `s36_evac.evac_equipment.types`(세부제원)
// 설계상 미배선인 칸(FORM4_UNWIRED — 다중이용업소 16칸)은 **제품이 스스로 신고한 목록**을 그대로
// 제외한다. 손으로 다시 적으면 그 목록이 줄어도 검사가 모른다.
//
// 실행: npx tsx scripts/test-doc-check-wiring.mts   (로컬 dev + 스테이징 DB)
import XLSX from 'xlsx'
import { FORM4_ROWS, FORM4_ETC_ROWS, FORM4_UNWIRED } from '../src/lib/xlsx-form4'
import { ALL_STANDARD_CODES, FIRE_SUB_ITEMS, EVAC_FORM3_GROUPS } from '../src/lib/facility-codes'
import { ETC_LEDGER_CODE, ETC_KEYS } from '../src/lib/etc-sheet-map'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'doc-wiring-e2e@erp-test.com'
const ETC3 = ETC_KEYS.map(k => ETC_LEDGER_CODE[k])
/** 피난기구 하위 3칸을 켜는 세부제원 종류 — 묶음마다 첫 종류 하나씩 */
const EVAC_TYPES = EVAC_FORM3_GROUPS.map(g => g[0])

let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(d: number): string {
  const t = new Date(Date.now() + 9 * 3600_000)
  t.setDate(t.getDate() + d)
  return t.toISOString().split('T')[0]
}

/** 고객 + 건물 + (선택) 대장 전건 + (선택) 세부제원 + 종합 회차. 응답은 절대 넣지 않는다. */
async function fixture(name: string, seeded: boolean) {
  const customerId = await mkCustomer({ customer_name: name, created_by: userId, inspection_type: '일반관리' })
  custIds.push(customerId)
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  if (seeded) {
    for (const c of [...new Set([...ALL_STANDARD_CODES, ...FIRE_SUB_ITEMS, ...ETC3])]) {
      await raw.from('fire_facilities').insert({ building_id: bld!.id, category: '배선검사', facility_code: c, installed: true })
    }
    await raw.from('customer_facility_specs').insert({
      customer_id: customerId, building_id: bld!.id, section_key: 's36_evac',
      spec: { evac_equipment: { types: EVAC_TYPES } },
    })
  }
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_종합',
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`회차 생성 실패: ${error.message}`)
  return { customerId, inspectionId: ins!.id as string }
}

/** 배선된 체크칸 전부 — 제품의 표(FORM4_ROWS·FORM4_ETC_ROWS)에서 만들고, 제품이 신고한 미배선만 뺀다 */
function wiredCells(): Array<{ cell: string; label: string }> {
  const unwired = new Set(FORM4_UNWIRED.map(r => r.cell))
  const rows: Array<{ cell: string; label: string }> = []
  for (const r of FORM4_ROWS) {
    if (!r.cell || unwired.has(r.cell)) continue
    rows.push({ cell: r.cell, label: (r.codes ?? [])[0] ?? (r.evacGroup !== undefined ? `피난기구 하위 ${r.evacGroup}` : r.cell) })
  }
  for (const r of FORM4_ETC_ROWS) rows.push({ cell: r.cell, label: r.label })
  return rows
}

try {
  userId = await mkUser({ email: EMAIL, name: '배선불변식', employeeId: 'E2E-WIRING' })
  const cells = wiredCells()
  check('표본 — 배선된 체크칸이 충분히 많다(표가 비면 공허 통과)', cells.length >= 40, `${cells.length}칸`)
  check('설계상 미배선 목록은 제품이 신고한 것을 그대로 쓴다', FORM4_UNWIRED.length > 0, `${FORM4_UNWIRED.length}칸`)

  const seeded = await fixture('배선불변식전건E2E', true)
  const empty = await fixture('배선불변식공백E2E', false)

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const readSheet = async (inspectionId: string) => {
    const res = await page.request.get(`${BASE}/inspections/${inspectionId}/workbook`)
    if (!res.ok()) return null
    return XLSX.read(Buffer.from(await res.body()), { type: 'buffer' }).Sheets['현황']
  }

  // ── A(양성) 대장·세부제원 전건 · 응답 0건 → 배선된 칸은 전부 √ ──
  const wsA = await readSheet(seeded.inspectionId)
  check('A 워크북 생성', !!wsA)
  if (wsA) {
    const val = (c: string) => String((wsA[c] as { v?: unknown } | undefined)?.v ?? '')
    const missing = cells.filter(c => !val(c.cell).includes('√'))
    check('★ A — 체크한 것은 문서에도 체크된다(배선 전수)',
      missing.length === 0,
      missing.map(m => `${m.cell} ${m.label}="${val(m.cell)}"`).join(' · '))
    // 응답이 0건인데도 √여야 한다 = **체크 축이 점검표가 아님**을 직접 못박는다
    const { data: resp } = await raw.from('inspection_sheet_responses')
      .select('id').eq('inspection_id', seeded.inspectionId).limit(1)
    check('★ A 전제 — 점검표 응답이 0건이다(그래도 √여야 한다)', (resp ?? []).length === 0)
  }

  // ── B(음성) 대장 비어 있음 → 그 칸들은 전부 빈 상자 ──
  const wsB = await readSheet(empty.inspectionId)
  check('B 워크북 생성', !!wsB)
  if (wsB) {
    const val = (c: string) => String((wsB[c] as { v?: unknown } | undefined)?.v ?? '')
    const wrong = cells.filter(c => val(c.cell).includes('√'))
    check('★ B — 체크 안 한 것은 문서에도 체크되지 않는다',
      wrong.length === 0,
      wrong.map(m => `${m.cell} ${m.label}="${val(m.cell)}"`).join(' · '))
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of custIds) {
    const { data: insps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of insps ?? []) {
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
    }
    await raw.from('customer_facility_specs').delete().eq('customer_id', cid)
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', cid)
    for (const b of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b.id)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
