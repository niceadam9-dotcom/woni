'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { BookMarked, ExternalLink, Loader2, Pencil, Star, Trash2, Upload } from 'lucide-react'
import {
  listPlanTextsAction, getPlanTextAction, savePlanTextAction, setPlanTextDefaultAction,
  renamePlanTextAction, deletePlanTextAction, type PlanTextItem,
} from '@/app/(dashboard)/customers/plan-text-library-actions'
import type { PlanTextSectionDef } from '@/lib/plan-text-sections'

/** 공통 서술 라이브러리 칩 2개 — [공통에서 가져오기]·[공통으로 등록] (소방계획서_15_별도라이브러리.md §4)
 *  구 SectionCopyButton(720efd1에서 폐지) 팝오버 골격 재사용. 결정적 차이:
 *  가져오기는 **폼 상태만** 바꾼다(DB 저장 없음) — 사용자가 [저장]을 눌러야 반영되고,
 *  그 전엔 미저장 확인창(unsaved-nav)이 지킨다. 등록·이름변경·삭제·⭐기본지정 전부 이 팝오버 안 — 관리 화면 0개. */

export type AppliedMeta = { libraryId: string; version: number; title: string }

export function LibraryTextButton({ def, extract, onApply, disabled }: {
  def: PlanTextSectionDef                       // lib/plan-text-sections.ts 단일 원천 정의
  extract: () => unknown                        // 현재 폼 값 (등록 시 def.pick을 서버가 다시 태운다)
  onApply: (body: unknown, meta: AppliedMeta) => void  // 폼 상태 병합은 호출부가 def.merge로 수행
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PlanTextItem[] | null>(null)
  const [msg, setMsg] = useState('')
  const [confirmItem, setConfirmItem] = useState<PlanTextItem | null>(null)  // 치환형 덮어쓰기 확인
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [isPending, startTransition] = useTransition()
  const boxRef = useRef<HTMLDivElement | null>(null)

  // 외부 클릭·Esc 닫기 (customer-combobox 패턴)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  function reload() {
    startTransition(async () => {
      const res = await listPlanTextsAction(def.key)
      if (res.error) { setMsg(res.error); setItems([]); return }
      setItems(res.items ?? [])
    })
  }
  function toggleOpen() {
    setMsg(''); setConfirmItem(null); setRenameId(null)
    if (open) { setOpen(false); return }
    setOpen(true); setItems(null)
    reload()
  }

  /** 항목 선택 — 치환형이고 기존 서술이 있으면 인라인 확인 후 적용 (§4-1-3) */
  function pick(item: PlanTextItem) {
    if (def.mode === 'replace' && def.hasContent(extract()) && confirmItem?.id !== item.id) {
      setConfirmItem(item)
      return
    }
    setConfirmItem(null)
    startTransition(async () => {
      const res = await getPlanTextAction(item.id)
      if (res.error) { setMsg(res.error); return }
      setOpen(false)
      onApply(res.body, { libraryId: item.id, version: res.version ?? 1, title: res.title ?? item.title })
    })
  }

  /** [공통으로 등록] — 현재 폼의 서술 필드만 추출해 저장. 같은 이름이 있으면 덮어쓰기 확인 (§4-2) */
  function register() {
    const name = window.prompt(`공통 항목 이름 (${def.label})`, '')?.trim()
    if (!name) return
    startTransition(async () => {
      const list = await listPlanTextsAction(def.key)
      const dup = (list.items ?? []).find(i => i.title === name)
      if (dup && !window.confirm(`'${name}' 항목이 이미 있습니다. 덮어쓸까요? (취소 = 등록 중단)`)) return
      const res = await savePlanTextAction(def.key, name, extract(), dup?.id)
      if (res.error) { setMsg(res.error); return }
      setMsg(`✅ '${name}' 등록됨`)
      if (open) reload()
    })
  }

  function toggleDefault(item: PlanTextItem) {
    startTransition(async () => {
      const res = await setPlanTextDefaultAction(item.id, !item.isDefault)
      if (res.error) { setMsg(res.error); return }
      reload()
    })
  }
  function commitRename(id: string) {
    const name = renameVal.trim()
    setRenameId(null)
    if (!name) return
    startTransition(async () => {
      const res = await renamePlanTextAction(id, name)
      if (res.error) { setMsg(res.error); return }
      reload()
    })
  }
  function remove(item: PlanTextItem) {
    if (!window.confirm(`'${item.title}' 항목을 삭제할까요? (이미 가져간 고객 입력은 그대로 유지됩니다)`)) return
    startTransition(async () => {
      const res = await deletePlanTextAction(item.id)
      if (res.error) { setMsg(res.error); return }
      reload()
    })
  }

  const chipCls = 'inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] border border-brand-line text-brand hover:bg-brand-tint transition-colors disabled:opacity-50'
  return (
    <div className="relative inline-flex items-center gap-1" ref={boxRef}>
      <button onClick={toggleOpen} disabled={disabled} type="button" data-testid={`libtext-open-${def.key}`}
        title={`공통 서술 항목에서 골라 채웁니다 — 적용 후 [저장]을 눌러야 반영됩니다`}
        className={chipCls}>
        {isPending && open ? <Loader2 className="size-3 animate-spin" /> : <BookMarked className="size-3" />} 공통에서 가져오기
      </button>
      <button onClick={register} disabled={disabled || isPending} type="button" data-testid={`libtext-save-${def.key}`}
        title="현재 입력의 서술 부분만 공통 항목으로 등록합니다 (일자·인원 등 고객 고유 값은 제외)"
        className={chipCls}>
        <Upload className="size-3" /> 공통으로 등록
      </button>
      {msg && !open && <span className="text-[11px] text-ink-sub">{msg}</span>}

      {open && (
        <div className="absolute z-30 top-7 left-0 w-80 rounded-lg border border-brand-line bg-surface shadow-lg p-1.5" data-testid={`libtext-list-${def.key}`}>
          {items === null ? (
            <p className="text-[11px] text-ink-faint px-2 py-1.5">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-ink-faint px-2 py-1.5">{msg || `등록된 ${def.label} 공통 항목이 없습니다 — [공통으로 등록]으로 첫 항목을 만드세요.`}</p>
          ) : (
            <>
              <p className="text-[10px] text-ink-faint px-2 pb-1">
                {def.mode === 'append' ? '기존 기록은 그대로 두고 템플릿 행을 추가합니다.' : '선택하면 폼에 채워집니다 — [저장]을 눌러야 반영됩니다.'}
                {' '}⭐ = 새 고객에 자동으로 채워지는 기본항목
              </p>
              {items.map(it => (
                <div key={it.id} className="group rounded hover:bg-brand-tint">
                  {renameId === it.id ? (
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <input value={renameVal} onChange={e => setRenameVal(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(it.id); if (e.key === 'Escape') setRenameId(null) }}
                        className="h-6 flex-1 rounded border border-brand-line px-1.5 text-xs outline-none focus:border-brand" />
                      <button onClick={() => commitRename(it.id)} className="text-[11px] text-brand shrink-0">확인</button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-1 px-2 py-1.5">
                      <button onClick={() => pick(it)} disabled={isPending} type="button" className="flex-1 min-w-0 text-left disabled:opacity-50">
                        <span className="flex items-center gap-1 text-xs text-ink">
                          {it.isDefault && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                          <span className="truncate font-medium">{it.title}</span>
                          <span className="ml-auto text-[10px] text-ink-faint shrink-0">{it.updatedAt}</span>
                        </span>
                        {it.preview && <span className="block text-[10px] text-ink-soft truncate">{it.preview}</span>}
                      </button>
                      {/* 항목 관리 — 팝오버 안에서 전부 처리 (관리 화면 0개, §4-2) */}
                      <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleDefault(it)} title={it.isDefault ? '기본항목 해제' : '기본항목으로 지정 (새 고객 자동 채움)'}
                          className="p-0.5 text-ink-faint hover:text-amber-500"><Star className={`size-3 ${it.isDefault ? 'fill-amber-400 text-amber-400' : ''}`} /></button>
                        <button onClick={() => { setRenameId(it.id); setRenameVal(it.title) }} title="이름변경"
                          className="p-0.5 text-ink-faint hover:text-ink-sub"><Pencil className="size-3" /></button>
                        <button onClick={() => remove(it)} title="삭제"
                          className="p-0.5 text-ink-faint hover:text-red-500"><Trash2 className="size-3" /></button>
                      </span>
                    </div>
                  )}
                  {confirmItem?.id === it.id && (
                    <div className="px-2 pb-1.5 flex items-center gap-1.5">
                      <span className="text-[10px] text-amber-700">기존 서술을 덮어씁니다 —</span>
                      <button onClick={() => pick(it)} className="text-[10px] font-medium text-brand underline">적용</button>
                      <button onClick={() => setConfirmItem(null)} className="text-[10px] text-ink-faint">취소</button>
                    </div>
                  )}
                </div>
              ))}
              {msg && <p className="text-[11px] text-red-600 px-2 py-1">{msg}</p>}
            </>
          )}
          {/* 소방계획서_21 R1-10 ② — 전역 관리 화면으로. 새 탭인 이유: 같은 탭 이동은 서식의
              미저장 이동 확인창과 부딪혀, 가져오기를 보러 갔다가 입력을 잃을 수 있다 */}
          <a href={`/fire-plans/library?section=${def.key}`} target="_blank" rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 border-t border-brand-line-soft px-2 pt-1.5 pb-0.5 text-[10px] text-brand hover:underline">
            전체 관리 <ExternalLink className="size-2.5" />
          </a>
        </div>
      )}
    </div>
  )
}
