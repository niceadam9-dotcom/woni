'use client'

import { useState, useTransition, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { Printer, Download, Trash2, Loader2, FileText, ChevronDown, ChevronRight, Paperclip, Send, CalendarPlus, FileOutput, Eye, Lock } from 'lucide-react'
import { uploadFirePlanAction, deleteFirePlanAction, getFirePlanFileUrlAction, updateFirePlanSubmissionAction, uploadFirePlanAttachmentAction, deleteFirePlanAttachmentAction, issueNextYearPlanAction } from '@/app/(dashboard)/customers/fire-plan-actions'
import { requestFirePlanHwpFromTabAction, previewFirePlanHtmlAction, ensureLatestFirePlanPdfAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { recommendPresetType } from '@/lib/fire-plan-presets'
import { DateInput } from '@/components/ui/date-input'

export type FirePlanAttachment = { id: string; kind: string; file_name: string }
export type FirePlanRow = {
  id: string
  year: number
  title: string | null
  pdf_name: string | null
  /** PDF 상태 (095 2단계 등록) — ready / converting(HWP 먼저 등록, PDF 뒤따라 변환) / failed */
  pdf_status: string
  /** HWP 생성분 웹 미리보기(HTML) 보유 여부 */
  has_html: boolean
  hwp_name: string | null
  note: string | null
  revision: number
  submitted_at: string | null
  fire_station: string | null
  attachments: FirePlanAttachment[]
  created_at: string
  uploader_name: string | null
  /** 표준양식 자동 생성분 (pdf_path 규약: generated_*) — [편집·재생성] 노출 */
  generated: boolean
}

/** 소방계획서 보관함 (doc02 §8) — 표준양식 PDF 업로드 → ERP에서 자동 인쇄. HWP 원본은 선택 보관 */
export function FirePlansClient({ customerId, plans, canManage, purpose }: {
  customerId: string
  plans: FirePlanRow[]
  canManage: boolean
  /** 건물 용도 — 개정 발행·미리보기에 쓸 프리셋 추천 (트리 상단 생성 바에서 이관, R2-7) */
  purpose?: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [subDraft, setSubDraft] = useState<{ submittedAt: string; fireStation: string }>({ submittedAt: '', fireStation: '' })

  // ── 소방계획서_21 R2 (#2): 조회를 파일에서 떼어낸다 ───────────────────────
  const [preview, setPreview] = useState<{ open: boolean; html: string; missing: string[]; loading: boolean }>(
    { open: false, html: '', missing: [], loading: false })
  const [busyPlan, setBusyPlan] = useState<string | null>(null)

  /** 현재 내용 — 즉석 렌더. 파일을 만들지 않고 개정차수도 오르지 않는다 (D-3) */
  function togglePreview() {
    if (preview.open) { setPreview(p => ({ ...p, open: false })); return }
    setPreview({ open: true, html: '', missing: [], loading: true })
    startTransition(async () => {
      const res = await previewFirePlanHtmlAction(customerId, currentYear, recommendPresetType(purpose))
      if (res.error) { setError(res.error); setPreview({ open: false, html: '', missing: [], loading: false }); return }
      setPreview({ open: true, html: res.html ?? '', missing: res.missing ?? [], loading: false })
    })
  }

  /** 개정 발행 — 사람이 "이 내용으로 확정"하는 순간에만 차수가 오른다 (D-5) */
  function issueRevision() {
    if (!confirm('지금 내용으로 개정판을 발행할까요?\n보관함에 새 개정 차수로 등록되고 개정이력에 1행이 남습니다.')) return
    startTransition(async () => {
      const res = await requestFirePlanHwpFromTabAction(customerId, currentYear, recommendPresetType(purpose))
      if (res.error) { alert(res.error); return }
      alert('개정판을 발행했습니다.')
      router.refresh()
    })
  }

  /** [인쇄]·[PDF]는 낡았으면 말없이 갱신한다 — 같은 행의 파일만 교체, 차수·이력 불변 (D-4).
   *  제출 기록이 있는 행은 갱신하지 않고 저장본을 그대로 연다 (D-6). */
  function openLatest(planId: string, how: 'print' | 'download') {
    setBusyPlan(planId)
    startTransition(async () => {
      const res = await ensureLatestFirePlanPdfAction(planId)
      setBusyPlan(null)
      if (res.error) { alert(res.error); return }
      if (how === 'print') window.open(`/fire-plans/${planId}/print`, '_blank')
      else await handleDownload(planId, 'pdf')
      if (res.refreshed) router.refresh()
    })
  }

  function openDetail(p: FirePlanRow) {
    if (expanded === p.id) { setExpanded(null); return }
    setExpanded(p.id)
    setSubDraft({ submittedAt: p.submitted_at ?? '', fireStation: p.fire_station ?? '' })
  }
  function saveSubmission(planId: string) {
    startTransition(async () => {
      const res = await updateFirePlanSubmissionAction(planId, subDraft)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }
  function uploadAttachment(planId: string, e: React.ChangeEvent<HTMLInputElement>, kind: string) {
    const file = e.target.files?.[0]; if (!file) return
    const fd = new FormData(); fd.append('planId', planId); fd.append('kind', kind); fd.append('file', file)
    startTransition(async () => {
      const res = await uploadFirePlanAttachmentAction(fd)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
    e.target.value = ''
  }
  function removeAttachment(attId: string) {
    startTransition(async () => { await deleteFirePlanAttachmentAction(attId); router.refresh() })
  }
  function issueNext(planId: string) {
    startTransition(async () => {
      const res = await issueNextYearPlanAction(planId)
      if (res.error) { alert(res.error); return }
      alert(`${res.year}년 소방계획서로 연차발행했습니다.`)
      router.refresh()
    })
  }

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
    // 부속자료(지도·사진)는 업로드 원본이라 다시 만들 수 없다 — 함께 지워진다는 사실을 확인창이 말해야 한다
    const attCount = plan.attachments?.length ?? 0
    const also = attCount > 0 ? `첨부 파일(PDF/HWP)과 부속자료(지도·사진) ${attCount}개` : '첨부 파일(PDF/HWP)'
    if (!confirm(`'${plan.title ?? `${plan.year}년 소방계획서`}'를 삭제할까요?\n${also}도 함께 삭제됩니다.`)) return
    startTransition(async () => {
      const res = await deleteFirePlanAction(plan.id)
      if (res.error) { alert(res.error); return }
      router.refresh()
    })
  }

  function handleDownload(planId: string, kind: 'pdf' | 'hwp' | 'html') {
    startTransition(async () => {
      const res = await getFirePlanFileUrlAction(planId, kind)
      if (res.error || !res.url) { alert(res.error ?? '다운로드에 실패했습니다.'); return }
      window.open(res.url, '_blank')
    })
  }

  const currentYear = new Date().getFullYear()

  return (
    <div>
      {/* ── 현재 내용 + 개정 발행 (소방계획서_21 R2 / #2) ──────────────────────
          조회는 파일과 무관하다: [현재 내용]은 즉석 렌더라 파일도 개정차수도 만들지 않고,
          차수는 [개정 발행]에서만 오른다. 종전 [계획서 생성 (PDF)] 버튼을 대체한다. */}
      <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-[#e0ddf5]">
        <button onClick={togglePreview} disabled={isPending}
          title="지금 서식 입력값으로 계획서를 그 자리에서 렌더합니다 — 파일을 만들지 않고 개정차수도 오르지 않습니다"
          className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs font-medium text-[#514b81] hover:bg-[#f5f4ff] hover:text-[#7b68ee] transition-colors disabled:opacity-50">
          {preview.loading ? <Loader2 className="size-3.5 animate-spin" /> : preview.open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          현재 내용
        </button>
        {canManage && (
          <button onClick={issueRevision} disabled={isPending}
            title="지금 내용으로 개정판을 발행합니다 — 보관함에 새 차수로 등록되고 개정이력에 1행이 남습니다"
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
            <FileOutput className="size-3.5" /> 개정 발행
          </button>
        )}
        <span className="text-[11px] text-[#b0acd6]">
          인쇄·PDF는 저장본이 낡았으면 자동으로 갱신됩니다 (차수 불변)
        </span>
      </div>

      {preview.open && (
        <div className="mb-4">
          {preview.missing.length > 0 && (
            <p className="text-[11px] text-amber-600 mb-1.5">
              미입력 {preview.missing.length}곳: {preview.missing.slice(0, 8).join(' · ')}{preview.missing.length > 8 ? ' …' : ''}
            </p>
          )}
          <iframe srcDoc={preview.html} title="현재 내용 미리보기" sandbox=""
            className="w-full h-[560px] rounded-lg border border-[#d0ccf5] bg-white" />
        </div>
      )}

      {plans.length === 0 && !showForm && (
        <p className="text-sm text-[#514b81] py-4 text-center">
          등록된 소방계획서가 없습니다
          {canManage && ' — [개정 발행]으로 만들거나, 표준양식 PDF를 업로드하면 ERP에서 바로 인쇄할 수 있습니다'}
        </p>
      )}

      {plans.length > 0 && (
        <div className="overflow-x-auto">
          {/* 2026-08-04 화면 정리 — 좁은 목차 영역에서 글자가 세로로 깨지던 문제: 최소 폭 확보(가로 스크롤)·줄바꿈 금지·본문 폰트 확대 */}
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[#e0ddf5]">
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4 whitespace-nowrap">연도</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4 whitespace-nowrap">제목</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4 whitespace-nowrap">파일</th>
                <th className="text-left text-xs font-medium text-[#514b81] pb-2 pr-4 whitespace-nowrap">등록</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <Fragment key={p.id}>
                <tr className="border-b border-[#f8f9fa] last:border-0 hover:bg-[#fafafa] transition-colors">
                  <td className="py-3 pr-4 font-medium text-[#090c1d] whitespace-nowrap">
                    <button onClick={() => openDetail(p)} className="inline-flex items-center gap-1 hover:text-[#7b68ee]">
                      {expanded === p.id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {p.year}년{p.revision > 1 ? <span className="text-[11px] text-[#7b68ee] ml-1">개정{p.revision}</span> : ''}
                    </button>
                  </td>
                  <td className="py-3 pr-4 text-[#090c1d] whitespace-nowrap max-w-[320px]">
                    <span className="block truncate" title={p.title ?? `${p.year}년 소방계획서`}>{p.title ?? `${p.year}년 소방계획서`}</span>
                    {p.note && <p className="text-xs text-[#b0acd6] mt-0.5 truncate" title={p.note}>{p.note}</p>}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81] whitespace-nowrap">
                    {p.pdf_status === 'ready' ? 'PDF' : p.pdf_status === 'converting'
                      ? <span className="text-amber-600 inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />PDF 변환 중</span>
                      : <span className="text-red-500">PDF 실패</span>}
                    {p.hwp_name ? ' · HWP' : ''}{p.has_html ? ' · 미리보기' : ''}{p.attachments.length > 0 ? ` · 부속${p.attachments.length}` : ''}
                    {p.submitted_at && (
                      /* 제출본 동결(R2-10 / D-6) — 소방서에 낸 PDF는 다시 인쇄해도 내용이 바뀌지 않는다 */
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-green-600"
                        title="제출본 — 인쇄·PDF 시 갱신하지 않고 제출 당시 내용 그대로 엽니다">
                        <Lock className="size-2.5" />제출{p.submitted_at.slice(5)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#514b81] whitespace-nowrap">
                    {p.created_at.slice(0, 10)}{p.uploader_name ? ` · ${p.uploader_name}` : ''}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5 justify-end flex-nowrap whitespace-nowrap">
                      {/* 행별 [재생성] 제거 (R2-9) — 상단 [개정 발행]이 같은 동작을 하고,
                          내용만 최신화하는 일은 [인쇄]·[PDF]가 말없이 처리한다 */}
                      {canManage && (
                        <button onClick={() => issueNext(p.id)} disabled={isPending} title="다음 연도로 연차발행 (파일 복제)"
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                          <CalendarPlus className="size-3" /> 연차
                        </button>
                      )}
                      {p.has_html && (
                        <button
                          onClick={() => handleDownload(p.id, 'html')}
                          title="이 개정판의 저장본 미리보기 (지금 내용은 위 [현재 내용])"
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors"
                        >
                          <Eye className="size-3" /> 저장본
                        </button>
                      )}
                      {p.pdf_status === 'ready' && (
                        <button
                          onClick={() => openLatest(p.id, 'print')}
                          disabled={busyPlan === p.id}
                          title={p.submitted_at
                            ? '제출본 — 제출 당시 내용 그대로 인쇄합니다 (갱신하지 않음)'
                            : '인쇄 — 저장본이 낡았으면 자동으로 갱신한 뒤 엽니다 (개정차수는 오르지 않습니다)'}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {busyPlan === p.id ? <Loader2 className="size-3 animate-spin" /> : <Printer className="size-3" />} 인쇄
                        </button>
                      )}
                      {p.pdf_status === 'ready' && (
                        <button
                          onClick={() => openLatest(p.id, 'download')}
                          disabled={busyPlan === p.id}
                          title={p.submitted_at ? '제출본 PDF 다운로드 (갱신하지 않음)' : 'PDF 다운로드 — 낡았으면 자동 갱신'}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50"
                        >
                          <Download className="size-3" /> PDF
                        </button>
                      )}
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
                {expanded === p.id && (
                  <tr className="bg-[#fafaff]">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-semibold text-[#514b81] mb-1.5 flex items-center gap-1"><Send className="size-3.5" /> 제출 추적</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <DateInput value={subDraft.submittedAt} onChange={e => setSubDraft(s => ({ ...s, submittedAt: e.target.value }))} disabled={!canManage} className="text-sm h-8" />
                            <input value={subDraft.fireStation} onChange={e => setSubDraft(s => ({ ...s, fireStation: e.target.value }))} placeholder="관할 소방서" disabled={!canManage}
                              className="h-8 rounded-lg border border-[#d0ccf5] px-2 text-sm outline-none focus:border-[#7b68ee]" />
                            {canManage && <button onClick={() => saveSubmission(p.id)} disabled={isPending} className="h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs disabled:opacity-50">저장</button>}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#514b81] mb-1.5 flex items-center gap-1"><Paperclip className="size-3.5" /> 부속자료 (지도·사진)</p>
                          <div className="space-y-1">
                            {p.attachments.map(a => (
                              <div key={a.id} className="flex items-center gap-2 text-xs">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f5f4ff] text-[#7b68ee]">{a.kind}</span>
                                <span className="text-[#090c1d] truncate flex-1">{a.file_name}</span>
                                {canManage && <button onClick={() => removeAttachment(a.id)} className="text-[#b0acd6] hover:text-red-500"><Trash2 className="size-3" /></button>}
                              </div>
                            ))}
                            {p.attachments.length === 0 && <p className="text-[11px] text-[#b0acd6]">등록된 부속자료 없음</p>}
                          </div>
                          {canManage && (
                            <div className="flex gap-3 mt-1.5">
                              <label className="text-[11px] text-[#7b68ee] cursor-pointer hover:underline">+ 지도<input type="file" className="hidden" onChange={e => uploadAttachment(p.id, e, '지도')} /></label>
                              <label className="text-[11px] text-[#7b68ee] cursor-pointer hover:underline">+ 사진<input type="file" accept="image/*" className="hidden" onChange={e => uploadAttachment(p.id, e, '사진')} /></label>
                              <label className="text-[11px] text-[#7b68ee] cursor-pointer hover:underline">+ 기타<input type="file" className="hidden" onChange={e => uploadAttachment(p.id, e, '기타')} /></label>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 소방계획서_7 H-15b(§6-A): 생성 단일화 — 업로드 진입 폐지(생성 가능 문서는 만들지, 받지 않는다).
          과거 업로드본은 위 목록에서 읽기 전용으로 유지, 예외적 외부 문서는 범용 문서함 사용.
          하단에 있던 [계획서 생성 (PDF)]는 상단 [개정 발행]으로 흡수했다 (소방계획서_21 R2-7) —
          같은 화면에 생성 버튼이 둘일 이유가 없고, 조회는 [현재 내용]이 파일 없이 담당한다 */}

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

      {/* 과거본 정리(소방계획서_18) 폐기 — 2026-08-18 사용자 확정.
          보관본은 앞으로 ERP에 계속 쌓아 둔다(자동 삭제 없음). 과거에 정리된 회차의
          '종이 보관' 마커는 판정 근거라 읽기 쪽에 그대로 남겨 뒀다. */}
    </div>
  )
}
