/** 별지 9호(소방시설등 자체점검 실시결과 보고서) HTML 템플릿 — 8쪽 전체 (소방계획서_7 H-5)
 *
 *  서식 원문: erp_goal/_form/별지9호-placeholder.hwpx section0.xml(개정 2025. 12. 1.) 추출(2026-08-03) —
 *  1~3쪽 문구·표 구성 동일 재현, 4~7쪽 세부 현황·8쪽 불량 세부는 _doc01 htm 0004~0008 표 구조 참조.
 *  기준 문서: erp_goal/_doc01/별지9호.MD. 렌더는 순수 함수(조회 없음) — 데이터 조립은 report9-actions.
 *  개선(MD §4): 8쪽 불량 세부 자동(defects+점검번호), 보조 점검인력 5명 초과 시 행 동적 추가.
 *  4~7쪽 세부 현황(3-1~3-8)은 customer_facility_specs 주입 — 공용 렌더 spec-sections(H-21,
 *  별지 4호 3~7쪽과 동일 원본). specs 미보유 시 빈 객체 → 종전 빈 서식과 동등 출력. */

import { renderDocument, pageHeader, pageFooter, esc, val, ck, resultMark } from './base'
import { renderSpecSections, specNoteTable, type SpecMap } from './spec-sections'

/** 3쪽 1절 점검 결과 항목 — scripts/make-report9.py FORM3_ITEMS와 1:1 (순서 = 설비 구분 경계) */
export const FORM3_ITEMS: string[] = [
  // 소화설비 (0~14)
  '소화기구 및 자동소화장치', '옥내소화전설비', '스프링클러설비', '간이스프링클러설비',
  '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비', '이산화탄소소화설비',
  '할론소화설비', '할로겐화합물 및 불활성기체 소화설비', '분말소화설비', '강화액소화설비', '고체에어로졸소화설비',
  '옥외소화전설비',
  // 경보설비 (15~23)
  '단독경보형감지기', '비상경보설비', '자동화재탐지설비 및 시각경보기', '화재알림설비', '비상방송설비',
  '통합감시시설', '자동화재속보설비', '누전경보기', '가스누설경보기',
  // 피난구조설비 (24~30)
  '피난기구', '인명구조기구', '유도등', '유도표지', '피난유도선', '비상조명등', '휴대용비상조명등',
  // 소화용수설비 (31~32)
  '상수도소화용수설비', '소화수조 및 저수조',
  // 소화활동설비 (33~39)
  '거실제연설비', '부속실 등 제연설비', '연결송수관설비', '연결살수설비', '비상콘센트설비',
  '무선통신보조설비', '연소방지설비',
]

/** FORM3 항목 → 8쪽 설비 구분 (인덱스 경계 = 서식 3쪽 구분 배치) */
export function form3Group(item: string): string {
  const i = FORM3_ITEMS.indexOf(item)
  if (i < 0) return '기타'
  if (i < 15) return '소화설비'
  if (i < 24) return '경보설비'
  if (i < 31) return '피난구조설비'
  if (i < 33) return '소화용수설비'
  return '소화활동설비'
}

/** 8쪽 불량 세부 사항 구분 행 — 서식 원문 순서 고정(빈 구분도 행 유지) */
export const DEFECT_GROUPS = ['소화설비', '경보설비', '피난구조설비', '소화용수설비', '소화활동설비', '기타', '안전시설등'] as const

/** 2쪽 다중이용업소현황 업종 배열 — 서식 원문 3열 배치(doc-requirements MULTI_USE_CATEGORIES와 명칭 일치) */
const MULTI_USE_COLS: string[][] = [
  ['휴게음식점영업', '단란주점영업', '비디오물감상실업', '학원', '찜질방업', '복합유통게임제공업', '산후조리업', '가상체험 체육시설업', '화상대화방업'],
  ['제과점영업', '유흥주점영업', '비디오물소극장업', '독서실', '게임제공업', '노래연습장업', '고시원업', '안마시술소', '수면방업'],
  ['일반음식점영업', '영화상영관', '복합영상물제공업', '목욕장업', '인터넷컴퓨터게임시설제공업', '권총사격장', '전화방업', '콜라텍업'],
]

export type Report9Person = { name: string; grade: string; licenseNo: string; period: string }
export type Report9DefectRow = { group: string; code: string; content: string }

export type Report9Data = {
  // ── 1쪽 표지 ──
  ckOp: boolean               // 작동점검
  ckInitial: boolean          // 최초점검
  ckCompEtc: boolean          // 그 밖의 종합점검
  customerName: string
  purpose: string
  address: string
  inspPeriod: string          // 예: 2026년 8월 1일 ~ 2026년 8월 2일
  inspDays: string
  companyName: string         // 점검자 — 소방시설관리업자(항상 체크, §9-6①)
  companyPhone: string
  consent: boolean | null     // 전자우편 송달 동의 (null=공란)
  reportEmail: string
  main: Report9Person | null  // 주된 점검인력
  assistants: Report9Person[] // 보조 점검인력 — 기본 5행, 초과분 행 추가
  reportDate: string
  submitTo: string            // 예: 관계인ㆍ○○소방서장
  // ── 2쪽 1. 소방안전정보 ──
  repRole: string             // '소유자'|'관리자'|'점유자'|''
  ownerName: string
  ownerPhone: string
  managerGrade: string        // '특급'|'1급'|'2급'|'3급'|''
  mgrName: string
  mgrPhone: string
  mgrEduDate: string
  hasFirePlan: boolean        // true → 작성+보관 체크 (워커 동일 — 미보관·미작성 단정 안 함)
  prevOpDone: boolean         // 전년도 작동점검 실시
  prevCompDone: boolean       // 전년도 종합점검 실시
  eduDone: boolean
  drillDone: boolean
  insuranceJoined: boolean | null
  insCompany: string
  insPeriod: string
  insPerson: string
  insProperty: string
  multiUseNone: boolean                  // 해당없음 체크
  multiUseCounts: Record<string, string> // 업종명 → 개소수 (fire_plan_forms sections.multiUse)
  // ── 2쪽 2. 건축물 정보 ──
  permitDate: string
  useApprovalDate: string
  totalArea: string
  buildingArea: string
  households: string
  floorsAbove: string
  floorsBelow: string
  heightM: string
  buildingCount: string
  stCon: boolean; stSteel: boolean; stBrick: boolean; stWood: boolean; stEtc: boolean
  rfSlab: boolean; rfTile: boolean; rfSlate: boolean; rfEtc: boolean
  elvR: string; elvE: string; elvV: string  // 승용·비상용·피난용 대수 (체크 = 대수 존재)
  pkIn: boolean; pkMech: boolean; pkRoof: boolean; pkOut: boolean
  // ── 3쪽 ──
  facilityChecks: string[]                    // 설치 설비(√) — FORM3_ITEMS 명칭
  resultMarks: Record<string, 'O' | 'X' | 'N'>  // 항목 → 점검결과 (○/×//)
  muResults: Record<string, 'O' | 'X' | 'N'>    // MU-001~016 → 결과 (다중이용업 아님이면 공란)
  // ── 4~7쪽 — 세부 현황(customer_facility_specs, H-21) — 미보유 시 빈 서식 동등 ──
  specs?: SpecMap
  // ── 8쪽 ──
  defectRows: Report9DefectRow[]
}

export type Report9RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .sec-title { font-size: 10.5pt; font-weight: bold; margin: 7px 0 2px; }
  .pre { white-space: pre-wrap; }
  table.form.tight th, table.form.tight td { padding: 1.5px 3px; font-size: 8.5pt; line-height: 1.4; }
  table.form .lbl { width: 22mm; }
  table.split { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.split > tbody > tr > td { padding: 0; vertical-align: top; width: 50%; }
  table.mu3 { width: 100%; border-collapse: collapse; }
  table.mu3 td { border: none; padding: 0 2px; vertical-align: top; font-size: 8.5pt; width: 33.3%; }
  .law { margin: 10px 2px 4px; }
  .sign { text-align: center; margin: 8px 0 2px; }
  .signer { text-align: right; margin: 4px 8px; white-space: pre-wrap; }
  .to { font-size: 12pt; margin: 8px 4px; }
  .notice th, .notice td { font-size: 8.5pt; }
  .p47 .sec-title { margin: 5px 0 2px; }
`

function person(p: Report9Person | null | undefined, h: boolean): string {
  return `<td class="center">${val(p?.name, { highlight: h })}</td>
    <td class="center">${val(p?.grade, { highlight: h })}</td>
    <td class="center">${val(p?.licenseNo, { highlight: h })}</td>
    <td class="center">${val(p?.period, { highlight: h })}</td>`
}

// ── 1쪽 — 보고서 표지 ──────────────────────────────────────────────────────
function page1(d: Report9Data, h: boolean): string {
  // 보조 점검인력 — 서식 기본 5행 유지, 초과분 동적 추가 (MD §4 개선)
  const assists: Array<Report9Person | null> = [...d.assistants]
  while (assists.length < 5) assists.push(null)
  const crewRows = 2 + assists.length // 헤더 + 주된 1 + 보조 n

  return `
${pageHeader('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제9호서식] <개정 2025. 12. 1.>', '(8쪽 중 제1쪽)')}
<div class="small pre"> ${ck(d.ckOp)} 작동점검, 종합점검(${ck(d.ckInitial)}최초점검, ${ck(d.ckCompEtc)}그 밖의 종합점검)</div>
<h1 class="doc-title">소방시설등 자체점검 실시결과 보고서</h1>
<div class="small">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √표를 합니다.</div>
<table class="form tight">
  <tr>
    <th rowspan="2" class="lbl">특정소방<br>대 상 물</th>
    <td class="pre" style="width:50%">명칭(상호) :  ${val(d.customerName, { highlight: h })}</td>
    <td class="pre">대상물 구분(용도) :  ${val(d.purpose, { highlight: h })}</td>
  </tr>
  <tr><td colspan="2" class="pre">소재지 :  ${val(d.address, { highlight: h })}</td></tr>
  <tr>
    <th class="lbl">점검기간</th>
    <td colspan="2" class="pre">  ${val(d.inspPeriod, { highlight: h })}  ( 총 점검일수: ${val(d.inspDays, { highlight: h })}일 )</td>
  </tr>
  <tr>
    <th class="lbl">점검자</th>
    <td colspan="2" class="pre"> ${ck(false)}관계인 (성명:                  , 전화번호:                  )<br> ${ck(false)}소방안전관리자    (성명:                  , 전화번호:                  )<br> ${ck(true)}소방시설관리업자  (업체명: ${val(d.companyName, { highlight: h })}, 전화번호: ${val(d.companyPhone, { highlight: h })})</td>
  </tr>
  <tr>
    <th rowspan="3" class="lbl">전자우편<br>송달 동의</th>
    <td colspan="2">「행정절차법」 제14조에 따라 정보통신망을 이용한 문서 송달에 동의합니다.</td>
  </tr>
  <tr>
    <td class="pre">${ck(d.consent === true)} 동의함    ${ck(d.consent === false)} 동의하지 않음</td>
    <td class="signer" style="margin:0">관계인                    (서명 또는 인)</td>
  </tr>
  <tr><td colspan="2" class="pre">전자우편 주소   ${val(d.reportEmail, { highlight: h })}</td></tr>
</table>
<table class="form tight" style="margin-top:-0.6pt">
  <colgroup><col class="lbl" style="width:22mm"><col style="width:24mm"><col style="width:22mm"><col style="width:26mm"><col style="width:30mm"><col></colgroup>
  <tr>
    <th rowspan="${crewRows}">점검인력</th>
    <th>구분</th><th>성명</th><th>자격구분</th><th>자격번호</th><th>점검참여일(기간)</th>
  </tr>
  <tr><td class="center nowrap">주된 점검인력</td>${person(d.main, h)}</tr>
  ${assists.map(a => `<tr><td class="center nowrap">보조 점검인력</td>${person(a, h)}</tr>`).join('\n  ')}
</table>
<p class="law">  「소방시설 설치 및 관리에 관한 법률」 제23조제3항 및 같은 법 시행규칙 제23조제1항 및 제2항에 따라 위와 같이 소방시설등 자체점검 실시결과 보고서를 제출합니다.</p>
<p class="sign">${esc(d.reportDate)}</p>
<p class="signer">소방시설관리업자ㆍ소방안전관리자ㆍ관계인:                          (서명 또는 인)</p>
<p class="to">${esc(d.submitTo)}  귀하</p>
<table class="form notice">
  <tr><th style="width:40mm">구분</th><th>첨부서류</th></tr>
  <tr>
    <td class="center">소방시설관리업자 또는<br>소방안전관리자가 관계인에게 제출</td>
    <td>소방청장이 정하여 고시하는 소방시설등점검표</td>
  </tr>
  <tr>
    <td class="center">관계인이 소방본부장 또는<br>소방서장에게 제출</td>
    <td>1. 점검인력 배치확인서(소방시설관리업자가 점검한 경우에만 제출합니다) 1부<br>2. 별지 제10호서식의 소방시설등의 자체점검 결과 이행계획서</td>
  </tr>
</table>
<table class="form notice" style="margin-top:4px">
  <tr>
    <th style="width:40mm">유의 사항</th>
    <td>1. 특정소방대상물의 관계인이 소방시설등에 대한 자체점검을 하지 않거나 관리업자 등으로 하여금 정기적으로 점검하게 하지 않은 경우 1년 이하의 징역 또는 1천만원 이하의 벌금에 처합니다.<br>2. 특정소방대상물의 관계인이 소방시설등의 점검 결과를 보고하지 않거나 거짓으로 보고한 경우 300만원 이하의 과태료를 부과합니다.</td>
  </tr>
</table>
${pageFooter()}`
}

// ── 2쪽 — 특정소방대상물 정보 ──────────────────────────────────────────────
function page2(d: Report9Data, h: boolean): string {
  const muLine = (cat: string) => {
    const cnt = d.multiUseCounts[cat] ?? ''
    return `${ck(!!cnt)}${esc(cat)}( ${cnt ? esc(cnt) : ' '}개소)`
  }
  const muCols = MULTI_USE_COLS.map((col, i) => {
    const lines = col.map(muLine)
    if (i === 0) lines.push(`${ck(d.multiUseNone)}해당없음`)
    return `<td>${lines.join('<br>')}</td>`
  }).join('\n      ')

  return `
${pageHeader(null, '(8쪽 중 제2쪽)')}
<h1 class="doc-title">특정소방대상물 정보</h1>
<div class="small">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √ 표기를 합니다.</div>
<div class="sec-title"> 1. 소방안전정보</div>
<table class="form tight">
  <tr>
    <th class="lbl">대표자</th>
    <td class="pre"> ${ck(d.repRole === '소유자')}소유자, ${ck(d.repRole === '관리자')}관리자, ${ck(d.repRole === '점유자')}점유자 / 성명: ${val(d.ownerName, { highlight: h })}, 전화번호: ${val(d.ownerPhone, { highlight: h })}</td>
  </tr>
  <tr>
    <th class="lbl">소방안전<br>관리등급</th>
    <td class="pre"> ${ck(d.managerGrade === '특급')}특급, ${ck(d.managerGrade === '1급')}1급, ${ck(d.managerGrade === '2급')}2급, ${ck(d.managerGrade === '3급')}3급</td>
  </tr>
  <tr>
    <th class="lbl">소방안전<br>관리자</th>
    <td class="pre"> ${ck(false)}소방기술자격, ${ck(false)}소방안전관리자수첩, ${ck(false)}업무대행감독, ${ck(false)}겸직, ${ck(false)}기타<br>성명: ${val(d.mgrName, { highlight: h })}, 전화번호: ${val(d.mgrPhone, { highlight: h })}, 최근 교육이수일: ${val(d.mgrEduDate, { highlight: h })}</td>
  </tr>
  <tr>
    <th class="lbl">소방계획서</th>
    <td class="pre"> ${ck(d.hasFirePlan)}작성 (${ck(d.hasFirePlan)}보관 ${ck(false)}미보관), ${ck(false)}미작성</td>
  </tr>
  <tr>
    <th class="lbl">자체점검<br>(전년도)</th>
    <td class="pre"> 작동점검 (${ck(d.prevOpDone)}실시 ${ck(false)}미실시), 종합점검 (${ck(d.prevCompDone)}실시 ${ck(false)}미실시)</td>
  </tr>
  <tr>
    <th class="lbl">교육훈련</th>
    <td class="pre"> 소방안전교육 (${ck(d.eduDone)}실시 ${ck(false)}미실시), 소방훈련 (${ck(d.drillDone)}실시 ${ck(false)}미실시)</td>
  </tr>
  <tr>
    <th class="lbl">화재보험</th>
    <td class="pre"> ${ck(d.insuranceJoined === true)}가입, ${ck(d.insuranceJoined === false)}미가입<br>보험사: ${val(d.insCompany, { highlight: h })}, 가입기간: ${val(d.insPeriod, { highlight: h })}<br>가입금액:  대인( ${val(d.insPerson, { highlight: h })} 천만원)    대물( ${val(d.insProperty, { highlight: h })} 천만원)</td>
  </tr>
  <tr>
    <th class="lbl">다중이용<br>업소현황</th>
    <td><table class="mu3"><tr>
      ${muCols}
    </tr></table></td>
  </tr>
</table>
<div class="sec-title"> 2. 건축물 정보</div>
<table class="form tight">
  <colgroup><col style="width:20mm"><col><col style="width:20mm"><col><col style="width:20mm"><col></colgroup>
  <tr>
    <th>건축허가일</th><td class="pre"> ${val(d.permitDate, { highlight: h })}</td>
    <th>사용승인일</th><td colspan="3" class="pre"> ${val(d.useApprovalDate, { highlight: h })}</td>
  </tr>
  <tr>
    <th>연 면 적</th><td class="pre"> ${val(d.totalArea, { highlight: h })} ㎡</td>
    <th>건축면적</th><td class="pre"> ${val(d.buildingArea, { highlight: h })} ㎡</td>
    <th>세 대 수</th><td class="pre">${val(d.households, { highlight: h })}</td>
  </tr>
  <tr>
    <th>층수</th><td class="pre">  지상 ${val(d.floorsAbove, { highlight: h })} 층 / 지하 ${val(d.floorsBelow, { highlight: h })} 층</td>
    <th>높    이</th><td class="pre"> ${val(d.heightM, { highlight: h })} m</td>
    <th>건물동수</th><td class="pre"> ${val(d.buildingCount, { highlight: h })} 개동</td>
  </tr>
  <tr>
    <th>건축물구조</th>
    <td colspan="5" class="pre"> ${ck(d.stCon)}콘크리트구조, ${ck(d.stSteel)}철골구조, ${ck(d.stBrick)}조적조, ${ck(d.stWood)}목구조, ${ck(d.stEtc)}기타</td>
  </tr>
  <tr>
    <th>지붕구조</th>
    <td colspan="3" class="pre"> ${ck(d.rfSlab)}슬래브, ${ck(d.rfTile)}기와, ${ck(d.rfSlate)}슬레이트, ${ck(d.rfEtc)}기타</td>
    <th>경사로</th><td class="pre">              개소</td>
  </tr>
  <tr>
    <th>계단</th>
    <td colspan="5" class="pre"> ${ck(false)}직통(또는 피난계단) (    개소), ${ck(false)}특별피난계단 (    개소)</td>
  </tr>
  <tr>
    <th>승강기</th>
    <td colspan="5" class="pre"> ${ck(!!d.elvR)}승용( ${val(d.elvR)} 대), ${ck(!!d.elvE)}비상용( ${val(d.elvE)} 대), ${ck(!!d.elvV)}피난용( ${val(d.elvV)} 대)</td>
  </tr>
  <tr>
    <th>주차장</th>
    <td colspan="5" class="pre"> ${ck(d.pkIn)}옥내(${ck(false)}지하 ${ck(false)}지상 ${ck(false)}필로티 ${ck(d.pkMech)}기계식), ${ck(d.pkRoof)}옥상, ${ck(d.pkOut)}옥외</td>
  </tr>
</table>`
}

// ── 3쪽 — 소방시설등의 현황 ────────────────────────────────────────────────
type P3Item = { html: string; mark: string }
type P3Group = { name: string; items: P3Item[] }

/** 구분/해당설비/점검결과 3열 표 — 좌·우 병렬 배치용 */
function p3Table(groups: P3Group[]): string {
  const body = groups.map(g => g.items.map((it, i) => `<tr>${
    i === 0 ? `<th rowspan="${g.items.length}">${g.name}</th>` : ''
  }<td class="pre">${it.html}</td><td class="center">${it.mark}</td></tr>`).join('\n')).join('\n')
  return `<table class="form tight" style="width:100%">
  <colgroup><col style="width:10mm"><col><col style="width:11mm"></colgroup>
  <tr><th>구분</th><th>해  당  설  비</th><th>점검결과</th></tr>
  ${body}
</table>`
}

/** 1절 소방시설등 점검 결과(설비 √ + ○/×//) 2열 표 — 별지 9호 3쪽 = 별지 4호 1쪽 공용(H-21) */
export function facilityResultSection(d: Pick<Report9Data, 'facilityChecks' | 'resultMarks'>): string {
  const f3 = (item: string): P3Item => ({
    html: ` ${ck(d.facilityChecks.includes(item))}${esc(item)}`,
    mark: resultMark(d.resultMarks[item]),
  })
  // 소화기구·피난기구 하위 항목 — 표시 전용(체크만, make-report9.py와 동일 수준: 데이터 미주입)
  const fireExt: P3Item = {
    html: ` ${ck(d.facilityChecks.includes('소화기구 및 자동소화장치'))}소화기구 및 자동소화장치<br>   ${ck(false)}소화기구(소화기, 자확, 간이)<br>   ${ck(false)}주거용주방자동소화장치<br>   ${ck(false)}상업용주방자동소화장치<br>   ${ck(false)}캐비닛형자동소화장치<br>  ${ck(false)}가스ㆍ분말ㆍ고체자동소화장치`,
    mark: resultMark(d.resultMarks['소화기구 및 자동소화장치']),
  }
  const escapeEquip: P3Item = {
    html: ` ${ck(d.facilityChecks.includes('피난기구'))}피난기구<br>   ${ck(false)}공기안전매트ㆍ피난사다리<br>     (간이)완강기ㆍ미끄럼대ㆍ구조대<br>   ${ck(false)}다수인피난장비<br>   ${ck(false)}승강식피난기<br>      하향식피난구용내림식사다리`,
    mark: resultMark(d.resultMarks['피난기구']),
  }
  const staticItem = (label: string): P3Item => ({ html: ` ${ck(false)}${esc(label)}`, mark: '' })

  const left1 = p3Table([
    { name: '소화<br>설비', items: [fireExt, ...FORM3_ITEMS.slice(1, 15).map(f3)] },
    { name: '경보<br>설비', items: FORM3_ITEMS.slice(15, 24).map(f3) },
  ])
  const right1 = p3Table([
    { name: '피난구조설비', items: [escapeEquip, ...FORM3_ITEMS.slice(25, 31).map(f3)] },
    { name: '소화용수설비', items: FORM3_ITEMS.slice(31, 33).map(f3) },
    { name: '소화활동설비', items: FORM3_ITEMS.slice(33, 40).map(f3) },
    { name: '기타', items: [staticItem('방화문, 자동방화셔터'), staticItem('비상구, 피난통로'), staticItem('방  염')] },
    { name: '비고', items: [{ html: '&nbsp;', mark: '' }] },
  ])
  return `<table class="split"><tr><td>${left1}</td><td>${right1}</td></tr></table>`
}

/** 2절 안전시설등 점검 결과(다중이용업소) 2열 표 — 별지 9호 3쪽 = 별지 4호 2쪽 공용(H-21).
 *  시트 MU-001~016(§9-6e) — ○/×는 체크(√)+결과, /는 결과만 (워커 _apply_mu 동일) */
export function muResultSection(d: Pick<Report9Data, 'muResults'>): string {
  const mu = (code: string, label: string): P3Item => {
    const r = d.muResults[code]
    return { html: ` ${ck(r === 'O' || r === 'X')}${label}`, mark: resultMark(r) }
  }
  const left2 = p3Table([
    { name: '소화설비', items: [mu('MU-001', '소화기 또는 자동확산소화기'), mu('MU-002', '간이스프링클러설비')] },
    { name: '경보설비', items: [mu('MU-003', '비상경보설비 또는<br>    자동화재탐지설비'), mu('MU-004', '가스누설경보기')] },
    {
      name: '피난구조설비',
      items: [mu('MU-005', '피난기구'), mu('MU-007', '피난안내도, 피난안내영상물'), mu('MU-006', '피난유도선'),
        mu('MU-008', '유도등, 유도표지 또는 비상조명등'), mu('MU-009', '휴대용비상조명등')],
    },
  ])
  const right2 = p3Table([
    { name: '비상구', items: [mu('MU-011', '방화문'), mu('MU-012', '비상구(비상탈출구)')] },
    {
      name: '기타',
      items: [mu('MU-013', '영업장 내부 피난통로'), mu('MU-014', '영상음향차단장치'), mu('MU-015', '누전차단기'),
        mu('MU-010', '창 문'), mu('MU-016', '방염대상물품')],
    },
    { name: '비고', items: [{ html: '&nbsp;', mark: '' }] },
  ])
  return `<table class="split"><tr><td>${left2}</td><td>${right2}</td></tr></table>`
}

function page3(d: Report9Data): string {
  return `
${pageHeader(null, '(8쪽 중 제3쪽)')}
<h1 class="doc-title">소방시설등의 현황</h1>
<div class="small">※ [&nbsp;]에는 해당 시설에 √ 표를 하고, 점검 결과란은 양호○. 불량×. 해당없는 항목은 /표시를 합니다.<span style="float:right">(1면)</span></div>
<div class="sec-title"> 1. 소방시설등 점검 결과</div>
${facilityResultSection(d)}
<div class="sec-title"> 2. 안전시설등 점검 결과(다중이용업소)</div>
${muResultSection(d)}`
}

// ── 4~7쪽 — 3. 소방시설등의 세부 현황 (customer_facility_specs 주입 — H-21) ──
// 공용 렌더 spec-sections(별지 4호 3~7쪽과 동일 원본, 카탈로그 s31~s38) — 쪽 묶음:
// 4쪽 = 3-1·3-2 + 비고, 5쪽 = 3-3·3-4, 6쪽 = 3-5~3-7, 7쪽 = 3-8. specs 없으면 빈 서식 동등.
function specPage(no: number, sections: string[], withHead = false): string {
  return `
${pageHeader(null, `(8쪽 중 제${no}쪽)`)}
<div class="p47">
${withHead ? '<div class="sec-title"> 3. 소방시설등의 세부 현황</div>\n' : ''}${sections.join('\n')}
${no === 4 ? specNoteTable() : ''}
</div>`
}

// ── 8쪽 — 4. 소방시설등 불량 세부 사항 (자동 — defects + 시트 X 항목 점검번호) ──
function page8(d: Report9Data): string {
  const body = DEFECT_GROUPS.map(g => {
    const rows = d.defectRows.filter(r => r.group === g)
    if (rows.length === 0) {
      // 빈 구분도 행 유지 — 서식 원문 동일
      return `<tr><td class="center">${g}</td><td>&nbsp;</td><td></td></tr>`
    }
    return rows.map((r, i) => `<tr>${
      i === 0 ? `<td class="center" rowspan="${rows.length}">${g}</td>` : ''
    }<td class="center">${esc(r.code)}</td><td>${esc(r.content)}</td></tr>`).join('\n  ')
  }).join('\n  ')
  return `
${pageHeader(null, '(8쪽 중 제8쪽)')}
<div class="sec-title"> 4. 소방시설등 불량 세부 사항</div>
<table class="form">
  <colgroup><col style="width:30mm"><col style="width:30mm"><col></colgroup>
  <tr><th>설비명</th><th>점검번호</th><th>불량내용</th></tr>
  ${body}
  <tr><th>비고</th><td colspan="2" class="pre"> 점검번호는 소방시설등 자체점검표의 점검항목별 번호를 기입합니다.</td></tr>
</table>`
}

/** 별지 9호 — 소방시설등 자체점검 실시결과 보고서 (8쪽) */
export function renderReport9(d: Report9Data, opts: Report9RenderOpts = {}): string {
  const h = !!opts.highlight
  const secs = renderSpecSections(d.specs ?? {}, { highlight: h, numbering: 'annex9' })
  return renderDocument({
    title: `${d.customerName} 별지 9호 자체점검 실시결과 보고서`,
    css: CSS,
    pages: [
      page1(d, h), page2(d, h), page3(d),
      specPage(4, secs.slice(0, 2), true), specPage(5, secs.slice(2, 4)),
      specPage(6, secs.slice(4, 7)), specPage(7, secs.slice(7)),
      page8(d),
    ],
  })
}
