'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Printer, Download, Trash2, Plus, Loader2, FileText } from 'lucide-react'
import { uploadFirePlanAction, deleteFirePlanAction, getFirePlanFileUrlAction } from '@/app/(dashboard)/customers/fire-plan-actions'

export type FirePlanRow = {
  id: string
  year: number
  title: string | null
  pdf_name: string
  hwp_name: string | null
  note: string | null
  created_at: string
  uploader_name: string | null
}

/** 소방계획서 보관함 (doc02 §8) — 표준양식 PDF 업로드 → ERP에서 자동 인쇄. HWP 원본은 선택 보관 */
export function FirePlansClient({ customerId, plans, canManage }: {
  customerId: string
  plans: FirePlanRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const form = e.currentTarget
    const fd = new FormData(form)
    startTransition(async () => {
      const res = await uploadFirePlanAction(customerId, fd)
      if (res.error) { setError(res.error); return }
      form.reset()
      setShowForm(false)
      router.refresh()
    })
  }

  function handleDelete(plan: FirePlanRow) {
    if (!confirm(`'${plan.title ?? `${plan.year}년 소방계획서`}'를 삭제할까요?\n첨부 파일(PDF/HWP)도 함께 삭제됩니다.`)) return
    startTransition(async () => {
      const res = await deleteFirePlanAction(plan.id)
      if (res.error) { alert(res.error); return }
      router.refresh()
    })
  }

  function handleDownload(planId: string, kind: 'pdf' | 'hwp') {
    startTransition(async () => {
      const res = await getFirePlanFileUrlAction(planId, kind)
      if (res.error || !res.url) { alert(res.error ?? '다운로드에 실패했습니다.'); return }
      window.open(res.url, '_blank')
    })
  }

  const currentYear = new Date().getFullYear()

  return (
    <div>
      {plans.length === 0 && !showForm && (
        <p className="text-sm text-[#514b81] py-4 text-center">
          등록된 소방계획서가 없습니다
          {canManage && ' — 표준양식으로 작성한 PDF를 업로드하면 ERP에서 바로 인쇄할 수 있습니다'}
        </p>
      )}

      {plans.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e0ddf5]">
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">연도</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">제목</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">파일</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4">등록</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id} className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors">
                  <td className="py-3 pr-4 font-medium text-[#090c1d]">{p.year}년</td>
                  <td className="py-3 pr-4 text-[#090c1d]">
                    {p.title ?? `${p.year}년 소방계획서`}
                    {p.note && <p className="text-xs text-[#b0acd6] mt-0.5">{p.note}</p>}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81]">
                    PDF{p.hwp_name ? ' · HWP' : ''}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81]">
                    {p.created_at.slice(0, 10)}{p.uploader_name ? ` · ${p.uploader_name}` : ''}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => window.open(`/fire-plans/${p.id}/print`, '_blank')}
                        title="표준양식 PDF 인쇄 — 열리면 인쇄 대화상자가 자동으로 뜹니다"
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors"
                      >
                        <Printer className="size-3" /> 인쇄
                      </button>
                      <button
                        onClick={() => handleDownload(p.id, 'pdf')}
                        title="PDF 다운로드"
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
                      >
                        <Download className="size-3" /> PDF
                      </button>
                      {p.hwp_name && (
                        <button
                          onClick={() => handleDownload(p.id, 'hwp')}
                          title="한글 원본 다운로드 (수정 시 사용)"
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
                        >
                          <Download className="size-3" /> HWP
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => handleDelete(p)}
                          disabled={isPending}
                          title="삭제"
                          className="p-1.5 rounded-lg text-[#b0acd6] hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-3 inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
        >
          <Plus className="size-3.5" /> 소방계획서 업로드
        </button>
      )}

      {canManage && showForm && (
        <form onSubmit={handleUpload} className="mt-3 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#514b81]">
            <FileText className="size-3.5 text-[#7b68ee]" /> 소방계획서 업로드
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#514b81]">연도 <span className="text-red-500 ml-0.5">*</span></label>
              <input name="year" type="number" defaultValue={currentYear} min={2000} max={2100} required
                className="w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee]" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#514b81]">제목 <span className="text-[11px] text-[#b0acd6] font-normal">(비우면 자동)</span></label>
              <input name="title" type="text" placeholder={`${currentYear}년 소방계획서`}
                className="w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#514b81]">인쇄용 PDF <span className="text-red-500 ml-0.5">*</span> <span className="text-[11px] text-[#b0acd6] font-normal">— 표준양식으로 작성·변환한 파일</span></label>
              <input name="pdf" type="file" accept=".pdf,application/pdf" required
                className="w-full text-xs text-[#514b81] file:mr-2 file:h-8 file:px-3 file:rounded-lg file:border-0 file:bg-[#f5f4ff] file:text-[#7b68ee] file:text-xs file:font-medium file:cursor-pointer" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#514b81]">한글 원본 (HWP) <span className="text-[11px] text-[#b0acd6] font-normal">— 선택, 추후 수정용</span></label>
              <input name="hwp" type="file" accept=".hwp,.hwpx"
                className="w-full text-xs text-[#514b81] file:mr-2 file:h-8 file:px-3 file:rounded-lg file:border-0 file:bg-[#f5f4ff] file:text-[#7b68ee] file:text-xs file:font-medium file:cursor-pointer" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#514b81]">메모</label>
            <input name="note" type="text" placeholder="예: 25년 개정 양식 적용"
              className="w-full h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee]" />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setShowForm(false); setError('') }}
              className="flex-1 h-9 rounded-lg border border-[#c8c4d0] text-xs text-[#514b81] hover:bg-white transition-colors">
              취소
            </button>
            <button type="submit" disabled={isPending}
              className="flex-1 h-9 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors flex items-center justify-center disabled:opacity-50">
              {isPending ? <Loader2 className="size-4 animate-spin" /> : '업로드'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
