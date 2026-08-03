/** 별지 10호(이행계획서)·11호(이행완료 보고서) HTML 템플릿 (소방계획서_7 H-6)
 *
 *  서식 원문: erp_goal/_form/별지10·11호-placeholder.hwpx section0.xml에서 추출(2026-08-03) —
 *  법정 문구·표 구성 동일 재현. 기준 문서: erp_goal/_doc01/별지10호.MD·별지11호.MD.
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 액션(report9-actions)에서.
 *  개선(MD §4): 행 한도 4건 폐지(동적, 4행 미만은 빈 행 패딩으로 서식 모양 유지). */

import { renderDocument, pageHeader, pageFooter, esc, val } from './base'

export type AnnexRow = { content: string; period: string }

export type Annex1011Data = {
  customerName: string
  purpose: string
  address: string
  ownerName: string
  ownerPhone: string
  mgrName: string
  mgrPhone: string
  rows: AnnexRow[]          // 10호=계획(내용·기간) / 11호=완료(내용·완료일)
  reportDate: string        // 예: 2026년 8월 3일
  submitTo: string          // 예: ○○소방서장
  // 10호 전용
  totalPeriod?: string      // 예: 2026년 8월 1일 ~ 2026년 8월 20일
  totalDays?: string
  // 11호 전용 — 소방공사업체(자사)
  companyName?: string
  companyBizno?: string
  companyRep?: string
  companyPhone?: string
  companyAddress?: string
}

export type RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .hd th { width: 22mm; }
  .pair td { width: 50%; }
  .rows-th { background: #f2f2f2; text-align: center; }
  .row-content { width: 70%; }
  .row-period { width: 30%; text-align: center; }
  .law { margin: 10px 2px 6px; text-indent: 0.5em; }
  .sign { text-align: center; margin: 14px 0 4px; }
  .signer { text-align: right; margin: 6px 8px; }
  .to { font-size: 12pt; margin: 10px 4px; }
  .notice td { font-size: 8.5pt; }
`

function headTable(d: Annex1011Data, h: boolean, mgrSplit: boolean): string {
  return `<table class="form hd">
  <tr>
    <th rowspan="3">특정소방<br>대상물</th>
    <td class="pair">대상물 명칭(상호) :  ${val(d.customerName, { highlight: h })}</td>
    <td class="pair">대상물 구분(용도) :  ${val(d.purpose, { highlight: h })}</td>
  </tr>
  <tr>
    <td>관계인<br>(성명: ${val(d.ownerName, { highlight: h })}   전화번호: ${val(d.ownerPhone, { highlight: h })})</td>
    <td>소방안전관리자${mgrSplit
      ? `<br>성명: ${val(d.mgrName, { highlight: h })}<br>전화번호: ${val(d.mgrPhone, { highlight: h })}`
      : `<br>(성명: ${val(d.mgrName, { highlight: h })}   전화번호: ${val(d.mgrPhone, { highlight: h })})`}</td>
  </tr>
  <tr><td colspan="2">소재지 :  ${val(d.address, { highlight: h })}</td></tr>
</table>`
}

function rowsTable(title: string, colTitle: string, rows: AnnexRow[], extraRow?: string): string {
  // 서식 기본 4행 유지 — 부족분 빈 행 패딩, 초과분 동적 확장(한도 폐지)
  const padded: AnnexRow[] = [...rows]
  while (padded.length < 4) padded.push({ content: '', period: '' })
  return `<table class="form" style="margin-top:6px">
  <tr>
    <th rowspan="${padded.length + 1 + (extraRow ? 1 : 0)}" style="width:22mm">${esc(title)}</th>
    <td class="rows-th row-content">${esc(colTitle)}</td>
    <td class="rows-th row-period">이행조치 일자</td>
  </tr>
  ${padded.map(r => `<tr>
    <td class="row-content">${esc(r.content)}&nbsp;</td>
    <td class="row-period">${r.period ? esc(r.period) : '.  .  .  ~  .  .  .'}</td>
  </tr>`).join('\n')}
  ${extraRow ?? ''}
</table>`
}

function noticeBox(rows: string[][]): string {
  return `<table class="form notice" style="margin-top:8px">
  ${rows.map(([label, body]) => `<tr><th style="width:22mm">${esc(label)}</th><td>${body}</td></tr>`).join('\n')}
</table>`
}

const CAUTION = `「소방시설 설치 및 관리에 관한 법률」 제61조제1항 제8호 및 제9호<br>
1. 특정소방대상물의 관계인이 법 제22조에 따른 소방시설등의 자체점검 결과에 따른 수리ㆍ조치ㆍ정비사항의 발생 시 이행계획서를 첨부하지 않거나 거짓으로 제출한 경우 300만원 이하의 과태료를 부과합니다.<br>
2. 특정소방대상물의 관계인이 소방시설등의 수리ㆍ조치ㆍ정비 이행계획을 별도의 연기신청 없이 기간 내에 완료하지 않은 경우 300만원 이하의 과태료를 부과합니다.`

function signBlock(lawText: string, d: Annex1011Data): string {
  return `<p class="law">${lawText}</p>
<p class="sign">${esc(d.reportDate)}</p>
<p class="signer">관계인:                           (서명 또는 인)</p>
<p class="to">${esc(d.submitTo)}  귀하</p>`
}

/** 별지 10호 — 소방시설등의 자체점검 결과 이행계획서 */
export function renderReport10(d: Annex1011Data, opts: RenderOpts = {}): string {
  const h = !!opts.highlight
  const totalRow = `<tr>
    <td class="rows-th">이행조치 필요기간</td>
    <td class="row-period">${val(d.totalPeriod, { highlight: h })}${d.totalDays ? ` (총 ${esc(d.totalDays)}일)` : ''}</td>
  </tr>`
  const page = `
${pageHeader('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제10호서식]', '')}
<h1 class="doc-title">소방시설등의 자체점검 결과 이행계획서</h1>
${headTable(d, h, false)}
${rowsTable('이행조치 계획사항', '이행조치 사항', d.rows, totalRow)}
${signBlock('「소방시설 설치 및 안전관리에 관한 법률」 제23조제3항 및 같은 법 시행규칙 제23조제2항에 따라 위와 같이 소방시설등의 수리ㆍ교체ㆍ정비에 대한 이행계획서를 제출합니다.', d)}
${noticeBox([['유의 사항', CAUTION]])}
${pageFooter()}`
  return renderDocument({ title: `${d.customerName} 별지 10호 이행계획서`, css: CSS, pages: [page] })
}

/** 별지 11호 — 소방시설등의 자체점검 결과 이행완료 보고서 */
export function renderReport11(d: Annex1011Data, opts: RenderOpts = {}): string {
  const h = !!opts.highlight
  const companyTable = `<table class="form hd" style="margin-top:6px">
  <tr>
    <th rowspan="3">소방공사<br>업체</th>
    <td class="pair">업체명(상호) :  ${val(d.companyName, { highlight: h })}</td>
    <td class="pair">사업자번호 :  ${val(d.companyBizno, { highlight: h })}</td>
  </tr>
  <tr><td colspan="2">대표이사 (성명: ${val(d.companyRep, { highlight: h })}   전화번호: ${val(d.companyPhone, { highlight: h })})</td></tr>
  <tr><td colspan="2">소재지 :  ${val(d.companyAddress, { highlight: h })}</td></tr>
</table>`
  const page = `
${pageHeader('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제11호서식]', '')}
<h1 class="doc-title">소방시설등의 자체점검 결과 이행완료 보고서</h1>
${headTable(d, h, true)}
${companyTable}
${rowsTable('이행완료 사항', '이행조치 내용', d.rows)}
${signBlock('「소방시설 설치 및 안전관리에 관한 법률」 제23조제4항 및 같은 법 시행규칙 제23조제6항에 따라 위와 같이 소방시설등의 수리ㆍ교체ㆍ정비에 대한 이행완료 보고서를 제출합니다.', d)}
${noticeBox([
  ['첨부서류', '1. 이행계획 건별 이행 전ㆍ후 사진 증명자료 1부<br>2. 소방시설공사 계약서(이행조치 내용과 관련됩니다) 1부'],
  ['유의 사항', CAUTION],
])}
${pageFooter()}`
  return renderDocument({ title: `${d.customerName} 별지 11호 이행완료 보고서`, css: CSS, pages: [page] })
}
