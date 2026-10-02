/** 점검능력평가 실적 묶음(통합계획 B5, 2026-10-02) — 시트 셋의 행 조립. **순수 함수**(조회 없음).
 *
 *  신청: 매년 1/1~2/15(소방시설법 34조·시행규칙 37조). 서류는 별지 29호 + 점검실적 증명·세금계산서 사본 + 기술인력 현황.
 *  이 묶음은 **신청 서류 작성용**이다 — 협회 실적 자동 반영 여부는 확인되지 않았고 「증빙이 첨부된 경우만 인정」이다.
 *
 *  ⚠ 점검 회차와 세금계산서를 잇는 키가 없다(청구는 고객·월 단위, `bills.inspection_plan_item_id`는 쓰이지 않음).
 *    그래서 점검 행에는 「그 고객의 그해 세금계산서 승인번호」를 모아 보여 주고, 3시트에 세금계산서 전체를 둔다.
 *    짝을 지어내지 않는다 — 고객 단위 묶음이라고 열 이름에 적는다. */

import { SUBMISSION_VIA_LABELS, PLACEMENT_RESULT_LABELS, type SubmissionVia, type PlacementResult } from '@/lib/legal-link'

export type EvalInspection = {
  id: string; customerId: string; customerName: string; address: string | null; area: number | null
  inspectionType: string; planType: string | null; status: string
  startDate: string | null; endDate: string | null
  mainName: string | null; mainLicense: string | null
  aux: Array<{ name: string; license: string | null }>
  placementReportedAt: string | null; placementResult: PlacementResult | null; placementNo: string | null
  report9SubmittedAt: string | null; report9Via: SubmissionVia | null; report9ReceiptNo: string | null
  fireStation: string | null
}
export type EvalInvoice = {
  customerId: string; customerName: string; issueDate: string | null; approvalNo: string | null; status: string
  billingMonth: string; billType: string; supply: number; tax: number; total: number
}
export type EvalStaff = { id: string; name: string; position: string | null; grade: string | null; license: string | null; hireDate: string | null }

const kind = (i: EvalInspection) =>
  i.planType === 'special_종합' ? '종합' : i.planType === 'special_작동' ? '작동' : (i.inspectionType || '')
const STATUS: Record<string, string> = { completed: '완료', in_progress: '진행중', scheduled: '예정', overdue: '지연' }

/** 1시트 — 점검 단위 실적. 완료 건이 실적이고, 진행 중 건은 상태 열로 구분해 함께 둔다(연말에 무엇이 남았는지 보이게) */
export function inspectionSheet(rows: EvalInspection[], invoices: EvalInvoice[]): Record<string, string | number>[] {
  const approvals = new Map<string, string[]>()
  for (const v of invoices) {
    if (v.status !== '발행완료' || !v.approvalNo) continue
    const a = approvals.get(v.customerId) ?? []
    a.push(v.approvalNo); approvals.set(v.customerId, a)
  }
  return [...rows]
    .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.customerName.localeCompare(b.customerName))
    .map((i, n) => ({
      '번호': n + 1,
      '상태': STATUS[i.status] ?? i.status,
      '대상물': i.customerName,
      '소재지': i.address ?? '',
      '연면적(㎡)': i.area ?? '',
      '점검 종류': kind(i),
      '점검 시작일': i.startDate ?? '',
      '점검 종료일': i.endDate ?? i.startDate ?? '',
      '주된 기술인력': i.mainName ? `${i.mainName}${i.mainLicense ? ` (${i.mainLicense})` : ''}` : '',
      '보조 인력': i.aux.map(a => `${a.name}${a.license ? ` (${a.license})` : ''}`).join(', '),
      '배치신고일': i.placementReportedAt ?? '',
      '적합 판정': i.placementResult ? PLACEMENT_RESULT_LABELS[i.placementResult] : '',
      '배치신고 번호': i.placementNo ?? '',
      '결과보고(9호) 제출일': i.report9SubmittedAt ?? '',
      '제출 수단': i.report9Via ? SUBMISSION_VIA_LABELS[i.report9Via] : '',
      '접수번호': i.report9ReceiptNo ?? '',
      '관할 소방서': i.fireStation ?? '',
      '세금계산서 승인번호(고객 단위, 그해)': (approvals.get(i.customerId) ?? []).join(', '),
    }))
}

/** 2시트 — 기술인력 현황. 그해 주된·보조로 참여한 점검 건수를 함께 센다 */
export function staffSheet(staff: EvalStaff[], rows: EvalInspection[]): Record<string, string | number>[] {
  const main = new Map<string, number>(), aux = new Map<string, number>()
  for (const i of rows) {
    if (i.mainName) main.set(i.mainName, (main.get(i.mainName) ?? 0) + 1)
    for (const a of i.aux) aux.set(a.name, (aux.get(a.name) ?? 0) + 1)
  }
  return [...staff].sort((a, b) => a.name.localeCompare(b.name)).map(s => ({
    '이름': s.name, '직위': s.position ?? '', '자격 구분': s.grade ?? '', '경력수첩번호': s.license ?? '',
    '입사일': s.hireDate ?? '', '그해 주된 점검': main.get(s.name) ?? 0, '그해 보조 점검': aux.get(s.name) ?? 0,
  }))
}

/** 3시트 — 그해 세금계산서(발행일 기준). 승인번호가 실적 증빙의 열쇠다 */
export function invoiceSheet(invoices: EvalInvoice[]): Record<string, string | number>[] {
  return [...invoices]
    .sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || a.customerName.localeCompare(b.customerName))
    .map(v => ({
      '발행일': v.issueDate ?? '', '승인번호': v.approvalNo ?? '', '상태': v.status, '고객': v.customerName,
      '청구월': v.billingMonth, '구분': v.billType, '공급가액': v.supply, '세액': v.tax, '합계': v.total,
    }))
}

/** 연도 기본값 — 신청 기간(1~2월)과 그 직후(3월)는 **작년** 실적을, 그 밖엔 올해를 연다 */
export function defaultEvalYear(todayIso: string): number {
  const y = Number(todayIso.slice(0, 4)), m = Number(todayIso.slice(5, 7))
  return m <= 3 ? y - 1 : y
}
