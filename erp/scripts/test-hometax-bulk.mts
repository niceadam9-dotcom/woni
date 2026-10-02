// B2-2 단위 — 홈택스 일괄발급 양식 행(59열)·결과 파일 파싱·짝 맞추기
import { HOMETAX_HEADERS, HOMETAX_GUIDE_ROWS, hometaxRow, hometaxDate, parseHometaxResult, matchHometaxResult, normalizeDate } from '../src/lib/hometax-bulk'
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m, d) } }
const col = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1

ok(HOMETAX_HEADERS.length === 59, '머리글 59열(A~BG)', String(HOMETAX_HEADERS.length))
ok(HOMETAX_GUIDE_ROWS.length === 5, '안내문 5행 → 6행 머리글 · 7행 데이터')
const bill = { id: 'b1', bill_date: '2026-10-01', bill_type: '월정액', billing_month: '2026.10', supply_value: 100000, tax_value: 10000, total_amount: 110000, customer_name: '고객A', customer_address: '주소A' }
const buyer = { business_no: '123-45-67890', company_name: '(주)갑', rep_name: '홍', address: null, business_type: '서비스', business_item: '관리', tax_email: 'a@b.kr' }
const sup = { business_number: '987-65-43210', company_name: '본사', representative: '김', address: '양평', business_type: '서비스', business_item: '소방', email: 's@x.kr' }
const row = hometaxRow(bill, buyer, sup)
ok(row.length === 59, '데이터 행 59칸', String(row.length))
ok(row[col('A')] === '01', 'A 종류 01(일반)')
ok(row[col('B')] === '20261001', 'B 작성일자 YYYYMMDD')
ok(row[col('C')] === '9876543210', 'C 공급자 번호 하이픈 없음')
ok(row[col('H')] === '서비스' && row[col('I')] === '소방', 'H·I 공급자 업태·종목')
ok(row[col('K')] === '1234567890', 'K 공급받는자 번호 하이픈 없음')
ok(row[col('M')] === '(주)갑', 'M 상호 = 사업자정보 상호 우선')
ok(row[col('O')] === '주소A', 'O 주소 = 사업자정보 없으면 고객 주소')
ok(row[col('R')] === 'a@b.kr', 'R 이메일1')
ok(row[col('T')] === 100000 && row[col('U')] === 10000, 'T·U 공급가액·세액 정수')
ok(row[col('W')] === '01' && row[col('X')] === '소방시설 월정액', 'W 일자1(2자리)·X 품목1')
ok(row[col('AB')] === 100000 && row[col('AC')] === 10000, 'AB·AC 품목1 공급가액·세액')
ok(row[col('AE')] === '' && row[col('BB')] === '', '품목2~4 빈칸')
ok(row[col('BG')] === '02', 'BG 영수/청구 = 02(청구)')
ok(hometaxDate('2026-01-05') === '20260105', '작성일자 변환')
ok(normalizeDate('20261001') === '2026-10-01' && normalizeDate('2026-10-01') === '2026-10-01' && normalizeDate(46296) === '2026-10-01', '결과 파일 날짜 정규화(문자·숫자열·엑셀 일련번호)')

// 결과 파일: 1~5행 요약 · 6행 머리글(33열) · 7행부터. 품목 2줄이면 같은 승인번호 반복
const head = ['작성일자', '승인번호', '발급일자', '전송일자', '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '합계금액']
const r = (d: string, no: string, biz: string, total: number) => [d, no, d, d, '9876543210', '', '본사', '김', '양평', biz, '', '갑', '홍', '', total]
const grid = [['요약'], [], [], [], [], head, r('2026-10-01', 'A1', '1234567890', 110000), r('2026-10-01', 'A1', '1234567890', 110000), r('2026-10-01', 'A2', '1111111111', 55000)]
const parsed = parseHometaxResult(grid)
ok(!parsed.error && parsed.rows.length === 2, '승인번호 단위 2행(품목 반복 합침)', JSON.stringify(parsed))
ok(parseHometaxResult([['아무거나']]).error !== undefined, '머리글 없으면 오류')
const cands = [
  { billId: 'x', billDate: '2026-10-01', buyerBizNo: '123-45-67890', total: 110000 },
  { billId: 'y', billDate: '2026-10-01', buyerBizNo: '111-11-11111', total: 55000 },
  { billId: 'z', billDate: '2026-10-01', buyerBizNo: '111-11-11111', total: 55000 },
]
const m = matchHometaxResult(parsed.rows, cands)
ok(m.matched.length === 1 && m.matched[0].billId === 'x' && m.matched[0].approvalNo === 'A1', '유일 후보는 짝지음')
ok(m.ambiguous.length === 1 && m.ambiguous[0].billIds.length === 2, '후보 둘이면 고르지 않음(ambiguous)')
const m2 = matchHometaxResult([{ writeDate: '2026-10-02', approvalNo: 'Q', issueDate: '', buyerBizNo: '1234567890', total: 110000 }], cands)
ok(m2.unmatched.length === 1, '날짜 다르면 짝 없음')
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
