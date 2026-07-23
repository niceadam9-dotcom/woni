'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { Plus, Trash2, Camera, AlertTriangle, X, Upload, Wrench, Check, Images } from 'lucide-react'
import {
  addDefectAction,
  uploadDefectPhotoAction,
  deleteDefectAction,
  updateDefectActionAction,
  getDefectSuggestionsAction,
  type DefectSeverity,
} from '@/app/(dashboard)/inspections/defect-actions'
import { createActionPlanAction } from '@/app/(dashboard)/action-plans/actions'
import { DateInput } from '@/components/ui/date-input'
import { PhotoGalleryModal } from '@/components/inspections/photo-gallery-modal'
import { useRouter } from 'next/navigation'

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
            className={`w-20 h-20 border-2 border-dashed rounded flex flex-col items-center justify-center gap-1 transition-colors ${field === 'after' ? 'border-amber-300 hover:border-amber-500' : 'border-gray-300 hover:border-[#7b68ee]'}`}
          >
            {pending ? <Upload size={14} className="animate-pulse text-gray-400" /> : <Camera size={14} className={field === 'after' ? 'text-amber-500' : 'text-gray-400'} />}
            <span className={`text-[10px] leading-tight text-center ${field === 'after' ? 'text-amber-600' : 'text-gray-400'}`}>{label ?? (field === 'after' ? '후(조치) 사진' : '전(불량) 사진')}</span>
          </button>
        )
      )}
      {/* R6-d: 모바일에서 슬롯 탭 시 카메라 바로 실행(capture) */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
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

// ── 불량 메모 최근 문구 (R13-e) — localStorage 최근 5개 ──
const MEMO_KEY = 'defectRecentMemos'
function loadRecentMemos(): string[] {
  try { return JSON.parse(localStorage.getItem(MEMO_KEY) ?? '[]') as string[] } catch { return [] }
}
function pushRecentMemo(m: string) {
  const t = m.trim()
  if (!t) return
  const cur = loadRecentMemos().filter(x => x !== t)
  localStorage.setItem(MEMO_KEY, JSON.stringify([t, ...cur].slice(0, 5)))
}

// ── 불량 추가 폼 (소방계획서_5 ⑫ — 단골 칩·연속 입력·사진 즉시·메모 자동완성) ─────────
function AddDefectForm({
  inspectionId,
  suggestions,
  onClose,
  onAdded,
}: {
  inspectionId: string
  suggestions: { chips: string[]; standard: string[] }
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const [defectCode,   setDefectCode]   = useState('')
  const [defectName,   setDefectName]   = useState('')
  const [defectDetail, setDefectDetail] = useState('')
  const [severity,     setSeverity]     = useState<DefectSeverity>('보통')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [keepOpen, setKeepOpen] = useState(true)   // R13-b: 연속 입력 모드 기본 ON
  const [recentMemos, setRecentMemos] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const [chipBusy, setChipBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setRecentMemos(loadRecentMemos()) }, [])

  function reset() {
    setDefectCode(''); setDefectName(''); setDefectDetail(''); setSeverity('보통')
    setPhoto(null); setPhotoPreview(null); setErr('')
    nameRef.current?.focus()
  }

  // 사진까지 한 번에 저장 (R13-c) — 등록 후 반환 id로 before 슬롯 업로드
  async function persist(name: string, detail: string | null, sev: DefectSeverity, file: File | null): Promise<string | null> {
    const res = await addDefectAction({ inspectionId, defectCode: defectCode || null, defectName: name, defectDetail: detail, severity: sev })
    if (res.error || !res.id) { setErr(res.error ?? '저장에 실패했습니다.'); return null }
    if (file) {
      const fd = new FormData()
      fd.append('defectId', res.id); fd.append('inspectionId', inspectionId)
      fd.append('file', file); fd.append('field', 'before')
      await uploadDefectPhotoAction(fd)
    }
    if (detail) { pushRecentMemo(detail); setRecentMemos(loadRecentMemos()) }
    return res.id
  }

  function save() {
    if (!defectName.trim()) { setErr('불량 설비명을 입력해 주세요.'); return }
    startTransition(async () => {
      const id = await persist(defectName.trim(), defectDetail || null, severity, photo)
      if (!id) return
      onAdded(defectName.trim())
      if (keepOpen) reset()
      else onClose()
    })
  }

  // R13-a: 단골 칩 1탭 → 표준 문구로 즉시 등록 (메모·사진은 이후 선택 입력)
  function quickAdd(name: string) {
    setChipBusy(name)
    startTransition(async () => {
      const id = await persist(name, null, '보통', null)
      setChipBusy(null)
      if (id) onAdded(name)
    })
  }

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhoto(file); setPhotoPreview(URL.createObjectURL(file))
  }

  return (
    <div className="border rounded-xl p-4 bg-gray-50 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">불량내역 추가</span>
        <button onClick={onClose}><X size={14} /></button>
      </div>

      {/* R13-a 단골 불량 원터치 칩 — 검색 없이 1탭 등록 */}
      {suggestions.chips.length > 0 && (
        <div>
          <p className="text-[11px] text-gray-500 mb-1">단골 불량 — 1탭 등록</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.chips.map(c => (
              <button key={c} onClick={() => quickAdd(c)} disabled={pending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-[#d0ccf5] text-[11px] text-[#514b81] hover:border-[#7b68ee] hover:text-[#7b68ee] disabled:opacity-50">
                {chipBusy === c ? <Upload size={10} className="animate-pulse" /> : <Plus size={10} />} {c}
              </button>
            ))}
          </div>
        </div>
      )}

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
          ref={nameRef}
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
        {/* R13-e 메모 자동완성 — 최근 문구 + 표준 문구 칩 */}
        {(recentMemos.length > 0 || suggestions.standard.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {[...recentMemos, ...suggestions.standard.filter(s => !recentMemos.includes(s))].slice(0, 8).map(m => (
              <button key={m} onClick={() => setDefectDetail(m)}
                className="px-1.5 py-0.5 rounded border border-gray-200 text-[10px] text-gray-500 hover:border-[#7b68ee] hover:text-[#7b68ee] max-w-[12rem] truncate">
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* R13-c 사진 즉시 첨부 — 저장 시 photo_url까지 한 번에 */}
      <div className="flex items-center gap-2">
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickPhoto} />
        {photoPreview ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="전 사진" className="w-14 h-14 object-cover rounded border" />
            <button onClick={() => { setPhoto(null); setPhotoPreview(null) }} className="text-[11px] text-gray-400 hover:text-red-500">사진 제거</button>
          </div>
        ) : (
          <button onClick={() => photoRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-[#7b68ee] hover:text-[#7b68ee]">
            <Camera size={13} /> 전(불량) 사진
          </button>
        )}
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} className="accent-[#7b68ee]" />
          저장 후 계속 입력
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded">닫기</button>
          <button
            onClick={save}
            disabled={pending}
            className="px-3 py-1.5 text-sm bg-[#7b68ee] text-white rounded disabled:opacity-50"
          >
            {pending ? '저장 중…' : '저장'}
          </button>
        </div>
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
  const [suggestions, setSuggestions] = useState<{ chips: string[]; standard: string[] }>({ chips: [], standard: [] })
  const [addedCount, setAddedCount] = useState(0)   // R13-b: 이번 세션 연속 등록 수
  const [showGallery, setShowGallery] = useState(false)   // R6: 전/후 사진 갤러리
  const router = useRouter()

  // 단골 칩·표준 문구는 폼을 처음 열 때 한 번 로드 (R13-a·R13-e)
  useEffect(() => {
    if (!showForm || suggestions.chips.length > 0) return
    getDefectSuggestionsAction().then(setSuggestions).catch(() => {})
  }, [showForm, suggestions.chips.length])

  // R6-b: #photos 딥링크 진입 — 타임라인 ⑤·문서 현황 [사진 보기]에서 갤러리 바로 열기 (마운트 + 같은 페이지 hashchange)
  useEffect(() => {
    const openIfHash = () => {
      if (window.location.hash === '#photos' && initialDefects.length > 0) setShowGallery(true)
    }
    openIfHash()
    window.addEventListener('hashchange', openIfHash)
    return () => window.removeEventListener('hashchange', openIfHash)
  }, [initialDefects.length])

  const photoPairs = initialDefects.filter(d => d.photo_url && d.after_photo_url).length

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
        <div className="flex items-center gap-2">
          {/* R6-b 진입점 ⓐ — 불량내역 헤더 [전/후 사진 모아보기] */}
          {initialDefects.length > 0 && (
            <button
              onClick={() => setShowGallery(true)}
              className="flex items-center gap-1.5 text-xs border border-[#d0ccf5] text-[#514b81] hover:border-[#7b68ee] hover:text-[#7b68ee] px-3 py-1.5 rounded-lg"
            >
              <Images size={13} /> 전/후 사진 모아보기 ({photoPairs}/{initialDefects.length}쌍)
            </button>
          )}
          {canEdit && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-xs bg-[#7b68ee] text-white px-3 py-1.5 rounded-lg"
            >
              <Plus size={12} /> 불량내역 추가
            </button>
          )}
        </div>
      </div>

      {/* R6 전/후 사진 갤러리 모달 */}
      {showGallery && (
        <PhotoGalleryModal
          inspectionId={inspectionId}
          defects={initialDefects}
          canEdit={canEdit}
          onClose={() => setShowGallery(false)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* 추가 폼 */}
      {showForm && (
        <div className="mb-4">
          {addedCount > 0 && (
            <p className="text-[11px] text-green-600 mb-1.5 font-medium">이번 점검 등록 {addedCount}건 — 아래 목록에서 확인·삭제할 수 있습니다</p>
          )}
          <AddDefectForm
            inspectionId={inspectionId}
            suggestions={suggestions}
            onClose={() => setShowForm(false)}
            onAdded={() => setAddedCount(c => c + 1)}
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
