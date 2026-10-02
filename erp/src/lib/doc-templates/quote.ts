/** 견적서 — 보수 견적 1장 HTML 템플릿 (비교진단 「불량 → 매출 해결방안」 1단계, 2026-10-02)
 *
 *  법정 서식이 아니라 사내 문서다. 렌더는 순수 함수(조회 없음) — 데이터 조립은
 *  inspections/repair-sales-actions.generateQuotePdfAction. 같은 HTML이 미리보기와 Gotenberg PDF에 쓰인다.
 *  한 장이라 Gotenberg 동기 호출의 타임아웃 축에서 멀다(별지 4호와 달리 자산·여러 쪽 없음). */

import { renderDocument, esc, val } from './base'

export type QuoteDocItem = {
  description: string
  quantity: number
  unit_price: number
  amount: number
  /** 불량에서 만든 줄이면 그 불량의 세부(위치·내용) — 품목 아래 작은 글씨 */
  detail?: string | null
}

export type QuoteDocData = {
  quoteNumber: string
  /** '2026년 10월 2일' 꼴 */
  quoteDate: string
  validUntil: string
  /** 공급자(자사) */
  company: { name: string; bizNo: string; rep: string; phone: string; address: string }
  /** 수신(고객·대상물) */
  customer: { name: string; address: string; contact: string }
  /** 어느 점검 회차의 불량인지 — 없으면 빈 문자열 */
  inspectionLabel: string
  items: QuoteDocItem[]
  subtotal: number
  taxAmount: number
  totalAmount: number
  notes: string
}

const CSS = `
  .q-title { text-align:center; font-size:22pt; font-weight:700; letter-spacing:12px; margin:6mm 0 8mm; }
  .q-meta { width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:5mm; }
  .q-meta td { padding:1.2mm 2mm; vertical-align:top; }
  .q-meta td.k { width:22mm; color:#444; }
  .q-meta td.gap { width:8mm; }
  .q-box { border:1px solid #000; }
  .q-items { width:100%; border-collapse:collapse; font-size:10pt; margin-top:4mm; }
  .q-items th, .q-items td { border:1px solid #000; padding:1.6mm 2mm; }
  .q-items th { background:#f2f2f2; font-weight:600; text-align:center; }
  .q-items td.n { text-align:right; font-variant-numeric:tabular-nums; }
  .q-items td.c { text-align:center; }
  .q-items .detail { display:block; font-size:8.5pt; color:#555; margin-top:0.6mm; }
  .q-items tr.sum td { font-weight:700; background:#fafafa; }
  .q-total { margin-top:5mm; font-size:12pt; font-weight:700; text-align:right; }
  .q-notes { margin-top:6mm; font-size:9.5pt; white-space:pre-wrap; }
  .q-foot { margin-top:10mm; font-size:9.5pt; color:#333; }
`

function won(n: number): string { return `${Math.round(n).toLocaleString('ko-KR')}원` }

export function renderQuote(d: QuoteDocData): string {
  const rows = d.items.map((it, i) => `<tr>
    <td class="c">${i + 1}</td>
    <td>${esc(it.description)}${it.detail ? `<span class="detail">${esc(it.detail)}</span>` : ''}</td>
    <td class="n">${it.quantity.toLocaleString('ko-KR')}</td>
    <td class="n">${won(it.unit_price)}</td>
    <td class="n">${won(it.amount)}</td>
  </tr>`).join('\n')
  // 서식 모양 유지 — 줄이 적어도 표가 납작해지지 않게 빈 행 패딩(별지 10·11호와 같은 습관)
  const pad = Math.max(0, 6 - d.items.length)
  const padRows = Array.from({ length: pad }, () => '<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('\n')
  const page = `
<h1 class="q-title">견 적 서</h1>
<table class="q-meta">
  <tr>
    <td class="k">견적번호</td><td>${esc(d.quoteNumber)}</td><td class="gap"></td>
    <td class="k">공급자</td><td>${val(d.company.name)}</td>
  </tr>
  <tr>
    <td class="k">견적일자</td><td>${esc(d.quoteDate)}</td><td class="gap"></td>
    <td class="k">사업자번호</td><td>${val(d.company.bizNo)}</td>
  </tr>
  <tr>
    <td class="k">유효기간</td><td>${val(d.validUntil)}</td><td class="gap"></td>
    <td class="k">대표자</td><td>${val(d.company.rep)}</td>
  </tr>
  <tr>
    <td class="k">수　　신</td><td>${val(d.customer.name)}</td><td class="gap"></td>
    <td class="k">전화</td><td>${val(d.company.phone)}</td>
  </tr>
  <tr>
    <td class="k">소재지</td><td>${val(d.customer.address)}</td><td class="gap"></td>
    <td class="k">주소</td><td>${val(d.company.address)}</td>
  </tr>
  <tr>
    <td class="k">연락처</td><td>${val(d.customer.contact)}</td><td class="gap"></td>
    <td class="k">점검 회차</td><td>${val(d.inspectionLabel)}</td>
  </tr>
</table>
<p style="font-size:10pt;margin:3mm 0 1mm">아래와 같이 소방시설 불량 보수 견적을 드립니다.</p>
<table class="q-items">
  <thead><tr><th style="width:9mm">No</th><th>품목(불량 내역)</th><th style="width:16mm">수량</th><th style="width:30mm">단가</th><th style="width:32mm">금액</th></tr></thead>
  <tbody>
${rows}
${padRows}
    <tr class="sum"><td colspan="4" class="c">공급가액</td><td class="n">${won(d.subtotal)}</td></tr>
    <tr class="sum"><td colspan="4" class="c">부가세(10%)</td><td class="n">${won(d.taxAmount)}</td></tr>
    <tr class="sum"><td colspan="4" class="c">합계</td><td class="n">${won(d.totalAmount)}</td></tr>
  </tbody>
</table>
<p class="q-total">합계금액: ${won(d.totalAmount)} (부가세 포함)</p>
${d.notes ? `<div class="q-notes">${esc(d.notes)}</div>` : ''}
<p class="q-foot">※ 본 견적은 유효기간 내 유효하며, 현장 여건에 따라 수량·금액이 변동될 수 있습니다. 공사 진행은 별도 계약서로 확정합니다.</p>`
  return renderDocument({ title: `${d.customer.name} 견적서 ${d.quoteNumber}`, css: CSS, pages: [page] })
}

/** '2026-10-02' → '2026년 10월 2일' (빈 값은 '') */
export function kdateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${y}년 ${m}월 ${d}일`
}

/** 견적 한 건과 무관한 머리 정보(공급자·수신·회차) — 서버가 한 번 모아 페이지 미리보기와 PDF가 같이 쓴다 */
export type QuoteDocBase = Pick<QuoteDocData, 'company' | 'customer' | 'inspectionLabel'>

/** 미리보기와 PDF가 **같은 조립**을 타게 하는 단일 함수 — 사본 금지(화면과 인쇄물이 갈리면 보낸 것과 본 것이 다르다) */
export function quoteDocFrom(base: QuoteDocBase, q: {
  quote_number: string; quote_date: string; valid_until: string | null; notes?: string | null
  items: Array<{ description: string; quantity: number; unit_price: number; amount: number; detail?: string | null }>
}): QuoteDocData {
  const items = (q.items ?? []).map(it => ({
    description: it.description, quantity: Number(it.quantity), unit_price: Number(it.unit_price),
    amount: Number(it.amount), detail: it.detail ?? null,
  }))
  const subtotal = items.reduce((s, i) => s + i.amount, 0)
  const taxAmount = Math.round(subtotal * 0.1)
  return {
    ...base,
    quoteNumber: q.quote_number,
    quoteDate: kdateLong(q.quote_date),
    validUntil: kdateLong(q.valid_until),
    items, subtotal, taxAmount, totalAmount: subtotal + taxAmount,
    notes: q.notes ?? '',
  }
}
