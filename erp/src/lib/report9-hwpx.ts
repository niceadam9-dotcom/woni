/** 별지 9호 HWPX 렌더러 — 통합계획 B4 0단계(2026-10-02).
 *
 *  목적: 소민터 「한글파일 업로드 → 자동 입력」이 **HWPX를 받는지** 실업로드 1건으로 확인하는 시험 파일을
 *  ERP 데이터로 만든다. 통과하면 이 모듈이 ④ 칸 「소민터용 한글파일」 버튼의 렌더러가 된다.
 *
 *  원천은 HTML 별지 9호와 **같은 조립본**(`assembleReport9` → `Report9Data`)이다 — 값을 따로 계산하지 않는다.
 *  템플릿은 `erp_goal/_form/별지9호-placeholder.hwpx`(개정 2025. 12. 1. 8쪽, `{{key}}` 102개를 1회 심은 것,
 *  48a28eaa의 seed 스크립트 산출물). 방식은 zip 안 XML 단순 치환 — 한컴 SDK 없음.
 *
 *  2026-10-03 소민터 실업로드 통과(HWPX 수용 확인) → 1단계: 2쪽 선임 형태·다중이용업소 개소수·경사로·계단,
 *  3쪽 하위 항목 √·기타 3항목·2절 안전시설등, 8쪽 불량 세부 사항을 더 채운다.
 *  2단계(같은 날): 4~7쪽 세부 현황 — `report9-hwpx-specs`(PDF 세부현황 렌더를 줄 골격으로 옮김).
 *  범위(정직하게): 서식과 HTML 표기가 달라 짝을 못 지은 문단은 빈 서식 — `stats.unfilled`·`stats.specs`에 적어 내보낸다.
 *
 *  **순수 모듈**: 파일을 읽지 않는다(호출부가 템플릿 바이트를 넘긴다). */
import JSZip from 'jszip'
import {
  FORM3_ITEMS, MULTI_USE_COLS, DEFECT_GROUPS, DEFECT_FOLD_TEXT, foldDefectGroups, type Report9Data,
} from '@/lib/doc-templates/report9'
import { EVAC_FORM3_GROUPS, FIRE_SUB_ITEMS, evacTypesFromSpecs } from '@/lib/facility-codes'
import { ETC_LEDGER_CODE, type EtcKey } from '@/lib/etc-sheet-map'
import { fillSpecPages, type SpecFillStats } from '@/lib/report9-hwpx-specs'

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

// ── 1단계(2026-10-03, 소민터 실업로드 통과 뒤) — 표 단위 편집 ─────────────────────────────
// 템플릿 실측: 최상위 표 0~7이 1~8쪽 한 장씩이고 그 안에 중첩 표가 없다(9·10쪽 작성방법·예시만 중첩).
// 쪽 경계로 범위를 좁혀야 같은 문구(「피난기구」「방화문」「[ ]스프링클러설비」)가 3쪽 1절·2절·
// 4~7쪽에 거듭 나와도 엉뚱한 칸에 찍히지 않는다.

/** k번째 표(0=1쪽 … 7=8쪽)를 fn으로 고쳐 끼운다 */
function editTable(xml: string, k: number, fn: (t: string) => string): string {
  let at = -1
  for (let i = 0; i <= k; i++) {
    at = xml.indexOf('<hp:tbl ', at + 1)
    if (at < 0) throw new Error(`템플릿에 ${k + 1}번째 표가 없습니다`)
  }
  const end = xml.indexOf('</hp:tbl>', at) + '</hp:tbl>'.length
  const t = xml.slice(at, end)
  if (t.indexOf('<hp:tbl ', 1) >= 0) throw new Error(`${k + 1}쪽 표 안에 중첩 표 — 템플릿 구조가 바뀌었습니다`)
  return xml.slice(0, at) + fn(t) + xml.slice(end)
}

/** label 앞 같은 문단 안의 마지막 `[ ]`/`[  ]`를 `[√]`로 — 런이 갈려도(`[ ]</hp:t></hp:run><hp:run…><hp:t>라벨`) 잡는다.
 *  on=false면 그대로 두고 찾았는지만 알린다. from 이후 첫 등장만 본다 */
function checkLabel(seg: string, label: string, on: boolean, from = 0): [string, boolean] {
  const pos = seg.indexOf(label, from)
  if (pos < 0) return [seg, false]
  const pStart = seg.lastIndexOf('<hp:p ', pos)
  const head = seg.slice(pStart, pos)
  const m = [...head.matchAll(/\[ {1,2}\]|\[√\]/g)].pop()
  if (!m || m.index === undefined) return [seg, false]
  if (!on) return [seg, true]
  const abs = pStart + m.index
  return [seg.slice(0, abs) + CK_ON + seg.slice(abs + m[0].length), true]
}

/** 빈 칸(`<hp:run charPrIDRef="n"/>`) 하나뿐인 문단을 줄 수만큼 복제해 채운다.
 *  줄이 바뀐 문단은 linesegarray(한글의 줄 배치 캐시)를 떼어 한글이 다시 배치하게 한다 */
function fillEmptyCell(cell: string, lines: string[]): string {
  const p = cell.match(/<hp:p [^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:run charPrIDRef="(\d+)"\/>[\s\S]*?<\/hp:p>/)
  if (!p || !lines.length) return cell
  const open = p[0].match(/^<hp:p [^>]*>/)![0]
  const paras = lines.map(l => `${open}<hp:run charPrIDRef="${p[1]}"><hp:t>${xmlEsc(l)}</hp:t></hp:run></hp:p>`).join('')
  return cell.replace(p[0], paras)
}

/** 셀 경계 — pos를 품은 `<hp:tc …>…</hp:tc>`와 그 다음 셀들 */
function cellsFrom(seg: string, pos: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let s = seg.lastIndexOf('<hp:tc ', pos)
  for (let i = 0; i < n && s >= 0; i++) {
    const e = seg.indexOf('</hp:tc>', s) + '</hp:tc>'.length
    out.push([s, e])
    s = seg.indexOf('<hp:tc ', e)
  }
  return out
}

/** 2쪽 — 선임 형태·다중이용업소 개소수·경사로·계단(0단계 미채움 칸). 표기는 10쪽 작성 예시 그대로 「( 1개소)」 */
function fillPage2(t: string, d: Report9Data, miss: string[]): string {
  // 선임 형태 — 그 한 문단 안에서만(아래 건축물구조·지붕구조에도 「기타」가 있다)
  const ap = t.indexOf('소방기술자격')
  if (ap < 0) miss.push('2쪽 선임 형태')
  else {
    const ps = t.lastIndexOf('<hp:p ', ap), pe = t.indexOf('</hp:p>', ap)
    let para = t.slice(ps, pe)
    for (const k of ['소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타']) {
      const [next, ok] = checkLabel(para, k, d.mgrAppointType === k)
      para = next
      if (!ok) miss.push(`2쪽 선임 형태 ${k}`)
    }
    t = t.slice(0, ps) + para + t.slice(pe)
  }
  // 다중이용업소 — 「게임제공업」은 「복합유통게임제공업」「인터넷컴퓨터게임시설제공업」의 꼬리라 앞 글자를 못박는다
  // 원문이 줄바꿈으로 런을 갈라 둔 업종(「인터넷컴퓨터게임시설<lineBreak/>」+「제공업(  개소)」)은 꼬리 런을 닻으로
  const TAIL: Record<string, string> = { 인터넷컴퓨터게임시설제공업: '제공업' }
  for (const cat of MULTI_USE_COLS.flat()) {
    const anchor = TAIL[cat] ?? cat
    const re = new RegExp(`(${TAIL[cat] ? '' : '\\]|'}<hp:t>)${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(  개소\\)`)
    const m = re.exec(t)
    if (!m) { miss.push(`2쪽 다중이용업소 ${cat}`); continue }
    const cnt = String(d.multiUseCounts?.[cat] ?? '').trim()
    if (!cnt) continue
    const at = m.index + m[1].length
    const filled = `${anchor}( ${xmlEsc(cnt)}개소)`
    t = t.slice(0, at) + filled + t.slice(at + anchor.length + '(  개소)'.length)
    t = checkLabel(t, filled, true, Math.max(0, at - 600))[0]
  }
  // 경사로 — 칸 전체가 「              개소」
  const RAMP = '<hp:t>              개소</hp:t>'
  if (!t.includes(RAMP)) miss.push('2쪽 경사로')
  else if (has(d.rampCount)) t = t.replace(RAMP, `<hp:t>${xmlEsc(d.rampCount.trim())}개소</hp:t>`)
  // 계단 — 직통(또는 피난계단)·특별피난계단
  const ST = '[  ]직통(또는 피난계단) (    개소), [  ]특별피난계단 (    개소)'
  if (!t.includes(ST)) miss.push('2쪽 계단')
  else {
    const n1 = String(d.stairsCount ?? '').trim(), n2 = String(d.specialStairCount ?? '').trim()
    t = t.replace(ST, `${ck(!!n1)}직통(또는 피난계단) (${n1 ? ` ${xmlEsc(n1)}` : '    '}개소), ${ck(!!n2)}특별피난계단 (${n2 ? ` ${xmlEsc(n2)}` : '    '}개소)`)
  }
  return t
}

/** 3쪽 — 하위 항목 √(소화기구 5·피난기구 3)·기타 3항목·2절 안전시설등(MU-001~016).
 *  규칙은 HTML(`facilityResultSection`·`muResultSection`)과 같다. 단 서식 원문은 부모+하위가 **한 칸·결과 한 칸**이라
 *  하위별 결과는 없다(그 칸엔 0단계대로 부모 롤업이 들어간다) */
function fillPage3(t: string, d: Report9Data, miss: string[]): { t: string; marks: number } {
  const SEC2 = '2. 안전시설등 점검 결과'
  const cut = t.indexOf(SEC2)
  if (cut < 0) { miss.push('3쪽 2절'); return { t, marks: 0 } }
  let s1 = t.slice(0, cut), s2 = t.slice(cut)
  let marks = 0
  const ledger = new Set(d.ledgerCodes ?? [])
  const evac = new Set(evacTypesFromSpecs(d.specs))
  const subs: Array<[string, boolean]> = [
    ['소화기구(소화기, 자확, 간이)', ledger.has(FIRE_SUB_ITEMS[0])],
    ['주거용주방자동소화장치', ledger.has(FIRE_SUB_ITEMS[1])],
    ['상업용주방자동소화장치', ledger.has(FIRE_SUB_ITEMS[2])],
    ['캐비닛형자동소화장치', ledger.has(FIRE_SUB_ITEMS[3])],
    ['가스ㆍ분말ㆍ고체자동소화장치', ledger.has(FIRE_SUB_ITEMS[4])],
    ['공기안전매트ㆍ피난사다리', EVAC_FORM3_GROUPS[0].some(x => evac.has(x))],
    ['다수인피난장비', EVAC_FORM3_GROUPS[1].some(x => evac.has(x))],
    ['승강식피난기', EVAC_FORM3_GROUPS[2].some(x => evac.has(x))],
  ]
  for (const [label, on] of subs) {
    const [next, ok] = checkLabel(s1, label, on); s1 = next
    if (!ok) miss.push(`3쪽 하위 ${label}`)
  }
  // 기타 3 — 체크=대장(ETC_LEDGER_CODE), 결과=점검표(무응답 ／, 2026-08-20 확정)
  const etc: Array<[EtcKey, string]> = [['door', '방화문, 자동방화셔터'], ['exit', '비상구, 피난통로'], ['flame', '방  염']]
  for (const [key, label] of etc) {
    const [n1, ok] = checkLabel(s1, label, ledger.has(ETC_LEDGER_CODE[key])); s1 = n1
    const [n2, ok2] = resultAfter(s1, label, mark(d.etcMarks?.[key] ?? 'N')); s1 = n2
    if (!ok || !ok2) miss.push(`3쪽 기타 ${label}`); else marks++
  }
  // 2절 — ○/×면 √+결과, ／면 결과만(muResultSection과 같은 규약). 라벨은 그 칸에서만 나오는 앞머리
  const MU: Array<[string, string]> = [
    ['MU-001', '소화기 또는 자동확산소화기'], ['MU-002', '간이스프링클러설비'], ['MU-003', '비상경보설비 또는'],
    ['MU-004', '가스누설경보기'], ['MU-005', '피난기구'], ['MU-006', '피난유도선'],
    ['MU-008', '도등, 유도표지 또는 비상조명등'], // 원문이 「 [ ]유|도등…」으로 런을 가른다 ['MU-009', '휴대용비상조명등'],
    ['MU-011', '방화문'], ['MU-012', '비상구(비상탈출구)'], ['MU-013', '영업장 내부 피난통로'],
    ['MU-014', '영상음향차단장치'], ['MU-015', '누전차단기'], ['MU-010', '창 문'],
    ['MU-007', '피난안내도, 피난안내영상물'], ['MU-016', '방염대상물품'],
  ]
  for (const [code, label] of MU) {
    const r = d.muResults?.[code]
    const [n1, ok] = checkLabel(s2, label, r === 'O' || r === 'X'); s2 = n1
    if (!ok) { miss.push(`3쪽 2절 ${label}`); continue }
    if (!r) continue
    const [n2, ok2] = resultAfter(s2, label, mark(r)); s2 = n2
    if (ok2) marks++; else miss.push(`3쪽 2절 결과 ${label}`)
  }
  return { t: s1 + s2, marks }
}

/** 8쪽 — 불량 세부 사항. 접기(결과참조/이상없음/해당없음)는 PDF page8과 같은 `foldDefectGroups`.
 *  한 구분 행 안에서 점검번호마다 한 문단, 같은 번호의 불량내용은 이어지는 문단(10쪽 작성 예시 12 꼴)이고
 *  점검번호 칸은 빈 문단으로 줄을 맞춘다 */
function fillPage8(t: string, d: Report9Data, miss: string[]): { t: string; rows: number } {
  const folds = d.applicableGroups ? foldDefectGroups(d.defectRows, d.applicableGroups) : null
  let rows = 0
  for (const g of DEFECT_GROUPS) {
    const pos = t.indexOf(`<hp:t>${g}</hp:t>`)
    if (pos < 0) { miss.push(`8쪽 ${g}`); continue }
    const f = folds?.get(g)
    const list = f ? (f.kind === 'rows' ? f.rows : []) : d.defectRows.filter(r => r.group === g)
    const codes: string[] = [], contents: string[] = []
    if (list.length) {
      let prev: string | null = null
      for (const r of list) {
        codes.push(r.code === prev ? '' : r.code)
        contents.push(r.content)
        prev = r.code
      }
      rows += list.length
    } else if (f && f.kind !== 'rows') {
      codes.push(''); contents.push(DEFECT_FOLD_TEXT[f.kind])
    } else continue
    const [, c1, c2] = cellsFrom(t, pos, 3)
    if (!c1 || !c2) { miss.push(`8쪽 ${g} 칸`); continue }
    // 뒤 칸부터 갈아끼워야 앞 칸 오프셋이 안 밀린다
    const n2 = fillEmptyCell(t.slice(c2[0], c2[1]), contents)
    t = t.slice(0, c2[0]) + n2 + t.slice(c2[1])
    const n1 = codes.some(Boolean) ? fillEmptyCell(t.slice(c1[0], c1[1]), codes) : t.slice(c1[0], c1[1])
    t = t.slice(0, c1[0]) + n1 + t.slice(c1[1])
  }
  return { t, rows }
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
  /** 1단계 — 3쪽 기타·2절 결과 주입 수, 8쪽 불량 행 수, 템플릿에서 못 찾은 칸(0이어야 정상) */
  extra: { page3Marks: number; defectRows: number; missed: string[] }
  /** 2단계 — 4~7쪽 세부 현황: 칸 있는 문단 수·짝지은 수·못 붙인 문단 앞머리·바꾼 칸 수 */
  specs: SpecFillStats
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
  // 3쪽 1절 — 설치 √와 점검결과(HTML과 같은 규칙: 결과가 없고 설치면 ○). 3쪽 표의 1절 범위 안에서만 찾는다
  const ckMissed: string[] = [], rsMissed: string[] = [], miss: string[] = []
  let ckOk = 0, rsOk = 0, rsTotal = 0, p3marks = 0, defectRows = 0
  xml = editTable(xml, 2, t => {
    const cut = t.indexOf('2. 안전시설등 점검 결과')
    let s1 = cut < 0 ? t : t.slice(0, cut)
    for (const item of d.facilityChecks) {
      const [next, ok] = checkItem(s1, item); s1 = next
      if (ok) ckOk++; else ckMissed.push(item)
    }
    for (const item of FORM3_ITEMS) {
      const m = mark(d.resultMarks[item] ?? (d.facilityChecks.includes(item) ? 'O' : undefined))
      if (!m) continue
      rsTotal++
      const [next, ok] = resultAfter(s1, item, m); s1 = next
      if (ok) rsOk++; else rsMissed.push(item)
    }
    const r = fillPage3(cut < 0 ? s1 : s1 + t.slice(cut), d, miss)
    p3marks = r.marks
    return r.t
  })
  xml = editTable(xml, 1, t => fillPage2(t, d, miss))
  xml = editTable(xml, 7, t => { const r = fillPage8(t, d, miss); defectRows = r.rows; return r.t })
  // 4~7쪽 — PDF와 같은 세부현황 렌더를 줄 골격으로 옮긴다(report9-hwpx-specs)
  const specs = fillSpecPages((k, fn) => { xml = editTable(xml, k, fn) }, d)
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
      extra: { page3Marks: p3marks, defectRows, missed: miss },
      specs,
      // 세부현황은 채우되, 서식과 HTML 표기가 달라 짝을 못 지은 문단은 빈 서식으로 남는다 — 그 수를 밝힌다
      unfilled: specs.unmatched.length ? [`4~7쪽 세부 현황 중 ${specs.unmatched.length}줄`] : [],
      warnings,
    },
  }
}
