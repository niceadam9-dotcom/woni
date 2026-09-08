/** 별지 10호(이행계획서)·11호(이행완료 보고서) HTML 템플릿 (소방계획서_7 H-6)
 *
 *  서식 원문: erp_goal/_form/별지10·11호-placeholder.hwpx section0.xml에서 추출(2026-08-03) —
 *  법정 문구·표 구성 동일 재현. 기준 문서: erp_goal/_doc01/별지10호.MD·별지11호.MD.
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 액션(report9-actions)에서.
 *  개선(MD §4): 행 한도 4건 폐지(동적, 4행 미만은 빈 행 패딩으로 서식 모양 유지). */

import { renderDocument, pageHeader, pageFooter, esc, val } from './base'

/** isSummary=true면 개별 이행조치가 아니라 '계획 요약' 줄 — 기간칸이 비는 게 정상이라
 *  계획 항목처럼 읽히지 않도록 표에서 구분해 인쇄한다(E10-5)
 *
 *  isNote=true면 내용이 **개별 이행조치가 아니라 자동 문구**(결과참조/이상없음/해당없음)라는 뜻이다.
 *  같은 이유로 일자 칸에 빈 날짜 자리표를 찍지 않는다(Q-5 b안 확정, 2026-09-08) — 「해당없음」 옆에
 *  `.  .  .  ~  .  .  .`가 서면 '기간이 아직 안 정해진 이행조치'로 읽히고, 미대상 설비에 날짜를
 *  적어 넣으라는 말이 된다.
 *  ⚠ 문구를 **글자로 알아보지 않는다**(`content === '해당없음'` 같은 판정 금지) — 사용자가 조치
 *  내용에 그 말을 그대로 적을 수 있고, 그러면 진짜 이행조치의 날짜 칸이 조용히 사라진다. 생산자가 표시한다. */
export type AnnexRow = { content: string; period: string; isSummary?: boolean; isNote?: boolean }

/** 별지 10호 「이행조치 계획사항」 — 서식 원문은 **설비 구분 7행 고정**이다(소화설비·경보설비·
 *  피난구조설비·소화용수설비·소화활동설비·기타·안전시설등, DEFECT_GROUPS 순서).
 *  종전 렌더는 불량 1건 = 1행이라 갑지 엑셀 `계획서` 시트와 구조가 갈라져 있었다
 *  (2026-09-07 사용자 지적 image-77). 이제 두 산출물이 같은 7행·같은 문구·같은 일자를 쓴다(D-7).
 *  - content: 8쪽 불량내용과 같은 fold(사용자 입력 행 / 결과참조 / 이상없음 / 해당없음)
 *  - period·days: 그 구분의 불량만으로 산출한 이행기간(없으면 빈 칸 — 자리표만 인쇄)
 *  - isNote: content가 자동 문구(결과참조/이상없음/해당없음)라는 표시. AnnexRow와 같은 뜻이고
 *    같은 이유로 일자 칸을 자리표 대신 `—`로 찍는다(Q-5 b안) */
export type AnnexPlanRow = { group: string; content: string; period: string; days: string; isNote?: boolean }

export type Annex1011Data = {
  customerName: string
  purpose: string
  address: string
  ownerName: string
  ownerPhone: string
  mgrName: string
  mgrPhone: string
  rows: AnnexRow[]          // 10호=계획 요약 줄(있을 때만) / 11호=완료(내용·완료일)
  /** 10호 전용 — 설비 구분 7행. 공급되면 이 표로 인쇄하고, 미공급(구 호출부·픽스처)이면
   *  종전 불량별 행 렌더 그대로 (하위 호환·대조군 보호) */
  planRows?: AnnexPlanRow[]
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
  // ③ 서식 고유 값 (annex_inputs, H-23) — 11호 완료 보고 문구: 서명 블록 위 1줄, 없으면 미출력
  note?: string
}

export type RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .hd th { width: 22mm; }
  .pair td { width: 50%; }
  .rows-th { background: #f2f2f2; text-align: center; }
  .row-content { width: 70%; }
  .row-period { width: 30%; text-align: center; }
  .row-summary { background: #fafafa; }
  .row-tag { font-size: 8.5pt; border: 1px solid #999; border-radius: 2px; padding: 0 3px; margin-right: 3px; }
  /* 설비 구분 라벨·내용 — **각자 셀**이다(2026-09-07 운영 Gotenberg 육안 2건의 처방).
     ⚠ 한 셀 안에서 inline-block 두 개로 나눴더니 두 번 실패했다: ① min-width는 6글자 라벨
     (피난구조설비)에서 넘쳐 **콜론이 두 열로 갈렸고** ② width: calc(100% - Nmm)는 라벨과 한 줄에
     안 들어가 **내용이 통째로 다음 줄로 내려갔다**. 셀로 나누면 폭 계산이 표에 맡겨져 둘 다 사라진다.
     (이 주석은 CSS 템플릿 리터럴 안이다 — 백틱을 쓰면 문자열이 닫힌다.)
     콜론은 **내용 셀의 첫 글자**다 — 라벨 폭이 어떻든 한 열에 선다(image-77의 배치).
     letter-spacing은 서식 원문의 벌어진 자간 재현이고, 이제 폭에 영향을 주지 않는다. */
  .grp-label { width: 30mm; font-weight: bold; letter-spacing: 0.15em; white-space: nowrap; }
  .grp-body { vertical-align: top; }
  .row-days { display: block; }
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
  //
  // ⚠ 표 전체가 **자동 문구 상태**(해당없음/이상없음/결과참조)면 패딩 행도 자리표를 찍지 않는다
  //   (2026-09-08 육안에서 잡았다 — Q-5를 문구 행만 고쳤더니 「해당없음」 **아래 3행**에 날짜
  //   자리표가 그대로 서서 '해당없음인데 날짜를 적으라'는 모순이 한 줄 밑으로 옮겨갔을 뿐이었다).
  //   완료 건이 하나라도 있는 표(①②)에서는 패딩 자리표가 **옳다** — 조치를 더 적을 칸이니까.
  //   그래서 판정은 '빈 행인가'가 아니라 **'이 표가 선언문인가'**다.
  const isNoteTable = rows.length > 0 && rows.every(r => r.isNote)
  const padded: AnnexRow[] = [...rows]
  while (padded.length < 4) padded.push({ content: '', period: '', isNote: isNoteTable })
  return `<table class="form" style="margin-top:6px">
  <tr>
    <th rowspan="${padded.length + 1 + (extraRow ? 1 : 0)}" style="width:22mm">${esc(title)}</th>
    <td class="rows-th row-content">${esc(colTitle)}</td>
    <td class="rows-th row-period">이행조치 일자</td>
  </tr>
  ${padded.map(r => `<tr>
    <td class="row-content${r.isSummary ? ' row-summary' : ''}">${r.isSummary ? '<span class="row-tag">계획 요약</span> ' : ''}${esc(r.content)}&nbsp;</td>
    <td class="row-period${r.isSummary ? ' row-summary' : ''}">${
      // 요약 줄·자동 문구 줄은 개별 이행조치가 아니라 기간칸이 비는 게 정상 — 빈 날짜 자리표를
      // 찍으면 '기간 미정인 이행조치'로 읽힌다(E10-5 / Q-5). 「해당없음」 옆의 자리표는
      // 미대상 설비에 날짜를 적어 넣으라는 말이 된다.
      // ⚠ 선언문 표의 **패딩 행**은 `—`도 아니고 공란이다 — 가리킬 조치 자체가 없는 자리에
      //   `—`를 찍으면 '해당없음이 네 건'처럼 보인다. 반대로 완료 건이 있는 표(①②)의 패딩은
      //   자리표를 유지한다(손으로 더 적을 칸).
      r.isSummary ? '—'
        : r.isNote ? (r.content ? '—' : '')
          : r.period ? esc(r.period) : '.  .  .  ~  .  .  .'}</td>
  </tr>`).join('\n')}
  ${extraRow ?? ''}
</table>`
}

/** 총 일수 표기 정규화 — 서식이 `(총 N 일)`처럼 「일」을 이미 찍으므로 값에 든 「일」을 벗긴다.
 *  총 일수는 **자유 텍스트 수동 보정 칸**이라(annex-fields report10 `totalDays`, placeholder 「예: 20」)
 *  사람이 「20일」로 적으면 「총 20일일」이 인쇄됐다(2026-09-07 운영 Gotenberg 육안에서 발견).
 *  ⚠ 끝의 「일」만 벗긴다 — 값을 숫자로 만들지 않는다(「20일간」·「미정」 같은 입력을 지어내지 않기 위해). */
function daysText(v: string | undefined): string {
  return (v ?? '').replace(/\s*일\s*$/, '').trim()
}

/** 별지 10호 「이행조치 계획사항」 — 설비 구분 7행 고정 표(서식 원문 구조).
 *  summary(계획 내용 요약, ③ 고유값)는 있을 때만 7행 **위에** 한 줄 얹는다 — 개별 이행조치가
 *  아니므로 종전과 같이 태그로 구분하고 일자 칸은 '—'로 둔다(E10-5). */
function planTable(rows: AnnexPlanRow[], summary: AnnexRow | undefined, extraRow: string): string {
  const body: string[] = []
  if (summary) {
    body.push(`<tr>
    <td class="row-content row-summary" colspan="2"><span class="row-tag">계획 요약</span> ${esc(summary.content)}&nbsp;</td>
    <td class="row-period row-summary">—</td>
  </tr>`)
  }
  for (const r of rows) {
    body.push(`<tr>
    <td class="grp-label">${esc(r.group)}</td>
    <td class="grp-body">: ${esc(r.content).replace(/\n/g, '<br>')}&nbsp;</td>
    <td class="row-period">${r.isNote
      // 자동 문구 줄(결과참조/이상없음/해당없음)은 개별 이행조치가 아니다 — 11호 rowsTable과
      // 같은 판단으로 자리표 대신 `—`(Q-5 b안). 「해당없음」 옆에 `~(총  일)`이 서면 미대상
      // 설비에 기간을 적으라는 말이 된다. 형제 표를 한쪽만 고치면 두 서식이 갈라진다.
      ? '—'
      : r.period
        ? `${esc(r.period)}<span class="row-days">(총 ${esc(daysText(r.days))} 일)</span>`
        : '~<span class="row-days">(총&nbsp;&nbsp;&nbsp;&nbsp;일)</span>'}</td>
  </tr>`)
  }
  return `<table class="form" style="margin-top:6px">
  <tr>
    <th rowspan="${body.length + 2}" style="width:22mm">이행조치<br>계획사항</th>
    <td class="rows-th row-content" colspan="2">이행조치 사항</td>
    <td class="rows-th row-period">이행조치 일자</td>
  </tr>
  ${body.join('\n')}
  ${extraRow}
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
  // 기간이 없는데 총일수만 있으면 '(총 n일)'만 남아 괄호가 허공에 뜬다(E10-8) —
  // 그때는 총일수를 값 자체로 인쇄한다
  const totalCell = d.totalPeriod
    ? `${val(d.totalPeriod, { highlight: h })}${d.totalDays ? ` (총 ${esc(daysText(d.totalDays))}일)` : ''}`
    : d.totalDays ? `총 ${esc(daysText(d.totalDays))}일` : val(d.totalPeriod, { highlight: h })
  // ⚠ 라벨 칸의 colspan은 **그 표의 열 수**를 따른다 — 7행 표는 라벨·내용 2열이라 2, 구 렌더는 1.
  //   틀리면 이 행만 셀이 모자라 표 오른쪽이 잘리고 일자 칸이 빈 채로 인쇄된다
  //   (2026-09-07 운영 Gotenberg 육안에서 실제로 그렇게 나왔다).
  const totalRow = (span: number) => `<tr>
    <td class="rows-th"${span > 1 ? ` colspan="${span}"` : ''}>이행조치 필요기간</td>
    <td class="row-period">${totalCell}</td>
  </tr>`
  const page = `
${pageHeader('소방시설 설치 및 관리에 관한 법률 시행규칙 [별지 제10호서식]', '')}
<h1 class="doc-title">소방시설등의 자체점검 결과 이행계획서</h1>
${headTable(d, h, false)}
${d.planRows
  ? planTable(d.planRows, d.rows.find(r => r.isSummary), totalRow(2))
  : rowsTable('이행조치 계획사항', '이행조치 사항', d.rows, totalRow(1))}
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
${d.note ? `<p class="law small">비고: ${esc(d.note)}</p>` : ''}
${signBlock('「소방시설 설치 및 안전관리에 관한 법률」 제23조제4항 및 같은 법 시행규칙 제23조제6항에 따라 위와 같이 소방시설등의 수리ㆍ교체ㆍ정비에 대한 이행완료 보고서를 제출합니다.', d)}
${noticeBox([
  ['첨부서류', '1. 이행계획 건별 이행 전ㆍ후 사진 증명자료 1부<br>2. 소방시설공사 계약서(이행조치 내용과 관련됩니다) 1부'],
  ['유의 사항', CAUTION],
])}
${pageFooter()}`
  return renderDocument({ title: `${d.customerName} 별지 11호 이행완료 보고서`, css: CSS, pages: [page] })
}
