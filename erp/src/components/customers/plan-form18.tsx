import { Building2 } from 'lucide-react'
import { formatTel } from '@/lib/format-contact'

/** 서식 1.8 소방안전관리 업무대행 현황 — 자동 읽기 전용 (소방계획서_4.md §3 3-1.8)
 *  원천: company_profile(대행업체) + customers(계약일·등급·점검유형). 수정은 각 원천 화면에서. */

export type Form18Data = {
  company: { name: string; representative: string; bizNo: string; address: string; phone: string } | null
  contractDate: string | null
  grade: string | null
  inspectionType: string
  managerName: string | null       // 선임된 소방안전관리자(대표 관계인)
  managerSelectedAt: string | null
}

export function PlanForm18({ data }: { data: Form18Data }) {
  const row = (label: string, value: string | null | undefined) => (
    <div className="flex items-baseline gap-2 py-1 border-b border-brand-line-soft last:border-0">
      <span className="w-32 shrink-0 text-form-xs text-ink-soft">{label}</span>
      <span className="text-form-sm text-ink">{value?.trim() ? value : <span className="text-ink-meta">미입력</span>}</span>
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 mb-2">
          <Building2 className="size-4 text-brand" />
          <p className="text-form-sm font-semibold text-ink-sub">1.8 소방안전관리 업무대행 현황</p>
          <span className="text-form-xs text-ink-meta ml-auto">자동 표시 — 수정은 회사 정보·고객 기본정보에서</span>
        </div>
        <p className="text-form-xs font-medium text-brand mb-1">대행업체 (회사 정보)</p>
        {row('업체명', data.company?.name)}
        {row('대표자', data.company?.representative)}
        {row('사업자등록번호', data.company?.bizNo)}
        {row('소재지', data.company?.address)}
        {row('전화번호', formatTel(data.company?.phone))}
        <p className="text-form-xs font-medium text-brand mt-3 mb-1">대행 계약·대상물</p>
        {row('계약일', data.contractDate)}
        {row('소방안전관리 등급', data.grade)}
        {row('자체점검 구분', data.inspectionType)}
        {row('소방안전관리자(관계인)', data.managerName)}
        {row('선임일', data.managerSelectedAt)}
      </div>
      <p className="text-form-xs text-ink-meta">※ 업무대행 범위·기간 등 상세 계약 조건은 계약 문서를 따릅니다 — 본 서식은 현황 표시용.</p>
    </div>
  )
}
