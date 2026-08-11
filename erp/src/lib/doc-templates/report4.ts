/** 별지 4호(소방시설등점검표) HTML 템플릿 — 7쪽 전체 (소방계획서_7 S3A H-21)
 *
 *  서식 원문: erp_goal/_doc01/[별지 4] 소방시설등(작동점검·종합점검) 점검표.xml
 *  (소방시설 자체점검사항 등에 관한 고시 별지 제4호서식, HWPML) 추출(2026-08-03).
 *  1쪽 = 제목·√ 안내·특정소방대상물·소방시설등 점검결과(2열 요약 — 별지 9호 3쪽과 동일 데이터,
 *  facilityResultSection 공유) / 2쪽 = 다중이용업소 안전시설등·점검업체(점검인력) 현황·점검기간·
 *  관리업체·점검번호 구분·작성 유의사항 / 3~7쪽 = 소방시설등의 세부현황(spec-sections 공용 렌더 —
 *  customer_facility_specs, 별지 9호 4~7쪽과 공용 원본 §4-A-1).
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 report9-actions.assembleReport4. */

import { renderDocument, pageHeader, pageFooter, esc, val, ck } from './base'
import { facilityResultSection, muResultSection, type Report9Person } from './report9'
import { renderSpecSections, type SpecMap } from './spec-sections'

/** 부속 '설비별 점검표' 1행 — 점검번호(1-A-001…) 항목 중 ○/× 응답만 (A4-1 Q-2, 2026-08-11 확정) */
export type Report4SheetItem = { code: string; name: string; mark: 'O' | 'X' }
export type Report4SheetSection = { no: number; name: string; items: Report4SheetItem[] }

export type Report4Data = {
  // ── 1쪽 ──
  ckOp: boolean               // 작동점검
  ckInitial: boolean          // 종합점검 — 최초점검
  ckCompEtc: boolean          // 종합점검 — 그 밖의 점검
  customerName: string        // 건물명(상호)
  purpose: string             // 대상물 구분
  address: string             // 소재지
  facilityChecks: string[]                       // 설치 설비(√) — FORM3_ITEMS 명칭
  resultMarks: Record<string, 'O' | 'X' | 'N'>   // 점검결과 ○/×// (별지 9호 3쪽과 동일 데이터)
  /** B-3(소방계획서_19): '기타' 3항목 — 31번 기타사항 롤업 (별지 9호 3쪽과 공용, facilityResultSection) */
  etcMarks?: { door?: 'O' | 'X' | 'N'; exit?: 'O' | 'X' | 'N'; flame?: 'O' | 'X' | 'N' }
  // ── 2쪽 ──
  muResults: Record<string, 'O' | 'X' | 'N'>     // MU-001~016 (다중이용업 아니면 공란)
  main: Report9Person | null                     // 주인력
  assistants: Report9Person[]                    // 보조인력 — 서식 기본 6행, 초과 시 행 추가
  inspStart: string                              // 점검기간 시작 (예: 2026년 8월 1일)
  inspEnd: string
  inspDays: string
  companyName: string                            // 소방시설관리업체
  /** A4-2(소방계획서_15): 소방시설관리업 등록번호 — company_profile.management_reg_no(123), 없으면 종전 공란 */
  companyRegNo?: string
  /** 부속 설비별 점검표 — ○/× 응답 항목만, 비면 부속 쪽 자체를 미생성 (A4-1 Q-2) */
  sheetSections?: Report4SheetSection[]
  // ── 3~7쪽 ──
  specs: SpecMap                                 // customer_facility_specs 병합본
  ledgerCodes?: string[]                         // 1.4 설치(√) 코드 전체 — 1쪽 하위 체크칸·세부현황 파생용
  building?: Record<string, number | string | null | undefined>  // 건물 파생 필드(비상용승강기) 원천
}

export type Report4RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .sec-title { font-size: 10.5pt; font-weight: bold; margin: 7px 0 2px; }
  .pre { white-space: pre-wrap; }
  table.form.tight th, table.form.tight td { padding: 1.5px 3px; font-size: 8.5pt; line-height: 1.4; }
  table.form .lbl { width: 22mm; }
  table.split { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.split > tbody > tr > td { padding: 0; vertical-align: top; width: 50%; }
  .notice th, .notice td { font-size: 8.5pt; }
  .p47 .sec-title { margin: 5px 0 2px; }
`

// ── 1쪽 — 표지·특정소방대상물·소방시설등 점검결과 ─────────────────────────
function page1(d: Report4Data, h: boolean): string {
  return `
${pageHeader('소방시설 자체점검사항 등에 관한 고시[별지 제4호서식]', '(7쪽 중 1쪽)')}
<div class="small pre"> ${ck(d.ckOp)} 작동점검, 종합점검(${ck(d.ckInitial)}최초점검, ${ck(d.ckCompEtc)}그 밖의 점검)</div>
<h1 class="doc-title">소방시설등 점검표</h1>
<div class="small">※ 소방시설, 다중이용업란의 [&nbsp;&nbsp;]란에는 해당 시설에 √ 표를 한다. 점검결과란은 양호○. 불량X. 해당없는 항목은 /표시를 한다.</div>
<div class="sec-title">□ 특정소방대상물</div>
<table class="form tight">
  <tr>
    <td class="pre" style="width:50%">건물명(상호) :  ${val(d.customerName, { highlight: h })}</td>
    <td class="pre">대상물 구분 :  ${val(d.purpose, { highlight: h })}</td>
  </tr>
  <tr><td colspan="2" class="pre">소 재 지 :  ${val(d.address, { highlight: h })}</td></tr>
</table>
<div class="sec-title">□ 소방시설등 점검결과</div>
${facilityResultSection(d)}
${pageFooter()}`
}

// ── 2쪽 — 안전시설등·점검인력·점검기간·점검번호 구분·유의사항 ─────────────
function crewRow(kind: string, p: Report9Person | null, h: boolean): string {
  return `<tr><td class="center nowrap">${kind}</td>
    <td class="center">${val(p?.name, { highlight: h })}</td>
    <td class="center">${val(p?.grade, { highlight: h })}</td>
    <td class="center">${val(p?.licenseNo, { highlight: h })}</td>
    <td class="center">${val(p?.period, { highlight: h })}</td>
    <td class="center small">(서명)</td></tr>`
}

function page2(d: Report4Data, h: boolean): string {
  // 보조인력 — 서식 기본 6행 유지, 초과분 동적 추가 (별지 9호 개선과 동일 계열)
  const assists: Array<Report9Person | null> = [...d.assistants]
  while (assists.length < 6) assists.push(null)

  const dateSlot = (v: string) => v ? esc(v) : '        년    월    일'

  return `
${pageHeader(null, '(7쪽 중 2쪽)')}
<div class="sec-title">□ 다중이용업소 안전시설등 점검결과</div>
${muResultSection(d)}
<div class="sec-title">□ 점검업체(점검인력) 현황</div>
<table class="form tight">
  <colgroup><col style="width:20mm"><col style="width:22mm"><col style="width:26mm"><col style="width:30mm"><col><col style="width:16mm"></colgroup>
  <tr><th>구분</th><th>성명</th><th>자격구분</th><th>자격번호</th><th>점검참여일(기간)</th><th>서명</th></tr>
  ${crewRow('주인력', d.main, h)}
  ${assists.map(a => crewRow('보조인력', a, h)).join('\n  ')}
</table>
<table class="form tight" style="margin-top:-0.6pt">
  <tr>
    <td class="pre">점검기간(일자): ${dateSlot(d.inspStart)}부터 ${dateSlot(d.inspEnd)} 까지 (총 점검일수: ${val(d.inspDays, { highlight: h }) || '      '} 일)<br>                             소방시설관리업체(등록번호): ${val(d.companyName, { highlight: h })}                     (${d.companyRegNo ? `제 ${esc(d.companyRegNo)} 호` : '제    -    호'})    (인)</td>
  </tr>
</table>
<div class="sec-title">□ 점검번호 구분</div>
<table class="form tight">
  <colgroup><col style="width:30mm"><col></colgroup>
  <tr>
    <td class="center">대분류<br>(설비구분)</td>
    <td class="pre"> 소화기구 및 자동소화장치를 ‘1’번으로 하여 설비별 순차적으로 번호를 부여하여<br> 다중이용업소 ‘32’번까지로 함</td>
  </tr>
  <tr>
    <td class="center">중분류<br>(단위구분)</td>
    <td class="pre"> 각 설비별 점검단위에 따라 ‘A’부터 알파벳 순서대로 부여함</td>
  </tr>
  <tr>
    <td class="center">소분류<br>(점검항목)</td>
    <td class="pre"> 각 설비별 점검단위 내의 점검항목에 따라 ‘001’부터 순서대로 부여함</td>
  </tr>
</table>
<table class="form notice" style="margin-top:4px">
  <tr>
    <th style="width:30mm">작성 및 유의사항</th>
    <td class="pre"> 1. 소방시설등 (작동, 종합)점검결과보고서의 ‘각 설비별 점검결과’에는 본 서식의 점검번호를 기재한다.<br> 2. 자체점검결과(보고서 및 점검표)를 2년간 보관하여야 한다.</td>
  </tr>
</table>
${pageFooter()}`
}

// ── 3~7쪽 — 소방시설등의 세부현황 (spec-sections 공용 렌더) ────────────────
// 원본 쪽 구성 계열(섹션 단위): 3쪽 = 1·2(소화기구·수계공통), 4쪽 = 3(수계개별),
// 5쪽 = 4·5(가스계·경보), 6쪽 = 6·7(피난구조·소화용수), 7쪽 = 8(소화활동)
function specPage(no: number, sections: string[], withHead = false): string {
  const head = withHead
    ? `<h1 class="doc-title" style="font-size:13pt; letter-spacing:.1em; margin:4px 0 6px;">소방시설등의 세부현황</h1>
<div class="small"> ※ [&nbsp;&nbsp;]에는 해당 시설에 √ 표를 하고, 수량을 기입하며, 설비현황에 대하여 기입란이 부족한 경우 서식을 추가하여 작성할 수 있습니다.</div>\n`
    : ''
  return `
${pageHeader(null, `(7쪽 중 ${no}쪽)`)}
<div class="p47">
${head}${sections.join('\n')}
</div>
${pageFooter()}`
}

// ── 부속 — 설비별 점검표 (A4-1 Q-2, 2026-08-11 사용자 확정) ────────────────
// 점검번호(1-A-001…) 항목 중 점검결과 ○/×만 수록. /(해당없음)·무응답 항목은 생략,
// ○/×가 하나도 없으면 부속 쪽 자체를 만들지 않는다. 내용이 A4를 넘으면 인쇄 흐름 분할.
function sheetItemPages(sections: Report4SheetSection[]): string[] {
  if (!sections.length) return []
  const body = sections.map(s => `
  <tr><td colspan="3" style="background:#f2f2f2; font-weight:bold">${s.no ? `${s.no}. ` : ''}${esc(s.name)}</td></tr>
  ${s.items.map(it => `<tr><td class="center nowrap">${esc(it.code)}</td><td>${esc(it.name)}</td><td class="center">${it.mark === 'O' ? '○' : '×'}</td></tr>`).join('\n  ')}`).join('\n')
  return [`
${pageHeader(null, '(설비별 점검표)')}
<h1 class="doc-title" style="font-size:13pt; letter-spacing:.1em; margin:4px 0 6px;">설비별 점검표</h1>
<div class="small">※ 점검결과가 양호(○) 또는 불량(×)으로 기록된 점검항목만 수록하였으며, 해당없음(／)·미점검 항목은 생략하였습니다.</div>
<table class="form tight">
  <colgroup><col style="width:24mm"><col><col style="width:16mm"></colgroup>
  <thead><tr><th>점검번호</th><th>점검항목</th><th>점검결과</th></tr></thead>
  <tbody>${body}
  </tbody>
</table>
${pageFooter()}`]
}

/** 별지 4호 — 소방시설등점검표 (7쪽 + 부속 설비별 점검표) */
export function renderReport4(d: Report4Data, opts: Report4RenderOpts = {}): string {
  const h = !!opts.highlight
  const secs = renderSpecSections(d.specs ?? {}, {
    highlight: h, numbering: 'annex4',
    derived: { installed: d.ledgerCodes ?? [], building: d.building },
  })
  return renderDocument({
    title: `${d.customerName} 별지 4호 소방시설등점검표`,
    css: CSS,
    pages: [
      page1(d, h), page2(d, h),
      specPage(3, secs.slice(0, 2), true), specPage(4, secs.slice(2, 3)),
      specPage(5, secs.slice(3, 5)), specPage(6, secs.slice(5, 7)),
      specPage(7, secs.slice(7)),
      ...sheetItemPages(d.sheetSections ?? []),
    ],
  })
}
