'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Printer, ExternalLink, ArrowLeft, CheckCircle } from 'lucide-react'
import { issueTaxInvoiceAction } from '@/app/(dashboard)/tax-invoices/actions'

type TaxInvoice = {
  id: string
  issue_date: string | null
  approval_num: string | null
  invoice_status: string
  issued: boolean
}

type BillRow = {
  id: string
  billing_month: string
  bill_type: string
  bill_date: string
  supply_value: number
  tax_value: number
  total_amount: number
  notes: string | null
  customers: { customer_name: string; customer_code: string; address: string | null } | null
  tax_invoices: TaxInvoice | TaxInvoice[] | null
}

type CompanyInfo = {
  company_name: string
  business_number: string | null
  representative: string | null
  address: string | null
  phone: string | null
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR')
}

function getInv(bill: BillRow): TaxInvoice | null {
  if (!bill.tax_invoices) return null
  if (Array.isArray(bill.tax_invoices)) return bill.tax_invoices[0] ?? null
  return bill.tax_invoices
}

export function TaxInvoiceIssueClient({
  bill: rawBill,
  company: rawCompany,
}: {
  bill: Record<string, unknown>
  company: Record<string, unknown>
}) {
  const bill = rawBill as unknown as BillRow
  const company = rawCompany as unknown as CompanyInfo
  const inv = getInv(bill)

  const today = new Date().toISOString().slice(0, 10)
  const [issueDate, setIssueDate] = useState(inv?.issue_date ?? today)
  const [approvalNum, setApprovalNum] = useState(inv?.approval_num ?? '')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  const router = useRouter()

  const supplyValue = Number(bill.supply_value)
  const taxValue    = Number(bill.tax_value)
  const totalAmount = Number(bill.total_amount)

  // 청구 금액을 한글로 변환 (간단 버전)
  function toKorean(n: number): string {
    if (n === 0) return '영원정'
    const units = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
    const places = ['', '십', '백', '천']
    const bigUnits = ['', '만', '억', '조']
    let result = ''
    let bigIdx = 0
    while (n > 0) {
      const chunk = n % 10000
      if (chunk > 0) {
        let chunkStr = ''
        const d = [Math.floor(chunk / 1000), Math.floor((chunk % 1000) / 100), Math.floor((chunk % 100) / 10), chunk % 10]
        d.forEach((digit, i) => {
          if (digit > 0) chunkStr += (digit === 1 && i > 0 ? '' : units[digit]) + places[3 - i]
        })
        result = chunkStr + bigUnits[bigIdx] + result
      }
      n = Math.floor(n / 10000)
      bigIdx++
    }
    return result + '원정'
  }

  function handleSubmit() {
    if (!issueDate) { setErr('발행일을 입력해주세요.'); return }
    start(async () => {
      const res = await issueTaxInvoiceAction({
        billId: bill.id,
        issueDate,
        approvalNum: approvalNum || null,
      })
      if (res.error) { setErr(res.error); return }
      setDone(true)
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <CheckCircle className="size-16 text-emerald-500" />
        <p className="text-xl font-bold text-[#090c1d]">세금계산서가 발행 처리되었습니다.</p>
        <button
          onClick={() => router.push('/tax-invoices')}
          className="flex items-center gap-2 mt-4 bg-[#7b68ee] text-white px-6 py-2.5 rounded-lg text-sm font-medium"
        >
          <ArrowLeft size={14} /> 목록으로 돌아가기
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* 상단 버튼 */}
      <div className="flex items-center justify-between print:hidden">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={14} /> 목록으로
        </button>
        <div className="flex items-center gap-2">
          <a
            href="https://www.hometax.go.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <ExternalLink size={13} /> 홈택스 바로가기
          </a>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <Printer size={13} /> 인쇄 / PDF 저장
          </button>
        </div>
      </div>

      {/* 세금계산서 양식 */}
      <div className="bg-white border-2 border-gray-800 p-0 print:border-black" id="tax-invoice-form">
        {/* 제목 */}
        <div className="border-b-2 border-gray-800 text-center py-2">
          <h1 className="text-lg font-bold tracking-widest">전 자 세 금 계 산 서</h1>
          <p className="text-xs text-gray-500">(공급자 보관용)</p>
        </div>

        <div className="grid grid-cols-2 divide-x-2 divide-gray-800 border-b-2 border-gray-800">
          {/* 공급자 */}
          <div>
            <div className="bg-gray-100 px-3 py-1 border-b border-gray-400 text-xs font-bold">공 급 자</div>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="w-24 px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">사업자번호</td>
                  <td className="px-2 py-1.5">{company.business_number ?? '미입력'}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">상호</td>
                  <td className="px-2 py-1.5 font-medium">{company.company_name ?? '미입력'}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">대표자</td>
                  <td className="px-2 py-1.5">{company.representative ?? '미입력'}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">사업장주소</td>
                  <td className="px-2 py-1.5 text-[11px]">{company.address ?? '미입력'}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">전화번호</td>
                  <td className="px-2 py-1.5">{company.phone ?? '미입력'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 공급받는자 */}
          <div>
            <div className="bg-gray-100 px-3 py-1 border-b border-gray-400 text-xs font-bold">공급받는자</div>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="w-24 px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">사업자번호</td>
                  <td className="px-2 py-1.5 text-gray-400">—</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">상호</td>
                  <td className="px-2 py-1.5 font-medium">{bill.customers?.customer_name}</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">대표자</td>
                  <td className="px-2 py-1.5 text-gray-400">—</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">사업장주소</td>
                  <td className="px-2 py-1.5 text-[11px]">{bill.customers?.address ?? '—'}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 bg-gray-50 font-medium border-r border-gray-300">고객코드</td>
                  <td className="px-2 py-1.5">{bill.customers?.customer_code}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 발행 정보 */}
        <div className="grid grid-cols-3 divide-x divide-gray-300 border-b-2 border-gray-800 text-xs">
          <div className="px-3 py-2">
            <span className="text-gray-500">작성일자</span>
            <p className="font-medium mt-0.5">{issueDate || today}</p>
          </div>
          <div className="px-3 py-2">
            <span className="text-gray-500">승인번호</span>
            <p className="font-medium mt-0.5">{approvalNum || '—'}</p>
          </div>
          <div className="px-3 py-2">
            <span className="text-gray-500">청구월</span>
            <p className="font-medium mt-0.5">{bill.billing_month}</p>
          </div>
        </div>

        {/* 공급 품목 */}
        <div className="border-b-2 border-gray-800">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1.5">월</th>
                <th className="border border-gray-400 px-2 py-1.5">일</th>
                <th className="border border-gray-400 px-2 py-1.5 w-48">품목</th>
                <th className="border border-gray-400 px-2 py-1.5">규격</th>
                <th className="border border-gray-400 px-2 py-1.5">수량</th>
                <th className="border border-gray-400 px-2 py-1.5">단가</th>
                <th className="border border-gray-400 px-2 py-1.5">공급가액</th>
                <th className="border border-gray-400 px-2 py-1.5">세액</th>
                <th className="border border-gray-400 px-2 py-1.5">비고</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 px-2 py-2 text-center">
                  {bill.bill_date ? bill.bill_date.slice(5, 7) : ''}
                </td>
                <td className="border border-gray-300 px-2 py-2 text-center">
                  {bill.bill_date ? bill.bill_date.slice(8, 10) : ''}
                </td>
                <td className="border border-gray-300 px-2 py-2">소방시설 {bill.bill_type}</td>
                <td className="border border-gray-300 px-2 py-2 text-center">—</td>
                <td className="border border-gray-300 px-2 py-2 text-center">1</td>
                <td className="border border-gray-300 px-2 py-2 text-right">{fmt(supplyValue)}</td>
                <td className="border border-gray-300 px-2 py-2 text-right">{fmt(supplyValue)}</td>
                <td className="border border-gray-300 px-2 py-2 text-right">{fmt(taxValue)}</td>
                <td className="border border-gray-300 px-2 py-2">{bill.notes ?? ''}</td>
              </tr>
              {[...Array(2)].map((_, i) => (
                <tr key={i}>
                  {[...Array(9)].map((__, j) => (
                    <td key={j} className="border border-gray-300 px-2 py-2">&nbsp;</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 합계 */}
        <div className="grid grid-cols-3 text-xs border-b-2 border-gray-800">
          <div className="px-3 py-2 border-r border-gray-300">
            <span className="text-gray-500">공급가액 합계</span>
            <p className="font-bold text-base mt-0.5">{fmt(supplyValue)}</p>
          </div>
          <div className="px-3 py-2 border-r border-gray-300">
            <span className="text-gray-500">세액 합계</span>
            <p className="font-bold text-base mt-0.5">{fmt(taxValue)}</p>
          </div>
          <div className="px-3 py-2">
            <span className="text-gray-500">합계 금액</span>
            <p className="font-bold text-base mt-0.5 text-[#7b68ee]">{fmt(totalAmount)}</p>
          </div>
        </div>

        {/* 한글 금액 */}
        <div className="px-4 py-2.5 text-xs border-b border-gray-300">
          <span className="text-gray-500 mr-2">금액 (한글)</span>
          <span className="font-medium">금 {toKorean(totalAmount)}</span>
        </div>

        {/* 이 계산서는 전자발행됩니다 안내 */}
        <div className="px-4 py-3 text-[11px] text-gray-500 bg-gray-50">
          본 세금계산서는 공급자가 국세청 전자세금계산서 발행 시스템(홈택스)을 통해 발행합니다.
          발행 후 공급받는자에게 이메일로 자동 전송됩니다.
        </div>
      </div>

      {/* 발행 처리 폼 */}
      <div className="bg-white rounded-xl border p-5 space-y-4 print:hidden">
        <h2 className="font-semibold text-sm">발행 처리</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">발행일 *</label>
            <input
              type="date"
              value={issueDate}
              onChange={e => setIssueDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">승인번호 (홈택스 발행 후 입력)</label>
            <input
              type="text"
              value={approvalNum}
              onChange={e => setApprovalNum(e.target.value)}
              placeholder="20xxxxxxxxxxxxxxxx"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex items-center gap-2 pt-1">
          <p className="text-xs text-gray-400 flex-1">
            홈택스에서 전자 발행 후 승인번호를 입력하고 저장하세요.
          </p>
          <a
            href="https://www.hometax.go.kr"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-[#7b68ee] hover:underline"
          >
            <ExternalLink size={11} /> 홈택스 발행하기
          </a>
          <button
            onClick={handleSubmit}
            disabled={pending}
            className="bg-[#7b68ee] text-white rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {pending ? '저장 중…' : inv?.issued ? '수정 저장' : '발행 완료 처리'}
          </button>
        </div>
      </div>
    </div>
  )
}
