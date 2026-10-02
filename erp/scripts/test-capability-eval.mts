// B5 단위 — 능력평가 실적 시트 조립(점검·기술인력·세금계산서)과 연도 기본값
import { inspectionSheet, staffSheet, invoiceSheet, defaultEvalYear, type EvalInspection, type EvalInvoice } from '../src/lib/capability-eval'
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m, d) } }
const insp = (o: Partial<EvalInspection>): EvalInspection => ({
  id: 'i', customerId: 'c1', customerName: '갑', address: '양평', area: 1234, inspectionType: '종합', planType: 'special_종합', status: 'completed',
  startDate: '2026-03-02', endDate: '2026-03-03', mainName: '김점검', mainLicense: 'L-1', aux: [{ name: '이보조', license: null }],
  placementReportedAt: '2026-03-06', placementResult: 'fit', placementNo: 'P-9', report9SubmittedAt: '2026-03-20', report9Via: 'somin', report9ReceiptNo: 'R-1',
  fireStation: '양평소방서', ...o })
const inv = (o: Partial<EvalInvoice>): EvalInvoice => ({ customerId: 'c1', customerName: '갑', issueDate: '2026-03-31', approvalNo: 'A-1', status: '발행완료',
  billingMonth: '2026.03', billType: '월정액', supply: 100000, tax: 10000, total: 110000, ...o })
const rows = inspectionSheet([insp({ id: 'b', startDate: '2026-05-01', customerId: 'c2', customerName: '을', status: 'in_progress', planType: 'special_작동' }), insp({})],
  [inv({}), inv({ approvalNo: 'A-2', issueDate: '2026-04-30' }), inv({ customerId: 'c2', status: '취소', approvalNo: 'X' })])
ok(rows.length === 2 && rows[0]['대상물'] === '갑' && rows[0]['번호'] === 1, '점검일 순 정렬·번호')
ok(rows[0]['상태'] === '완료' && rows[1]['상태'] === '진행중', '상태 한글')
ok(rows[0]['점검 종류'] === '종합' && rows[1]['점검 종류'] === '작동', '점검 종류는 plan_type 우선')
ok(rows[0]['주된 기술인력'] === '김점검 (L-1)' && rows[0]['보조 인력'] === '이보조', '인력 표기(번호 없으면 이름만)')
ok(rows[0]['적합 판정'] === '적합' && rows[0]['제출 수단'] === '소방민원센터', '판정·수단 라벨')
ok(rows[0]['세금계산서 승인번호(고객 단위, 그해)'] === 'A-1, A-2', '같은 고객 발행완료 승인번호를 모은다')
ok(rows[1]['세금계산서 승인번호(고객 단위, 그해)'] === '', '취소 건은 모으지 않는다')
const st = staffSheet([{ id: 's', name: '이보조', position: null, grade: null, license: null, hireDate: null }, { id: 'm', name: '김점검', position: '대리', grade: '특급', license: 'L-1', hireDate: '2020-01-01' }],
  [insp({}), insp({ id: 'x' })])
ok(st[0]['이름'] === '김점검' && st[0]['그해 주된 점검'] === 2 && st[1]['그해 보조 점검'] === 2, '기술인력 주된·보조 건수')
const iv = invoiceSheet([inv({ issueDate: '2026-04-30', approvalNo: 'A-2' }), inv({})])
ok(iv[0]['승인번호'] === 'A-1' && iv[1]['승인번호'] === 'A-2' && iv[0]['합계'] === 110000, '세금계산서 발행일 순·금액')
ok(defaultEvalYear('2027-01-10') === 2026 && defaultEvalYear('2027-03-31') === 2026 && defaultEvalYear('2026-10-02') === 2026 && defaultEvalYear('2026-12-31') === 2026, '연도 기본값(1~3월은 작년)')
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
