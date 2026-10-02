/** 별지 9호 HWPX 렌더러 — 통합계획 B4 0단계(2026-10-02).
 *
 *  목적: 소민터 「한글파일 업로드 → 자동 입력」이 **HWPX를 받는지** 실업로드 1건으로 확인하는 시험 파일을
 *  ERP 데이터로 만든다. 통과하면 이 모듈이 ④ 칸 「소민터용 한글파일」 버튼의 렌더러가 된다.
 *
 *  원천은 HTML 별지 9호와 **같은 조립본**(`assembleReport9` → `Report9Data`)이다 — 값을 따로 계산하지 않는다.
 *  템플릿은 `erp_goal/_form/별지9호-placeholder.hwpx`(개정 2025. 12. 1. 8쪽, `{{key}}` 102개를 1회 심은 것,
 *  48a28eaa의 seed 스크립트 산출물). 방식은 zip 안 XML 단순 치환 — 한컴 SDK 없음.
 *
 *  범위(정직하게): 1~2쪽 심은 칸 전부 + 3쪽 설치 √·점검결과 ○×/. 2쪽 선임 형태·계단·경사로·다중이용업소
 *  개소수와 4~8쪽(세부 점검 결과·불량 내역)은 **빈 서식 그대로**다 — `stats.unfilled`에 적어 내보낸다.
 *
 *  **순수 모듈**: 파일을 읽지 않는다(호출부가 템플릿 바이트를 넘긴다). */
import JSZip from 'jszip'
import { FORM3_ITEMS, type Report9Data } from '@/lib/doc-templates/report9'

const CK_ON = '[√]', CK_OFF = '[  ]'
const ck = (b: boolean | undefined | null) => (b ? CK_ON : CK_OFF)
const mark = (r: 'O' | 'X' | 'N' | undefined) => (r === 'O' ? '○' : r === 'X' ? '×' : r === 'N' ? '/' : '')
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** 대수 칸 — HTML과 같은 판정(빈 값이 아니면 √) */
const has = (v: string | undefined | null) => !!String(v ?? '').trim()

/** 심은 키 → 값. HTML 별지 9호(`doc-templates/report9.ts` page1·page2)의 표현을 그대로 옮겼다 */
export function report9HwpxValues(d: Report9Data): { values: Record<string, string>; warnings: string[] } {
  const warnings: string[] = []
  const v: Record<string, string> = {
    ck_op: ck(d.ckOp), ck_initial: ck(d.ckInitial), ck_comp_etc: ck(d.ckCompEtc), ck_contractor: CK_ON,
    customer_name: d.customerName, purpose: d.purpose, address: d.address,
    insp_period: d.inspPeriod, insp_days: d.inspDays,
    company_name: d.companyName, company_phone: d.companyPhone,
    ck_consent_y: ck(d.consent === true), ck_consent_n: ck(d.consent === false), report_email: d.reportEmail,
    report_date: d.reportDate, submit_to: d.submitTo,
    ck_rep_owner: ck(d.repRole === '소유자'), ck_rep_manager: ck(d.repRole === '관리자'), ck_rep_occupant: ck(d.repRole === '점유자'),
    owner_name: d.ownerName, owner_phone: d.ownerPhone,
    ck_g0: ck(d.managerGrade === '특급'), ck_g1: ck(d.managerGrade === '1급'), ck_g2: ck(d.managerGrade === '2급'), ck_g3: ck(d.managerGrade === '3급'),
    mgr_name: d.mgrName, mgr_phone: d.mgrPhone, mgr_edu_date: d.mgrEduDate,
    ck_plan_y: ck(d.hasFirePlan), ck_plan_keep: ck(d.firePlanStored), ck_plan_nokeep: ck(d.firePlanUnstored), ck_plan_n: ck(d.firePlanNone),
    ck_prev_op_y: ck(d.prevOpDone), ck_prev_op_n: ck(d.prevOpNone), ck_prev_comp_y: ck(d.prevCompDone), ck_prev_comp_n: ck(d.prevCompNone),
    ck_edu_y: ck(d.eduDone), ck_edu_n: ck(d.eduNone), ck_drill_y: ck(d.drillDone), ck_drill_n: ck(d.drillNone),
    ck_ins_y: ck(d.insuranceJoined === true), ck_ins_n: ck(d.insuranceJoined === false),
    ins_company: d.insCompany, ins_period: d.insPeriod,
    // 단위 「만원」 — HTML과 같은 사용자 확정 단위(2026-08-24). 템플릿 원문엔 단위가 없다
    ins_person: has(d.insPerson) ? `${d.insPerson} 만원` : '', ins_property: has(d.insProperty) ? `${d.insProperty} 만원` : '',
    ck_multi_none: ck(d.multiUseNone),
    permit_date: d.permitDate, use_approval_date: d.useApprovalDate, total_area: d.totalArea, building_area: d.buildingArea,
    households: d.households, floors_above: d.floorsAbove, floors_below: d.floorsBelow, height_m: d.heightM, building_count: d.buildingCount,
    ck_st_con: ck(d.stCon), ck_st_steel: ck(d.stSteel), ck_st_brick: ck(d.stBrick), ck_st_wood: ck(d.stWood), ck_st_etc: ck(d.stEtc),
    ck_rf_slab: ck(d.rfSlab), ck_rf_tile: ck(d.rfTile), ck_rf_slate: ck(d.rfSlate), ck_rf_etc: ck(d.rfEtc),
    ck_elv_r: ck(has(d.elvR)), ck_elv_e: ck(has(d.elvE)), ck_elv_v: ck(has(d.elvV)), elv_r: d.elvR, elv_e: d.elvE, elv_v: d.elvV,
    ck_pk_in: ck(d.pkIn), ck_pk_ug: ck(d.pkInUg), ck_pk_gr: ck(d.pkInGround), ck_pk_pl: ck(d.pkInPiloti), ck_pk_mech: ck(d.pkMech),
    ck_pk_roof: ck(d.pkRoof), ck_pk_out: ck(d.pkOut),
  }
  const person = (p: { name: string; grade: string; licenseNo: string; period: string } | null | undefined, k: string) => {
    v[`${k}_name`] = p?.name ?? ''; v[`${k}_grade`] = p?.grade ?? ''; v[`${k}_no`] = p?.licenseNo ?? ''; v[`${k}_period`] = p?.period ?? ''
  }
  person(d.main, 'm')
  for (let i = 0; i < 5; i++) person(d.assistants[i], `a${i + 1}`)
  if (d.assistants.length > 5) warnings.push(`보조 점검인력 ${d.assistants.length}명 중 5명만 실림(서식 행 5)`)
  const others = d.otherBuildings?.length ?? 0
  if (others > 0) warnings.push(`대표동 외 ${others}개 동은 HWPX에 아직 안 실림(「다수동일때」 미배선)`)
  return { values: v, warnings }
}

/** 3쪽 ` [ ]항목` → ` [√]항목`. 런이 갈린 항목은 항목명 런 앞 400자 안의 마지막 `[ ]`(48a28eaa 방식) */
function checkItem(xml: string, item: string): [string, boolean] {
  const direct = `[ ]${item}`
  const at = xml.indexOf(direct)
  if (at >= 0) return [xml.slice(0, at) + `[√]${item}` + xml.slice(at + direct.length), true]
  const pos = xml.indexOf(`<hp:t>${item}`)
  if (pos < 0) return [xml, false]
  const from = Math.max(0, pos - 400)
  const ckAt = xml.slice(from, pos).lastIndexOf('[ ]')
  if (ckAt < 0) return [xml, false]
  const abs = from + ckAt
  return [xml.slice(0, abs) + '[√]' + xml.slice(abs + 3), true]
}

/** 항목 셀 다음 셀(점검결과란)의 빈 런에 ○×/ 주입 */
function resultAfter(xml: string, item: string, m: string): [string, boolean] {
  const pos = xml.indexOf(item)
  if (pos < 0) return [xml, false]
  const tcEnd = xml.indexOf('</hp:tc>', pos)
  if (tcEnd < 0) return [xml, false]
  const nxt = xml.indexOf('<hp:tc ', tcEnd)
  if (nxt < 0) return [xml, false]
  const cellEnd = xml.indexOf('</hp:tc>', nxt)
  const cell = xml.slice(nxt, cellEnd)
  const run = cell.match(/<hp:run charPrIDRef="(\d+)"\/>/)
  if (!run) return [xml, false]
  const filled = cell.replace(run[0], `<hp:run charPrIDRef="${run[1]}"><hp:t>${m}</hp:t></hp:run>`)
  return [xml.slice(0, nxt) + filled + xml.slice(cellEnd), true]
}

export type Report9HwpxStats = {
  placeholders: number; filled: number; empty: string[]; leftover: number
  checks: { ok: number; total: number; missed: string[] }
  results: { ok: number; total: number; missed: string[] }
  unfilled: string[]; warnings: string[]
}

/** 렌더 — 템플릿 바이트 + 조립본 → HWPX 바이트와 채움 통계 */
export async function renderReport9Hwpx(
  template: Uint8Array | ArrayBuffer, d: Report9Data,
): Promise<{ bytes: Uint8Array; stats: Report9HwpxStats }> {
  // createFolders:false — 템플릿에 없는 폴더 항목(Contents/ 등)을 만들지 않는다(항목 목록을 원본과 같게)
  const zip = await JSZip.loadAsync(template, { createFolders: false })
  const { values, warnings } = report9HwpxValues(d)
  const secFile = zip.file('Contents/section0.xml')
  if (!secFile) throw new Error('템플릿에 Contents/section0.xml이 없습니다')
  let xml = await secFile.async('string')
  const keys = [...new Set([...xml.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map(m => m[1]))]
  const unknown = keys.filter(k => !(k in values))
  if (unknown.length) throw new Error(`템플릿 자리표시자에 값 규칙이 없습니다: ${unknown.join(', ')}`)
  const empty: string[] = []
  for (const k of keys) {
    const val = values[k] ?? ''
    if (!val && !k.startsWith('ck_')) empty.push(k)
    xml = xml.split(`{{${k}}}`).join(xmlEsc(val))
  }
  // 3쪽 — 설치 √와 점검결과(HTML과 같은 규칙: 결과가 없고 설치면 ○)
  const ckMissed: string[] = [], rsMissed: string[] = []
  let ckOk = 0, rsOk = 0, rsTotal = 0
  for (const item of d.facilityChecks) {
    const [next, ok] = checkItem(xml, item); xml = next
    if (ok) ckOk++; else ckMissed.push(item)
  }
  for (const item of FORM3_ITEMS) {
    const m = mark(d.resultMarks[item] ?? (d.facilityChecks.includes(item) ? 'O' : undefined))
    if (!m) continue
    rsTotal++
    const [next, ok] = resultAfter(xml, item, m); xml = next
    if (ok) rsOk++; else rsMissed.push(item)
  }
  const leftover = (xml.match(/\{\{[a-z0-9_]+\}\}/g) ?? []).length
  zip.file('Contents/section0.xml', xml, { createFolders: false })
  // 미리보기 텍스트도 같은 값으로(탐색기 미리보기에 {{key}}가 보이지 않게)
  const prv = zip.file('Preview/PrvText.txt')
  if (prv) {
    let t = await prv.async('string')
    for (const k of keys) t = t.split(`{{${k}}}`).join(values[k] ?? '')
    zip.file('Preview/PrvText.txt', t.replace(/\{\{[a-z0-9_]+\}\}/g, ''), { createFolders: false })
  }
  // 템플릿에서 무압축인 두 항목(mimetype은 OPC 규약상 필수)은 그대로 무압축. 항목 순서는 JSZip이 유지한다
  for (const name of ['mimetype', 'version.xml']) {
    const f = zip.file(name)
    if (f) zip.file(name, await f.async('uint8array'), { compression: 'STORE', createFolders: false })
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    bytes,
    stats: {
      placeholders: keys.length, filled: keys.length - empty.length, empty, leftover,
      checks: { ok: ckOk, total: d.facilityChecks.length, missed: ckMissed },
      results: { ok: rsOk, total: rsTotal, missed: rsMissed },
      unfilled: ['2쪽 소방안전관리자 선임 형태', '2쪽 계단·경사로 개소', '2쪽 다중이용업소 업종별 개소수', '4~8쪽 세부 점검 결과·불량 내역'],
      warnings,
    },
  }
}
