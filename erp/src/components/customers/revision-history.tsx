'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Pencil, Trash2, Save, X, ChevronRight, ChevronDown } from 'lucide-react'
import {
  addRevisionAction, updateRevisionAction, deleteRevisionAction, listRevisionsAction,
  type RevisionYearGroup, type RevisionRowData,
} from '@/app/(dashboard)/customers/fire-plan-revision-actions'
import { DateInput } from '@/components/ui/date-input'
import { useUnsavedWarning } from '@/components/ui/fields'

/** 보관함 개정이력 — 연도별 히스토리 (소방계획서_17.md §2-5)
 *
 *  화면은 연도로 묶고(최신 연도만 펼침), 인쇄는 전 연도 시계열 통합이다 —
 *  법정 서식의 개정이력은 그 문서 전체의 이력이라 연도로 쪼개지 않는다.
 *  자동 행(생성·업로드 실적)은 일자·출처가 잠기고 서술·작성자·검토·승인만 고칠 수 있다. */

type Draft = { revisedOn: string; content: string; authorName: string; reviewerName: string; approverName: string }
const EMPTY_DRAFT: Draft = { revisedOn: '', content: '', authorName: '', reviewerName: '', approverName: '' }

const SOURCE_LABEL: Record<RevisionRowData['source'], string> = {
  generated: '생성', uploaded: '업로드', manual: '수동',
}

export function RevisionHistory({ customerId, canManage, initialYears, currentYear }: {
  customerId: string
  canManage: boolean
  initialYears: RevisionYearGroup[]
  currentYear: number
}) {
  const router = useRouter()
  const [years, setYears] = useState<RevisionYearGroup[]>(initialYears)
  // 최신 연도만 펼친다 — 이력이 쌓일수록 과거 연도는 접혀 있는 편이 읽기 쉽다
  const [openYears, setOpenYears] = useState<Set<number>>(new Set(initialYears.slice(0, 1).map(g => g.year)))
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [addOpen, setAddOpen] = useState(false)
  const [addYear, setAddYear] = useState(currentYear)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  const editingRow = editId ? years.flatMap(g => g.rows).find(r => r.id === editId) ?? null : null
  const dirty = addOpen
    ? Object.values(draft).some(v => v.trim())
    : !!editingRow && (
      draft.revisedOn !== editingRow.revisedOn || draft.content !== editingRow.content
      || draft.authorName !== editingRow.authorName || draft.reviewerName !== editingRow.reviewerName
      || draft.approverName !== editingRow.approverName
    )
  // 미저장 이탈 경고 + 이동 확인창 [저장하고 이동] — 편집 중 다른 서식으로 넘어가도 값이 살아남는다
  useUnsavedWarning(canManage && dirty, commit)

  async function reload() {
    const res = await listRevisionsAction(customerId)
    if (res.years) setYears(res.years)
  }

  function startEdit(r: RevisionRowData) {
    setAddOpen(false)
    setEditId(r.id)
    setMsg('')
    setDraft({
      revisedOn: r.revisedOn, content: r.content, authorName: r.authorName,
      reviewerName: r.reviewerName, approverName: r.approverName,
    })
  }
  function startAdd() {
    setEditId(null)
    setAddOpen(true)
    setAddYear(currentYear)
    setMsg('')
    setDraft({ ...EMPTY_DRAFT, revisedOn: new Date().toISOString().slice(0, 10) })
  }
  function cancel() { setEditId(null); setAddOpen(false); setDraft(EMPTY_DRAFT); setMsg('') }

  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function commit(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        if (addOpen) {
          const res = await addRevisionAction(customerId, addYear, draft)
          if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
          setOpenYears(p => new Set(p).add(addYear))
        } else if (editId && editingRow) {
          // 자동 행은 일자를 서버가 거부하므로 아예 보내지 않는다
          const patch = editingRow.source === 'manual' ? draft : { ...draft, revisedOn: undefined }
          const res = await updateRevisionAction(customerId, editId, patch)
          if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        } else { resolve(true); return }
        cancel()
        await reload()
        setMsg('✅ 개정이력 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  function remove(r: RevisionRowData) {
    if (!window.confirm(`${r.year}년 ${r.seq}번 개정 기록을 삭제할까요?`)) return
    startTransition(async () => {
      const res = await deleteRevisionAction(customerId, r.id)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      await reload()
      setMsg('✅ 삭제됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const total = years.reduce((n, g) => n + g.rows.length, 0)

  const draftFields = (withDate: boolean) => (
    <div className="flex items-center gap-1.5 flex-wrap py-1.5">
      {withDate ? (
        <DateInput value={draft.revisedOn} title="개정일"
          onChange={e => setDraft(p => ({ ...p, revisedOn: e.target.value }))} className={`${inputCls} w-32`} />
      ) : (
        <span className="text-[10px] text-[#b0acd6] w-32 shrink-0">일자 고정 (생성 실적)</span>
      )}
      <input value={draft.content} placeholder="주요 개정내용" autoFocus
        onChange={e => setDraft(p => ({ ...p, content: e.target.value }))} className={`${inputCls} flex-1 min-w-40`} />
      <input value={draft.authorName} placeholder="작성자"
        onChange={e => setDraft(p => ({ ...p, authorName: e.target.value }))} className={`${inputCls} w-20`} />
      <input value={draft.reviewerName} placeholder="검토"
        onChange={e => setDraft(p => ({ ...p, reviewerName: e.target.value }))} className={`${inputCls} w-16`} />
      <input value={draft.approverName} placeholder="승인"
        onChange={e => setDraft(p => ({ ...p, approverName: e.target.value }))} className={`${inputCls} w-16`} />
      {/* 같은 화면에 '저장' 버튼이 여럿이라 텍스트로는 못 겨눈다(소방안전관리자 패널의 비활성 저장이 먼저 잡힌다) */}
      <button onClick={() => { void commit() }} disabled={isPending} data-testid="revision-save"
        className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-[#7b68ee] text-white text-[11px] font-medium disabled:opacity-50">
        {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 저장
      </button>
      <button onClick={cancel} disabled={isPending} className="p-1 text-[#b0acd6] hover:text-[#514b81]" title="취소">
        <X className="size-3.5" />
      </button>
    </div>
  )

  return (
    <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-semibold text-[#514b81]">개정이력
          <span className="font-normal text-[#b0acd6] ml-2">연도별 · 총 {total}건</span>
        </p>
        {canManage && (
          <button onClick={startAdd} disabled={isPending}
            className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
            <Plus className="size-3" /> 개정 추가
          </button>
        )}
      </div>

      {addOpen && (
        <div className="rounded-lg border border-[#d0ccf5] bg-white px-2 mb-2">
          <div className="flex items-center gap-1.5 pt-2">
            <label className="text-[11px] font-medium text-[#514b81]">연도</label>
            <input type="number" value={addYear} inputMode="numeric"
              onChange={e => setAddYear(Number(e.target.value) || currentYear)} className={`${inputCls} w-20`} />
            <span className="text-[10px] text-[#b0acd6]">문서 생성 없이 일어난 변경도 이력으로 남길 수 있습니다</span>
          </div>
          {draftFields(true)}
        </div>
      )}

      {years.length === 0 && !addOpen && (
        <p className="text-[11px] text-[#b0acd6] mb-2">개정이력이 없습니다 — 첫 생성 시 1행이 자동 기록되고, [개정 추가]로 직접 남길 수도 있습니다.</p>
      )}

      <div className="space-y-1.5">
        {years.map(g => {
          const open = openYears.has(g.year)
          return (
            <div key={g.year} className="rounded-lg border border-[#e0ddf5] bg-white">
              <button onClick={() => setOpenYears(p => {
                const n = new Set(p); if (n.has(g.year)) n.delete(g.year); else n.add(g.year); return n
              })} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[#f5f4ff] rounded-lg">
                {open ? <ChevronDown className="size-3.5 text-[#7b68ee]" /> : <ChevronRight className="size-3.5 text-[#b0acd6]" />}
                <span className="text-xs font-semibold text-[#090c1d]">{g.year}년</span>
                <span className="text-[10px] text-[#b0acd6]">· {g.rows.length}건</span>
              </button>
              {open && (
                <div className="px-2 pb-1.5 border-t border-[#f3f1fb]">
                  {g.rows.map(r => (
                    <div key={r.id} data-testid={`rev-row-${r.year}-${r.seq}`} className="border-b border-[#f3f1fb] last:border-0">
                      {editId === r.id ? draftFields(r.source === 'manual') : (
                        <div className="group flex items-start gap-1.5 py-1.5 text-xs">
                          <span className="w-6 shrink-0 text-[#b0acd6]">{r.seq}</span>
                          <span className="w-24 shrink-0 text-[#090c1d]">{r.revisedOn || '—'}</span>
                          <span className="flex-1 min-w-0 text-[#090c1d] break-words">
                            {r.content || <span className="text-[#b0acd6]">(내용 없음)</span>}
                          </span>
                          <span className="w-16 shrink-0 text-[#514b81] truncate" title="작성자">{r.authorName || '—'}</span>
                          <span className="w-12 shrink-0 text-[#514b81] truncate" title="검토">{r.reviewerName || '—'}</span>
                          <span className="w-12 shrink-0 text-[#514b81] truncate" title="승인">{r.approverName || '—'}</span>
                          <span className={`shrink-0 h-5 px-1.5 rounded-full text-[10px] leading-5 ${
                            r.source === 'manual' ? 'bg-[#f5f4ff] text-[#7b68ee]' : 'bg-[#f8f9fa] text-[#847ba8]'}`}>
                            {SOURCE_LABEL[r.source]}
                          </span>
                          {canManage && (
                            <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => startEdit(r)} title="수정" className="p-0.5 text-[#b0acd6] hover:text-[#514b81]">
                                <Pencil className="size-3" />
                              </button>
                              {r.source === 'manual' && (
                                <button onClick={() => remove(r)} title="삭제" className="p-0.5 text-[#b0acd6] hover:text-red-500">
                                  <Trash2 className="size-3" />
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {msg && <p className="text-[11px] text-[#514b81] mt-2">{msg}</p>}
      <p className="text-[10px] text-[#b0acd6] mt-2">
        생성(HWP·PDF) 시 이 이력이 문서의 개정이력 표에 전 연도 시계열로 인쇄됩니다 · 생성·업로드 이력은 일자·삭제가 잠깁니다.
      </p>
    </div>
  )
}
