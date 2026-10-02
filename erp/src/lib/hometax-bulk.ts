/** 홈택스 전자세금계산서 일괄발급 엑셀(B2-2, 2026-10-02) — 양식 행 조립과 발급 결과 대조. **순수 함수**(조회·파일 IO 없음).
 *
 *  양식 근거: 공개 구현(songkh95/my-clean-erp `utils/hometaxBulkExcel.ts`, 2026-09-11 실제 양식 기준)이 적은
 *  59열·6행 머리글·7행부터 데이터·1~5행 안내문. 국세청 도움말 PDF·손택스 안내(100건 이하·XLS/XLSX·수식 금지)와 맞는다.
 *  ⚠ 공식 양식 파일과 직접 대조하지 못한 것 셋 — 작성일자 형식(여기선 YYYYMMDD 텍스트), 입력 시트 이름, 주황 필수 칸 목록.
 *    첫 실사용 전에 PC 홈택스에서 양식을 한 번 내려받아 6행 머리글을 `HOMETAX_HEADERS`와 대조한다(차이가 나면 여기만 고친다).
 *
 *  결과 파일(목록조회 → 매출분 → 내려받기, `매출전자세금계산서목록.xls`): 6행 머리글, 33열, 7행부터.
 *  열 이름이 겹치므로(상호·종사업장번호가 두 번) **위치**로 읽는다. 짝 맞추기의 공식 키는 없어
 *  작성일자 + 공급받는자 등록번호 + 합계금액으로 맞추고, 겹치거나 못 찾으면 사람이 보도록 돌려준다. */

import { bizNoDigits } from '@/lib/biz-no'

/** 양식 6행 머리글 — 59열(A~BG). 품목은 4벌 × 8칸 */
const ITEM_COLS = ['일자', '품목', '규격', '수량', '단가', '공급가액', '세액', '품목비고']
export const HOMETAX_HEADERS: string[] = [
  '전자(세금)계산서 종류\n(01:일반, 02:영세율)', '작성일자',
  '공급자 등록번호\n("-" 없이 입력)', '공급자\n종사업장번호', '공급자 상호', '공급자 성명', '공급자 사업장주소', '공급자 업태', '공급자 종목', '공급자 이메일',
  '공급받는자 등록번호\n("-" 없이 입력)', '공급받는자 \n종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소', '공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2',
  '공급가액\n합계', '세액\n합계', '비고',
  ...[1, 2, 3, 4].flatMap(n => ITEM_COLS.map(c => (c === '일자' ? `일자${n}\n(2자리, 작성년월 제외)` : `${c}${n}`))),
  '현금', '수표', '어음', '외상미수금', '영수(01),\n청구(02)',
]

/** 양식 1~5행 안내문(A열) — 행 위치를 지키려고 그대로 둔다 */
export const HOMETAX_GUIDE_ROWS: string[] = [
  '엑셀 업로드 양식(전자세금계산서-일반(영세율)) - 100건 이하',
  '★ 주황색으로 표시된 부분은 필수입력항목으로 반드시 입력하셔야 합니다.',
  '★ 실제 업로드할 DATA는 7행부터 입력하여야 하며, 최대 100건까지 입력이 가능합니다.(100건 초과 자료는 처리 안되며, 발급은 최대 50건씩 처리가능합니다)',
  '★ 임의로 양식을 변경[행 또는 열 추가 삭제 등]하는 경우 발급시 오류가 발생합니다. 품목은 1건 이상 입력해야 합니다.',
  '★ ERP 자동 생성 — 업로드 전에 공급자·공급받는자·금액을 한 번 확인하세요. 마지막 열 영수(01)/청구(02)는 필수입니다.',
]

export const HOMETAX_MAX_ROWS = 100

export type HometaxSupplier = {
  business_number: string | null; company_name: string | null; representative: string | null
  address: string | null; business_type: string | null; business_item: string | null
  email: string | null
}
export type HometaxBuyer = {
  business_no: string | null; company_name: string | null; rep_name: string | null
  address: string | null; business_type: string | null; business_item: string | null; tax_email: string | null
}
export type HometaxBill = {
  id: string; bill_date: string; bill_type: string; billing_month: string
  supply_value: number; tax_value: number; total_amount: number
  customer_name: string; customer_address: string | null
}

/** 작성일자 — YYYYMMDD 텍스트(⚠ 양식 대조 필요, 파일 머리 주석) */
export const hometaxDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

/** 청구 1건 → 양식 1행(59칸). 금액은 정수, 사업자번호는 숫자 10자리, 품목 1줄. 영수/청구는 「청구(02)」 —
 *  청구서를 먼저 보내고 입금받는 월정액·보수 청구 흐름이라서다(입금 뒤 발행하는 건은 사람이 01로 바꾼다). */
export function hometaxRow(bill: HometaxBill, buyer: HometaxBuyer, supplier: HometaxSupplier): (string | number)[] {
  const supply = Math.round(Number(bill.supply_value) || 0)
  const tax = Math.round(Number(bill.tax_value) || 0)
  const day = bill.bill_date.slice(8, 10)
  const item = [day, `소방시설 ${bill.bill_type}`, bill.billing_month, '', '', supply, tax, '']
  const empty = ['', '', '', '', '', '', '', '']
  return [
    '01', hometaxDate(bill.bill_date),
    bizNoDigits(supplier.business_number), '', supplier.company_name ?? '', supplier.representative ?? '',
    supplier.address ?? '', supplier.business_type ?? '', supplier.business_item ?? '', supplier.email ?? '',
    bizNoDigits(buyer.business_no), '', buyer.company_name || bill.customer_name, buyer.rep_name ?? '',
    buyer.address || bill.customer_address || '', buyer.business_type ?? '', buyer.business_item ?? '', buyer.tax_email ?? '', '',
    supply, tax, '',
    ...item, ...empty, ...empty, ...empty,
    '', '', '', '', '02',
  ]
}

/** 결과 파일 33열 위치(0-base) — 머리글이 겹쳐 이름이 아니라 위치로 읽는다 */
export const RESULT_COL = { writeDate: 0, approvalNo: 1, issueDate: 2, buyerBizNo: 9, total: 14 } as const

export type HometaxResultRow = { writeDate: string; approvalNo: string; issueDate: string; buyerBizNo: string; total: number }

/** 결과 시트(2차원 배열) → 승인번호 단위 행. 머리글 행은 「승인번호」 칸으로 찾는다(6행이 아니어도 견딘다).
 *  품목이 여러 줄이면 같은 승인번호가 반복되므로 첫 줄만 쓴다. */
export function parseHometaxResult(grid: unknown[][]): { rows: HometaxResultRow[]; error?: string } {
  const headerIdx = grid.findIndex(r => Array.isArray(r) && String(r[RESULT_COL.approvalNo] ?? '').replace(/\s/g, '') === '승인번호')
  if (headerIdx < 0) return { rows: [], error: '「승인번호」 머리글을 찾지 못했습니다 — 홈택스 「매출 전자세금계산서 목록」 엑셀이 맞는지 확인해주세요.' }
  const seen = new Set<string>()
  const rows: HometaxResultRow[] = []
  for (const r of grid.slice(headerIdx + 1)) {
    if (!Array.isArray(r)) continue
    const approvalNo = String(r[RESULT_COL.approvalNo] ?? '').trim()
    if (!approvalNo || seen.has(approvalNo)) continue
    seen.add(approvalNo)
    rows.push({
      writeDate: normalizeDate(r[RESULT_COL.writeDate]),
      approvalNo,
      issueDate: normalizeDate(r[RESULT_COL.issueDate]),
      buyerBizNo: bizNoDigits(String(r[RESULT_COL.buyerBizNo] ?? '')),
      total: Math.round(Number(String(r[RESULT_COL.total] ?? '').replace(/[^\d.-]/g, '')) || 0),
    })
  }
  return { rows }
}

/** 2026-10-02 · 20261002 · 2026.10.02 · 엑셀 일련번호 → YYYY-MM-DD */
export function normalizeDate(v: unknown): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
  return s.slice(0, 10)
}

export type MatchCandidate = { billId: string; billDate: string; buyerBizNo: string; total: number }
export type MatchResult = {
  matched: Array<{ billId: string; approvalNo: string; issueDate: string }>
  unmatched: HometaxResultRow[]
  ambiguous: Array<{ row: HometaxResultRow; billIds: string[] }>
}

/** 짝 맞추기 — 작성일자 + 공급받는자 등록번호 + 합계금액. 한 청구는 한 번만 짝지어진다.
 *  후보가 둘 이상이면 고르지 않고 `ambiguous`로 돌려준다(틀린 청구에 승인번호를 붙이는 것보다 사람에게 묻는 게 낫다). */
export function matchHometaxResult(rows: HometaxResultRow[], candidates: MatchCandidate[]): MatchResult {
  const used = new Set<string>()
  const out: MatchResult = { matched: [], unmatched: [], ambiguous: [] }
  for (const row of rows) {
    const hits = candidates.filter(c => !used.has(c.billId)
      && c.billDate === row.writeDate && bizNoDigits(c.buyerBizNo) === row.buyerBizNo && Math.round(c.total) === row.total)
    if (hits.length === 1) { used.add(hits[0].billId); out.matched.push({ billId: hits[0].billId, approvalNo: row.approvalNo, issueDate: row.issueDate || row.writeDate }) }
    else if (hits.length === 0) out.unmatched.push(row)
    else out.ambiguous.push({ row, billIds: hits.map(h => h.billId) })
  }
  return out
}
