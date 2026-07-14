import 'server-only'

/** 소방계획서 표준양식(2025, 소방청) HTML 템플릿 — ERP 데이터 자동 채움 + 폼 입력 병합 (doc02 §8 A안)
 *  원본: erp_goal/_Data/25년 이후 소방계획서 양식.hwp 구조 추출본 기준.
 *  v1 범위: 표지·개정이력 + 서식 1.1/1.3/1.4/1.7/1.8/1.10.1/1.11.1 + 2.1/2.2 + 3.1/3.4
 *  (수기작성 성격의 나머지 서식은 인쇄 후 수기 기입 또는 추후 확장) */

export type BrigadeRow = { team: string; name: string; duty: string; phone: string }
export type EvacRow = { floor: string; route: string; guide: string; equip: string }

export type FirePlanGenData = {
  year: number
  revisionDate: string          // 작성일 (개정이력 1행)
  revisionNote: string          // 개정 내용 (예: "2026년 소방계획서 작성")
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
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const v = (s: string | null | undefined, unit = '') => s?.trim() ? `${esc(s.trim())}${unit}` : '&nbsp;'
const ck = (on: boolean, label: string) => `<span class="ck">${on ? '■' : '☐'} ${esc(label)}</span>`

/** 서식 1.4 소방시설 고정 목록 (표준양식 그대로) */
export const FACILITY_FORM: Array<{ category: string; items: string[] }> = [
  { category: '소화설비', items: ['소화기구 및 자동소화장치', '옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비', '화재조기진압용 스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비', '이산화탄소소화설비', '할론소화설비', '할로겐화합물 및 불활성기체소화설비', '분말소화설비', '강화액소화설비', '고체에어로졸소화설비'] },
  { category: '경보설비', items: ['단독경보형감지기', '비상경보설비', '자동화재탐지설비 및 시각경보기', '화재알림설비', '비상방송설비', '통합감시시설', '자동화재속보설비', '누전경보기', '가스누설경보기'] },
  { category: '피난구조설비', items: ['피난기구', '인명구조기구', '피난유도선', '유도등', '비상조명등', '유도표지', '휴대용비상조명등'] },
  { category: '소화용수설비', items: ['상수도소화용수설비', '소화수조 및 저수조'] },
  { category: '소화활동설비', items: ['거실제연설비', '부속실 등 제연설비', '비상콘센트설비', '연결송수관설비', '무선통신보조설비', '연결살수설비', '연소방지설비'] },
]

const GRADES = ['특급', '1급', '2급', '3급']

export function buildFirePlanHtml(d: FirePlanGenData): string {
  const facSet = new Set(d.facilities)
  const months = Array.from({ length: 12 }, (_, i) => i + 1)

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
    <tr><td>1</td><td>${v(d.revisionDate)}</td><td class="l">${v(d.revisionNote)}</td><td>${v(d.managerName)}</td><td></td><td></td></tr>
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
  <p class="note">※ 비고. 소방안전관리자는 대상물의 구역별 화재취약장소 및 인명피해우려장소 현황을 파악하고, 이에 대한 피난계획을 수립해야 한다.</p>
</div>

</body></html>`
}
