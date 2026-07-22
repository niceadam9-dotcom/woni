import 'server-only'

/** 소방계획서 표준양식(2025, 소방청) HTML 템플릿 — ERP 데이터 자동 채움 + 폼 입력 병합 (doc02 §8 A안)
 *  원본: erp_goal/_Data/25년 이후 소방계획서 양식.hwp 구조 추출본 기준.
 *  v1 범위: 표지·개정이력 + 서식 1.1/1.3/1.4/1.7/1.8/1.10.1/1.11.1 + 2.1/2.2 + 3.1/3.4
 *  (수기작성 성격의 나머지 서식은 인쇄 후 수기 기입 또는 추후 확장) */

export type BrigadeRow = { team: string; name: string; duty: string; phone: string }
export type EvacRow = { floor: string; route: string; guide: string; equip: string }
/** 서식 1.2.1 구역별 세부현황 */
export type ZoneRow = { zone: string; name: string; area: string; weekday: string; holiday: string; managerCo: string; contact: string }
/** 서식 1.2.2 화재취약장소 */
export type HazardRow = { place: string; location: string; factors: string[] }
/** 본문 삽입 사진 — path는 스토리지 경로, 생성 시 멀티파트 파일로 첨부 */
export type PlanPhoto = { path: string; kind: 'building' | 'map' | 'evacuation' | 'etc'; caption: string }

export const HAZARD_FACTORS = ['전기적 요인', '기계적 요인', '화학적 요인', '가스누출(폭발)', '부주의', '자연재해'] as const
export const PHOTO_KINDS: Array<{ value: PlanPhoto['kind']; label: string }> = [
  { value: 'building', label: '건물 전경' },
  { value: 'map', label: '위치도(지도)' },
  { value: 'evacuation', label: '피난경로도' },
  { value: 'etc', label: '기타' },
]

export type FirePlanGenData = {
  year: number
  revisionDate: string          // 이번 작성일 (개정이력 마지막 행)
  revisionNote: string          // 개정 내용 (예: "2026년 소방계획서 작성")
  revisions?: Array<{ date: string; note: string; author: string }>  // 과거 개정이력 (보관함 기반 다행 — §8-1i)
  // 서식 1.1 건축물 일반현황
  buildingName: string
  address: string
  grade: string                 // 특급/1급/2급/3급
  purpose: string
  useApprovalDate: string
  totalArea: string             // ㎡
  buildingArea: string
  floors: string                // 예: 지하1층 / 지상5층
  height: string
  structure: string
  roof: string
  receiverLocation: string      // 수신기 위치
  ownerName: string
  ownerPhone: string
  managerName: string           // 소방안전관리자
  managerPhone: string
  managerSelectedAt: string     // 선임일자
  // 서식 1.3
  fireStation: string
  stationDistance: string       // km
  stationEta: string            // 분
  // 서식 1.4 — 설치된 소방시설명 목록 (체크 표시용)
  facilities: string[]
  // 서식 1.8 업무대행 (관리업체)
  companyName: string
  companyAddress: string
  companyPhone: string
  contractStart: string
  inspectionCycle: string       // 매월 1회
  // 서식 1.10.1 자체점검
  operationMonth: string        // 작동점검 시기 (예: 2026년 7월)
  comprehensiveMonth: string    // 종합점검 시기 (종합 대상만, 없으면 '')
  // 서식 1.11.1 훈련·교육 연간계획 (실시 월 1~12)
  trainingMonth: number
  // 제2장 자위소방대
  brigade: BrigadeRow[]
  // 제3장 피난계획
  evacRoutes: EvacRow[]
  assembly: string              // 집결지
  evacNote: string              // 피난유도 방법 서술
  // 서식 1.2 건축물 세부현황
  zones: ZoneRow[]
  hazards: HazardRow[]
  // 본문 삽입 사진
  photos: PlanPhoto[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const v = (s: string | null | undefined, unit = '') => s?.trim() ? `${esc(s.trim())}${unit}` : '&nbsp;'
const ck = (on: boolean, label: string) => `<span class="ck">${on ? '■' : '☐'} ${esc(label)}</span>`

/** 서식 1.4 소방시설 고정 목록 — 표준 코드 상수 재수출 (마이그레이션 100 이후 DB 코드와 동일) */
import { FACILITY_STANDARD } from './facility-codes'
export const FACILITY_FORM = FACILITY_STANDARD

const GRADES = ['특급', '1급', '2급', '3급']

/** images: 생성 시 Gotenberg 멀티파트로 첨부되는 파일명 목록 (d.photos와 순서 일치) */
export function buildFirePlanHtml(
  d: FirePlanGenData,
  images: Array<{ file: string; kind: string; caption: string }> = [],
): string {
  const facSet = new Set(d.facilities)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  const imgsOf = (kind: string) => images.filter(i => i.kind === kind)
  const imgBlock = (list: Array<{ file: string; caption: string }>, maxH = 300) =>
    list.map(i => `<figure style="margin:6px 0;text-align:center;page-break-inside:avoid">
      <img src="${i.file}" style="max-width:100%;max-height:${maxH}px" />
      ${i.caption ? `<figcaption class="small" style="margin-top:2px">${esc(i.caption)}</figcaption>` : ''}
    </figure>`).join('')

  const zoneRows = (d.zones.length ? d.zones : [{ zone: '', name: '', area: '', weekday: '', holiday: '', managerCo: '', contact: '' }])
    .map(z => `<tr><td>${v(z.zone)}</td><td class="l">${v(z.name)}</td><td>${v(z.area)}</td><td>${v(z.weekday)}</td><td>${v(z.holiday)}</td><td>${v(z.managerCo)}</td><td>${v(z.contact)}</td></tr>`).join('')

  const hazardRows = (d.hazards.length ? d.hazards : [{ place: '', location: '', factors: [] as string[] }])
    .map(h => `<tr><td>${v(h.place)}</td><td class="l">${v(h.location)}</td>
      <td class="l"><div class="ckgrid">${HAZARD_FACTORS.map(f => ck(h.factors.includes(f), f)).join('')}</div></td></tr>`).join('')

  const facilityRows = FACILITY_FORM.map(g => `
    <tr><th class="cat">${esc(g.category)}</th><td><div class="ckgrid">${
      g.items.map(it => ck(facSet.has(it), it)).join('')
    }</div></td></tr>`).join('')

  const monthCells = (mark: number) => months.map(m => `<td class="c">${m === mark ? '■' : '☐'}</td>`).join('')

  const brigadeRows = (d.brigade.length ? d.brigade : [{ team: '', name: '', duty: '', phone: '' }])
    .map(b => `<tr><td>${v(b.team)}</td><td>${v(b.name)}</td><td class="l">${v(b.duty)}</td><td>${v(b.phone)}</td></tr>`).join('')

  const evacRows = (d.evacRoutes.length ? d.evacRoutes : [{ floor: '', route: '', guide: '', equip: '' }])
    .map(r => `<tr><td>${v(r.floor)}</td><td class="l">${v(r.route)}</td><td>${v(r.guide)}</td><td>${v(r.equip)}</td></tr>`).join('')

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 10.5px; color: #111; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 30px; text-align: center; margin: 36px 0 8px; letter-spacing: 6px; }
  h2 { font-size: 15px; border-left: 5px solid #333; padding-left: 8px; margin: 22px 0 8px; }
  h3 { font-size: 12px; margin: 14px 0 6px; }
  .formno { display: inline-block; border: 1.5px solid #333; padding: 2px 10px; font-weight: bold; font-size: 11px; margin: 14px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; }
  th, td { border: 1px solid #555; padding: 4px 6px; text-align: center; vertical-align: middle; word-break: break-all; }
  th { background: #efefef; font-weight: 600; }
  td.l, th.l { text-align: left; }
  th.cat { width: 84px; }
  .ckgrid { display: flex; flex-wrap: wrap; gap: 3px 12px; text-align: left; }
  .ck { white-space: nowrap; }
  .note { font-size: 9.5px; color: #333; margin: 2px 0 10px; }
  .cover { text-align: center; padding-top: 150px; }
  .cover .name { font-size: 22px; margin: 28px 0 240px; }
  .cover .co { font-size: 14px; margin-top: 12px; }
  td.c { width: 22px; padding: 3px 0; }
  .small { font-size: 9.5px; }
</style></head><body>

<!-- 표지 -->
<div class="page cover">
  <h1>소 방 계 획 서</h1>
  <p style="font-size:16px">${d.year}년도</p>
  <p class="name">[ ${esc(d.buildingName)} ]</p>
  <p class="co">작성일: ${v(d.revisionDate)}</p>
  <p class="co">소방안전관리자: ${v(d.managerName)}</p>
  <p class="co">업무대행: ${v(d.companyName)}</p>
</div>

<!-- 개정이력 + 서식 1.1 -->
<div class="page">
  <h2>소방계획서 개정이력</h2>
  <table>
    <tr><th style="width:36px">순번</th><th style="width:70px">일자</th><th>주요 개정내용</th><th style="width:70px">작성자</th><th style="width:56px">검토</th><th style="width:56px">승인</th></tr>
    ${(d.revisions ?? []).map((r, i) => `<tr><td>${i + 1}</td><td>${v(r.date)}</td><td class="l">${v(r.note)}</td><td>${v(r.author)}</td><td></td><td></td></tr>`).join('')}
    <tr><td>${(d.revisions?.length ?? 0) + 1}</td><td>${v(d.revisionDate)}</td><td class="l">${v(d.revisionNote)}</td><td>${v(d.managerName)}</td><td></td><td></td></tr>
    ${Array.from({ length: 7 }, (_, i) => `<tr><td>${i + 2}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')}
  </table>

  <h2>제1장 소방안전관리계획</h2>
  <p class="formno">서식 1.1</p><h3 style="display:inline;margin-left:8px">건축물 일반현황</h3>
  <p class="note">※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table>
    <tr><th style="width:80px">명칭</th><td colspan="3" class="l">${v(d.buildingName)}</td></tr>
    <tr><th>도로명주소</th><td colspan="3" class="l">${v(d.address)}</td></tr>
    <tr><th>연락처</th><td class="l">대표자(책임자): ${v(d.ownerName)} / ${v(d.ownerPhone)}</td>
        <td colspan="2" class="l">소방안전관리자: ${v(d.managerName)} / ${v(d.managerPhone)}</td></tr>
    <tr><th rowspan="5">시설현황</th><td class="l">수신기위치: ${v(d.receiverLocation)}</td>
        <td colspan="2" class="l">대상물 급수: ${GRADES.map(g => ck(d.grade === g, g)).join(' ')}</td></tr>
    <tr><td class="l">주용도: ${v(d.purpose)}</td><td class="l">사용승인일: ${v(d.useApprovalDate)}</td><td class="l">연면적: ${v(d.totalArea, ' ㎡')}</td></tr>
    <tr><td class="l">건축면적: ${v(d.buildingArea, ' ㎡')}</td><td class="l">층수: ${v(d.floors)}</td><td class="l">높이: ${v(d.height, ' m')}</td></tr>
    <tr><td class="l">구조: ${v(d.structure)}</td><td colspan="2" class="l">지붕: ${v(d.roof)}</td></tr>
    <tr><td colspan="3" class="l">승강기: ☐ 승용 ☐ 비상용 ☐ 피난용 &nbsp;/&nbsp; 계단: ☐ 특별피난계단 ☐ 직통계단 ☐ 피난계단 ☐ 옥외계단</td></tr>
    <tr><th>운영현황</th><td colspan="3" class="l">운영시간: ☐ 평일 ☐ 휴일 &nbsp;/&nbsp; 인원현황: ☐ 근무인원 (&nbsp;&nbsp;&nbsp;명) ☐ 거주인원 (&nbsp;&nbsp;&nbsp;명) ☐ 최대수용인원 (&nbsp;&nbsp;&nbsp;명)</td></tr>
    <tr><th>업무대행</th><td colspan="3" class="l">■ 해당 [서식1.8] 작성 &nbsp; ☐ 해당없음</td></tr>
    <tr><th>화재보험<br><span class="small">(관계인 기록)</span></th><td colspan="3" class="l">☐ 가입 ☐ 미가입 &nbsp; 보험사: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 가입기간: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 가입금액: 대인&nbsp;&nbsp;&nbsp;&nbsp;원 / 대물&nbsp;&nbsp;&nbsp;&nbsp;원</td></tr>
  </table>

  <p class="formno">서식 1.3</p><h3 style="display:inline;margin-left:8px">건축물 위치·운영현황 및 소방차 세부진입 계획</h3>
  <table>
    <tr><th style="width:130px">관할소방서<br><span class="small">(119안전센터)</span></th><td class="l">${v(d.fireStation)}</td>
        <th style="width:80px">최단거리</th><td>${v(d.stationDistance, ' km')}</td>
        <th style="width:90px">예상도착시간</th><td>${v(d.stationEta, ' 분')}</td></tr>
    <tr><th>수신기 위치</th><td class="l" colspan="3">${v(d.receiverLocation)}</td>
        <th>주차장진입<br>가능여부</th><td></td></tr>
    <tr><th>소방차 진입경로</th><td class="l" colspan="5">&nbsp;</td></tr>
  </table>
  ${imgsOf('map').length ? `<h3>건축물 위치도</h3>${imgBlock(imgsOf('map'), 340)}` : ''}
  ${imgsOf('building').length ? `<h3>건물 전경</h3>${imgBlock(imgsOf('building'), 340)}` : ''}
</div>

<!-- 서식 1.2 건축물 세부현황 -->
<div class="page">
  <p class="formno">서식 1.2</p><h3 style="display:inline;margin-left:8px">건축물 세부현황</h3>
  <h3>1.2.1 구역별 세부현황</h3>
  <table class="small">
    <tr><th style="width:70px">구역별<br>(동/층)</th><th>명칭/용도</th><th style="width:70px">(바닥)면적</th>
        <th style="width:80px">인원 평일<br>(주간/야간)</th><th style="width:80px">인원 휴일<br>(주간/야간)</th>
        <th style="width:90px">관리주체<br>(입주사)</th><th style="width:100px">담당자<br>(연락처)</th></tr>
    ${zoneRows}
  </table>
  <p class="note">※ 비고 1. 소방안전관리자는 구역별 인원현황 및 운영현황을 주기적으로 확인해야 한다.
    2. 근무자·거주자 인원현황은 상시 근무·거주 인원을 파악하여 작성한다.</p>

  <h3>1.2.2 화재취약장소/인명피해우려장소 현황</h3>
  <p class="note">※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table class="small">
    <tr><th style="width:90px">화재취약장소</th><th style="width:110px">위치</th><th>화재위험요소</th></tr>
    ${hazardRows}
  </table>
  <p class="note">※ 비고. 소방안전관리자는 대상물의 구역별(동별, 층별) 화재취약장소 및 인명피해우려장소에 대한 현황을 파악하고,
    이에 대한 화재예방대책, 자위소방대 운영계획 및 피난계획을 수립해야 한다.</p>
</div>

<!-- 서식 1.4 소방시설 현황 -->
<div class="page">
  <p class="formno">서식 1.4</p><h3 style="display:inline;margin-left:8px">소방시설 현황</h3>
  <p class="note">■ 대상명 : ${esc(d.buildingName)} &nbsp;&nbsp; ※ □에는 해당되는 곳에 √표를 합니다.</p>
  <table>${facilityRows}</table>
  <p class="note">※ 비고 1. 각 소방시설 설치장소·규격 등은 소방시설 자체점검표 참조 &nbsp; 2. 건물군 관리 시 대상물별 추가 작성</p>

  <p class="formno">서식 1.7</p><h3 style="display:inline;margin-left:8px">소방안전관리(보조)자 등 선임현황</h3>
  <table>
    <tr><th>구분</th><th>소속</th><th>선임자 성명</th><th>선임일자</th><th>연락처</th><th>담당업무</th></tr>
    <tr><td>소방안전관리자</td><td>${v(d.buildingName)}</td><td>${v(d.managerName)}</td><td>${v(d.managerSelectedAt)}</td><td>${v(d.managerPhone)}</td><td class="l small">소방안전관리자의 업무</td></tr>
  </table>

  <p class="formno">서식 1.8</p><h3 style="display:inline;margin-left:8px">업무대행 현황</h3>
  <table>
    <tr><th style="width:90px">대행여부</th><td class="l" colspan="3">■ 해당 (${GRADES.map(g => ck(d.grade === g, g)).join(' ')})</td></tr>
    <tr><th>업 체 명</th><td class="l">${v(d.companyName)}</td><th style="width:90px">연락처</th><td class="l">${v(d.companyPhone)}</td></tr>
    <tr><th>업체주소</th><td class="l" colspan="3">${v(d.companyAddress)}</td></tr>
    <tr><th>계약기간</th><td class="l">${v(d.contractStart)} ~</td><th>점검주기</th><td class="l">${v(d.inspectionCycle)}</td></tr>
    <tr><th>계약범위</th><td class="l" colspan="3">소방시설</td></tr>
    <tr><th>감독사항</th><td class="l" colspan="3">점검 후 소방안전관리업무 대행 점검표 확인 후 서명</td></tr>
  </table>
  <p class="note">※ 업무대행 점검 기술인력은 대행 시 '소방안전관리업무 대행 점검표'를 작성하고 소방안전관리자(또는 관계인)에게 점검결과를 설명·제출하여야 한다.</p>

  <p class="formno">서식 1.10</p><h3 style="display:inline;margin-left:8px">소방안전관리자 자체점검 및 업무 수행 — 연간 점검 계획</h3>
  <table>
    <tr><th style="width:90px" rowspan="${d.comprehensiveMonth ? 2 : 1}">자체점검</th>
        <td class="l">■ 작동점검 — 점검시기: ${v(d.operationMonth)}</td>
        <td class="l">결과보고: 점검이 끝난 날부터 15일 이내</td>
        <td class="l">제출처: ${v(d.fireStation)}</td>
        <td class="l">점검자: ■ 외주</td></tr>
    ${d.comprehensiveMonth ? `<tr><td class="l">■ 종합점검 — 점검시기: ${v(d.comprehensiveMonth)}</td>
        <td class="l">결과보고: 점검이 끝난 날부터 15일 이내</td>
        <td class="l">제출처: ${v(d.fireStation)}</td>
        <td class="l">점검자: ■ 외주</td></tr>` : ''}
    <tr><th>일상점검</th><td class="l" colspan="4">■ 소방안전관리 업무수행 — 수행자: 소방안전관리자 / 수행주기: 매월 1회 이상</td></tr>
  </table>

  <p class="formno">서식 1.11</p><h3 style="display:inline;margin-left:8px">소방훈련 및 교육 연간계획</h3>
  <table class="small">
    <tr><th rowspan="2" style="width:90px">교육</th><th class="l" style="width:150px">구분</th><th colspan="12">연간계획(월)</th></tr>
    <tr>${months.map(m => `<th class="c">${m}</th>`).join('')}</tr>
    <tr><th rowspan="3">대상자</th><td class="l">소방교육</td>${monthCells(d.trainingMonth)}</tr>
    <tr><td class="l">피난교육</td>${monthCells(d.trainingMonth)}</tr>
    <tr><td class="l">자위소방대 및 초기대응체계</td>${monthCells(d.trainingMonth)}</tr>
    <tr><th rowspan="2">훈련</th><td class="l">소방훈련</td>${monthCells(d.trainingMonth)}</tr>
    <tr><td class="l">피난훈련</td>${monthCells(d.trainingMonth)}</tr>
  </table>
</div>

<!-- 제2장 자위소방대 -->
<div class="page">
  <h2>제2장 자위소방대 운영계획</h2>
  <p class="formno">서식 2.1</p><h3 style="display:inline;margin-left:8px">자위소방대 및 초기대응체계 일반현황</h3>
  <table>
    <tr><th style="width:80px">명칭</th><td class="l">${v(d.buildingName)}</td><th style="width:80px">등급</th><td class="l">${GRADES.map(g => ck(d.grade === g, g)).join(' ')}</td></tr>
    <tr><th>도로명주소</th><td class="l" colspan="3">${v(d.address)}</td></tr>
    <tr><th>편성표서식</th><td class="l" colspan="3">■ Type-Ⅲ [서식 2.2.3] &nbsp;<span class="small">* 상시 근무인원 50명 미만 권장</span></td></tr>
  </table>
  <h3>자위소방대 임무</h3>
  <table class="small">
    <tr><th style="width:110px">대장</th><td class="l">총괄지휘 및 감독</td></tr>
    <tr><th>부대장</th><td class="l">대장 업무 보조 및 부재시 대장 업무</td></tr>
    <tr><th>비상연락팀</th><td class="l">상황접수 및 전파, 자위소방대 소집, 119신고</td></tr>
    <tr><th>초기소화팀</th><td class="l">초기화재 진압활동</td></tr>
    <tr><th>피난유도팀</th><td class="l">피난유도 및 피난보조활동</td></tr>
    <tr><th>응급구조팀</th><td class="l">인명구조 및 응급조치</td></tr>
  </table>

  <p class="formno">서식 2.2</p><h3 style="display:inline;margin-left:8px">자위소방대 및 초기대응체계 편성표 (Type-Ⅲ)</h3>
  <table>
    <tr><th style="width:110px">구분</th><th style="width:90px">성명</th><th>개별임무</th><th style="width:110px">비상연락체계</th></tr>
    ${brigadeRows}
  </table>
  <h3>비상연락처</h3>
  <table class="small">
    <tr><th>${v(d.fireStation)}</th><td>119</td><th>${v(d.companyName)}</th><td>${v(d.companyPhone)}</td></tr>
    <tr><th>가스안전공사</th><td>031-798-0019</td><th>전기안전공사</th><td>1588-7500</td></tr>
  </table>
</div>

<!-- 제3장 피난계획 -->
<div class="page">
  <h2>제3장 피난계획</h2>
  <p class="formno">서식 3.1</p><h3 style="display:inline;margin-left:8px">피난시설 및 기타시설 일반현황</h3>
  <table>
    <tr><th style="width:80px">명칭</th><td class="l">${v(d.buildingName)}</td><th style="width:80px">층수</th><td class="l">${v(d.floors)}</td></tr>
    <tr><th>구조</th><td class="l">${v(d.structure)}</td><th>용도</th><td class="l">${v(d.purpose)}</td></tr>
    <tr><th>피난안내</th><td class="l" colspan="3">■ 연 2회 피난안내 교육을 실시</td></tr>
  </table>

  <p class="formno">서식 3.4</p><h3 style="display:inline;margin-left:8px">피난유도 절차 및 피난경로(집결지) 설정</h3>
  <h3>1. 피난유도 절차</h3>
  <table>
    <tr><th style="width:90px">비화재보</th><td class="l">피난 실시 및 집결지 대기 후 오동작 여부 전파</td></tr>
    <tr><th>화재 시</th><td class="l">${v(d.evacNote)}</td></tr>
  </table>
  <h3>2. 피난경로</h3>
  <table>
    <tr><th style="width:90px">층별</th><th>피난경로</th><th style="width:110px">피난유도자</th><th style="width:110px">피난구조설비</th></tr>
    ${evacRows}
  </table>
  <h3>3. 집결지</h3>
  <table>
    <tr><th style="width:90px">장소</th><td class="l">${v(d.assembly)}</td></tr>
  </table>
  ${imgsOf('evacuation').length ? `<h3>피난경로도</h3>${imgBlock(imgsOf('evacuation'), 340)}` : ''}
  <p class="note">※ 비고. 소방안전관리자는 대상물의 구역별 화재취약장소 및 인명피해우려장소 현황을 파악하고, 이에 대한 피난계획을 수립해야 한다.</p>
</div>

${imgsOf('etc').length ? `<!-- 부속 사진 -->
<div class="page">
  <h2>부속 사진</h2>
  ${imgBlock(imgsOf('etc'), 420)}
</div>` : ''}

</body></html>`
}

/** 계획서 데이터 시트 — 한컴독스(한글) 수동 편집 시 옆에 두고 옮겨 적는 1장 요약 (doc02 §8 ④안) */
export function buildDataSheetHtml(d: FirePlanGenData): string {
  const row = (label: string, value: string) =>
    `<tr><th style="width:130px">${esc(label)}</th><td class="l">${v(value)}</td></tr>`
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
  body { font-family: 'Malgun Gothic', sans-serif; font-size: 11px; color: #111; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .sub { font-size: 10px; color: #555; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid #555; padding: 4px 8px; text-align: center; }
  th { background: #efefef; }
  td.l { text-align: left; }
</style></head><body>
<h1>소방계획서 데이터 시트 — ${esc(d.buildingName)}</h1>
<p class="sub">${d.year}년 · 한글(한컴독스)에서 표준양식 편집 시 참조용 · 생성일 ${esc(d.revisionDate)}</p>
<table>
  ${row('명칭', d.buildingName)}${row('도로명주소', d.address)}
  ${row('대상물 급수', d.grade)}${row('주용도', d.purpose)}
  ${row('사용승인일', d.useApprovalDate)}${row('연면적(㎡)', d.totalArea)}
  ${row('층수', d.floors)}${row('구조', d.structure)}
  ${row('대표자(책임자)', `${d.ownerName} / ${d.ownerPhone}`)}
  ${row('소방안전관리자', `${d.managerName} / ${d.managerPhone}`)}
  ${row('관할소방서', d.fireStation)}
  ${row('설치 소방시설', d.facilities.join(', '))}
  ${row('업무대행 업체', `${d.companyName} / ${d.companyPhone}`)}
  ${row('업체 주소', d.companyAddress)}
  ${row('계약기간', `${d.contractStart} ~`)}${row('점검주기', d.inspectionCycle)}
  ${row('작동점검 시기', d.operationMonth)}
  ${d.comprehensiveMonth ? row('종합점검 시기', d.comprehensiveMonth) : ''}
</table>
</body></html>`
}
