'use client'

import { useState, useRef, useTransition } from 'react'
import { Plus, Trash2, Camera, AlertTriangle, X, Upload, Wrench, Check } from 'lucide-react'
import {
  addDefectAction,
  uploadDefectPhotoAction,
  deleteDefectAction,
  updateDefectActionAction,
  type DefectSeverity,
} from '@/app/(dashboard)/inspections/defect-actions'
import { createActionPlanAction } from '@/app/(dashboard)/action-plans/actions'
import { DateInput } from '@/components/ui/date-input'

// ── types ──────────────────────────────────────────────────────────────────
type Defect = {
  id: string
  defect_code: string | null
  defect_name: string
  defect_detail: string | null
  photo_url: string | null
  after_photo_url: string | null
  action_taken: string | null
  action_completed_at: string | null
  action_plan?: string | null
  action_start?: string | null
  action_end?: string | null
  severity: DefectSeverity
  created_at: string
}

const SEVERITY_CONFIG: Record<DefectSeverity, { label: string; cls: string }> = {
  경미: { label: '경미', cls: 'bg-yellow-100 text-yellow-700' },
  보통: { label: '보통', cls: 'bg-orange-100 text-orange-700' },
  중대: { label: '중대', cls: 'bg-red-100 text-red-700' },
}

// ── 사진 업로드 핸들러 ─────────────────────────────────────────────────────
function PhotoUploadButton({
  defectId,
  inspectionId,
  currentUrl,
  disabled,
  field = 'before',
  label,
}: {
  defectId: string
  inspectionId: string
  currentUrl: string | null
  disabled?: boolean
  field?: 'before' | 'after'
  label?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<string | null>(currentUrl)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const local = URL.createObjectURL(file)
    setPreview(local)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('defectId',     defectId)
      fd.append('inspectionId', inspectionId)
      fd.append('file',         file)
      fd.append('field',        field)
      const res = await uploadDefectPhotoAction(fd)
      if (res.error) { setErr(res.error); setPreview(currentUrl) }
    })
  }

  return (
    <div className="relative">
      {preview ? (
        <div className="relative group inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="불량사진" className="w-20 h-20 object-cover rounded border" />
          {!disabled && (
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded transition-opacity"
            >
              <Camera size={14} className="text-white" />
            </button>
          )}
        </div>
      ) : (
        !disabled && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="w-20 h-20 border-2 border-dashed border-gray-300 rounded flex flex-col items-center justify-center gap-1 hover:border-[#7b68ee] transition-colors"
          >
            {pending ? <Upload size={14} className="animate-pulse text-gray-400" /> : <Camera size={14} className="text-gray-400" />}
            <span className="text-[10px] text-gray-400">사진 추가</span>
          </button>
        )
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {err && <p className="text-[10px] text-red-500 mt-0.5">{err}</p>}
    </div>
  )
}

// ── 조치완료 섹션 (P34-4, 완료보고서용) ───────────────────────────────────
function DefectActionSection({ defect, inspectionId, canEdit }: {
  defect: Defect
  inspectionId: string
  canEdit: boolean
}) {
  const [open, setOpen] = useState(!!(defect.action_taken || defect.action_completed_at || defect.action_plan))
  const [taken, setTaken] = useState(defect.action_taken ?? '')
  const [date, setDate] = useState(defect.action_completed_at ?? '')
  const [plan, setPlan] = useState(defect.action_plan ?? '')
  const [planStart, setPlanStart] = useState(defect.action_start ?? '')
  const [planEnd, setPlanEnd] = useState(defect.action_end ?? '')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')

  function save() {
    setMsg('')
    startTransition(async () => {
      const res = await updateDefectActionAction({
        defectId: defect.id, inspectionId,
        actionTaken: taken, actionCompletedAt: date || null,
        actionPlan: plan, actionStart: planStart || null, actionEnd: planEnd || null,
      })
      setMsg(res.error ?? '조치 내용을 저장했습니다.')
    })
  }

  const done = !!defect.action_completed_at
  const planned = !!(defect.action_plan || defect.action_start)
  return (
    <div className="mt-2 pt-2 border-t border-dashed">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 text-xs text-[#7b68ee] font-medium">
        <Wrench size={12} /> 이행계획·조치 완료 {planned && <span className="text-[10px] text-amber-600">계획</span>} {done && <Check size={12} className="text-green-600" />}
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-3 items-start">
          <div className="space-y-2">
            {/* 이행계획 (별지 10호 — §9-7) */}
            <textarea rows={1} value={plan} onChange={e => setPlan(e.target.value)} disabled={!canEdit}
              placeholder="이행조치 계획 (별지 10호 — 예: 유도등 램프 교체)" className="w-full border rounded px-2 py-1.5 text-sm resize-none" />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 shrink-0">이행 기간</span>
              <DateInput value={planStart} onChange={e => setPlanStart(e.target.value)} disabled={!canEdit} className="text-sm w-32" />
              <span className="text-xs text-gray-400">~</span>
              <DateInput value={planEnd} onChange={e => setPlanEnd(e.target.value)} disabled={!canEdit} className="text-sm w-32" />
            </div>
            <textarea rows={2} value={taken} onChange={e => setTaken(e.target.value)} disabled={!canEdit}
              placeholder="조치 내용" className="w-full border rounded px-2 py-1.5 text-sm resize-none" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">조치완료일</span>
              <DateInput value={date} onChange={e => setDate(e.target.value)} disabled={!canEdit} className="text-sm" />
              {canEdit && (
                <button onClick={save} disabled={pending}
                  className="ml-auto text-xs bg-[#7b68ee] text-white px-3 py-1.5 rounded disabled:opacity-50">
                  {pending ? '저장…' : '저장'}
                </button>
              )}
            </div>
            {msg && <p className="text-[11px] text-green-600">{msg}</p>}
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-gray-400">조치 후</span>
            <PhotoUploadButton defectId={defect.id} inspectionId={inspectionId}
              currentUrl={defect.after_photo_url} disabled={!canEdit} field="after" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── 불량 추가 폼 ──────────────────────────────────────────────────────────
function AddDefectForm({
  inspectionId,
  onClose,
}: {
  inspectionId: string
  onClose: () => void
}) {
  const [defectCode,   setDefectCode]   = useState('')
  const [defectName,   setDefectName]   = useState('')
  const [defectDetail, setDefectDetail] = useState('')
  const [severity,     setSeverity]     = useState<DefectSeverity>('보통')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function save() {
    if (!defectName.trim()) { setErr('불량 설비명을 입력해 주세요.'); return }
    startTransition(async () => {
      const res = await addDefectAction({
        inspectionId,
        defectCode:   defectCode   || null,
        defectName:   defectName.trim(),
        defectDetail: defectDetail || null,
        severity,
      })
      if (res.error) { setErr(res.error); return }
      onClose()
    })
  }

  return (
    <div className="border rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">불량내역 추가</span>
        <button onClick={onClose}><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">불량코드 (선택)</label>
          <input
            value={defectCode}
            onChange={e => setDefectCode(e.target.value)}
            placeholder="예: D-001"
            className="w-full border rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">경중<span className="text-red-500 ml-0.5">*</span></label>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as DefectSeverity)}
            className="w-full border rounded px-2 py-1.5 text-sm"
          >
            <option>경미</option>
            <option>보통</option>
            <option>중대</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">불량 설비명<span className="text-red-500 ml-0.5">*</span></label>
        <input
          value={defectName}
          onChange={e => setDefectName(e.target.value)}
          placeholder="예: 소화기 압력 부족"
          className="w-full border rounded px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">상세 내용</label>
        <textarea
          rows={2}
          value={defectDetail}
          onChange={e => setDefectDetail(e.target.value)}
          placeholder="불량 내용을 상세히 입력해 주세요"
          className="w-full border rounded px-2 py-1.5 text-sm resize-none"
        />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded">취소</button>
        <button
          onClick={save}
          disabled={pending}
          className="px-3 py-1.5 text-sm bg-[#7b68ee] text-white rounded disabled:opacity-50"
        >
          {pending ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export function InspectionDefectsClient({
  inspectionId,
  initialDefects,
  canEdit,
  canDelete,
  hasActionPlan = false,
}: {
  inspectionId: string
  initialDefects: Defect[]
  canEdit: boolean
  canDelete: boolean
  hasActionPlan?: boolean
}) {
  const [showForm, setShowForm]   = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [planCreating, startPlanTransition] = useTransition()
  const [planMsg, setPlanMsg]     = useState('')
  const [planCreated, setPlanCreated] = useState(hasActionPlan)

  function handleCreatePlan() {
    startPlanTransition(async () => {
      const res = await createActionPlanAction({ inspectionId })
      if (res.error) { setPlanMsg(res.error); return }
      setPlanCreated(true)
      setPlanMsg('이행계획서가 생성되었습니다.')
    })
  }

  function handleDelete(defectId: string) {
    setDeleting(defectId)
    startTransition(async () => {
      await deleteDefectAction(defectId, inspectionId)
      setDeleting(null)
      setDeleteConfirm(null)
    })
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-orange-500" />
          <span className="text-sm font-semibold text-[#090c1d]">불량내역</span>
          {initialDefects.length > 0 && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
              {initialDefects.length}건
            </span>
          )}
        </div>
        {canEdit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs bg-[#7b68ee] text-white px-3 py-1.5 rounded-lg"
          >
            <Plus size={12} /> 불량내역 추가
          </button>
        )}
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="mb-4">
          <AddDefectForm
            inspectionId={inspectionId}
            onClose={() => setShowForm(false)}
          />
        </div>
      )}

      {/* 이행계획 생성 버튼 (불량 1건 이상일 때) */}
      {canDelete && initialDefects.length > 0 && (
        <div className="mb-3 flex items-center gap-3">
          {planCreated ? (
            <span className="text-xs text-green-600 font-medium">✓ 이행계획서 생성됨</span>
          ) : (
            <button
              onClick={handleCreatePlan}
              disabled={planCreating}
              className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {planCreating ? '생성 중…' : '이행계획 자동생성'}
            </button>
          )}
          {planMsg && <span className="text-xs text-gray-500">{planMsg}</span>}
        </div>
      )}

      {/* 빈 상태 */}
      {initialDefects.length === 0 && !showForm && (
        <div className="text-center py-8 text-gray-400 text-sm">
          등록된 불량내역이 없습니다.
        </div>
      )}

      {/* 불량내역 목록 */}
      <div className="space-y-3">
        {initialDefects.map(defect => {
          const sev = SEVERITY_CONFIG[defect.severity] ?? SEVERITY_CONFIG['보통']
          const isDeleting = deleting === defect.id

          return (
            <div
              key={defect.id}
              className={`border rounded-lg p-3 transition-opacity ${isDeleting ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start gap-3">
                {/* 사진 */}
                <PhotoUploadButton
                  defectId={defect.id}
                  inspectionId={inspectionId}
                  currentUrl={defect.photo_url}
                  disabled={!canEdit}
                />

                {/* 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${sev.cls}`}>
                      {sev.label}
                    </span>
                    {defect.defect_code && (
                      <span className="text-[10px] text-gray-400 font-mono">{defect.defect_code}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-[#090c1d] leading-snug">{defect.defect_name}</p>
                  {defect.defect_detail && (
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{defect.defect_detail}</p>
                  )}
                  <p className="text-[10px] text-gray-300 mt-1.5">
                    {defect.created_at.slice(0, 10)}
                  </p>
                </div>

                {/* 삭제 버튼 */}
                {canDelete && (
                  <div>
                    {deleteConfirm === defect.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(defect.id)}
                          disabled={pending}
                          className="text-[10px] text-white bg-red-500 px-2 py-1 rounded"
                        >
                          삭제
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-[10px] text-gray-500 border px-2 py-1 rounded"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(defect.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <DefectActionSection defect={defect} inspectionId={inspectionId} canEdit={canEdit} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
