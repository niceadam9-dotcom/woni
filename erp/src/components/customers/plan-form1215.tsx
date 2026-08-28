'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { stampPlanTextAppliedAction } from '@/app/(dashboard)/customers/plan-text-library-actions'
import { CardAnchorBar, useUnsavedWarning } from '@/components/ui/fields'
import { DateInput } from '@/components/ui/date-input'
import { LibraryTextButton, type AppliedMeta } from '@/components/customers/library-text-button'
import { PLAN_TEXT_SECTIONS } from '@/lib/plan-text-sections'

/** 서식 1.12~1.15 기록부 4종 (소방계획서_4.md §3 — §12-3 결정 2026-07-23: v1 포함)
 *  1.12 화기취급 감독 · 1.13 소방시설 공사/정비 기록 · 1.14 화재예방 및 홍보 · 1.15 피해 복구
 *  공통 = 일자 + 텍스트 열 행 기록 (섹션 카드 세로 배치, 저장 버튼 1개 — §1-2) */

export type LogRow = Record<string, string>

type CardDef = { key: string; title: string; cols: Array<{ k: string; label: string; w: string }> }
const CARDS: CardDef[] = [
  {
    key: 'fireworkLog', title: '1.12 화기취급 감독',
    cols: [
      { k: 'date', label: '일자', w: 'w-36' }, { k: 'place', label: '작업 장소', w: 'w-32' },
      { k: 'work', label: '작업 내용', w: 'flex-1 min-w-40' }, { k: 'supervisor', label: '감독자', w: 'w-24' },
      { k: 'measure', label: '안전조치', w: 'w-40' },
    ],
  },
  {
    key: 'constructionLog', title: '1.13 소방시설 공사·정비 기록',
    cols: [
      { k: 'date', label: '일자', w: 'w-36' }, { k: 'facility', label: '대상 설비', w: 'w-32' },
      { k: 'content', label: '공사·정비 내용', w: 'flex-1 min-w-40' }, { k: 'company', label: '시공업체', w: 'w-28' },
      { k: 'note', label: '비고', w: 'w-28' },
    ],
  },
  {
    key: 'promoLog', title: '1.14 화재예방 및 홍보',
    cols: [
      { k: 'date', label: '일자', w: 'w-36' }, { k: 'method', label: '방법(게시·방송·교육 등)', w: 'w-40' },
      { k: 'content', label: '내용', w: 'flex-1 min-w-40' }, { k: 'target', label: '대상', w: 'w-28' },
    ],
  },
  {
    key: 'recoveryLog', title: '1.15 피해 복구',
    cols: [
      { k: 'date', label: '일자', w: 'w-36' }, { k: 'damage', label: '피해 내용', w: 'flex-1 min-w-40' },
      { k: 'recovery', label: '복구 조치', w: 'flex-1 min-w-40' }, { k: 'cost', label: '비용', w: 'w-24' },
    ],
  },
]

export function PlanForm1215({ customerId, canManage, initial }: {
  customerId: string
  canManage: boolean
  initial: Record<string, LogRow[]>   // sections.fireworkLog / constructionLog / promoLog / recoveryLog
}) {
  const router = useRouter()
  const [logs, setLogs] = useState<Record<string, LogRow[]>>(() =>
    Object.fromEntries(CARDS.map(c => [c.key, initial[c.key] ?? []])))
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  // 공통 서술 가져오기 출처 — 카드(섹션)별 누적, 저장 성공 시에만 스탬프 (§3-2)
  const [libMetas, setLibMetas] = useState<Record<string, AppliedMeta>>({})

  function addRow(card: CardDef) {
    setLogs(p => ({ ...p, [card.key]: [...p[card.key], Object.fromEntries(card.cols.map(c => [c.k, '']))] }))
    setDirty(true)
  }
  function setCell(key: string, i: number, k: string, v: string) {
    setLogs(p => ({ ...p, [key]: p[key].map((r, j) => (j === i ? { ...r, [k]: v } : r)) }))
    setDirty(true)
  }
  function delRow(key: string, i: number) {
    setLogs(p => ({ ...p, [key]: p[key].filter((_, j) => j !== i) }))
    setDirty(true)
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const patch = Object.fromEntries(CARDS.map(c => [
          c.key, logs[c.key].filter(r => Object.values(r).some(v => v.trim())),
        ]))
        const res = await saveFirePlanSectionsAction(customerId, patch)
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.12~1.15 저장됨')
        // 공통 서술을 가져와 저장까지 마친 섹션만 출처 스탬프 (§3-2)
        for (const [key, m] of Object.entries(libMetas)) void stampPlanTextAppliedAction(customerId, key, m.libraryId, m.version)
        setLibMetas({})
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-7 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand'

  return (
    <div className="space-y-4">
      {/* §1-2 카드 앵커 점프 */}
      <CardAnchorBar items={CARDS.map(c => ({ id: `c-${c.title.split(' ')[0]}`, label: c.title }))} />
      {CARDS.map(card => (
        <div key={card.key} id={`c-${card.title.split(' ')[0]}`} className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="text-xs font-semibold text-ink-sub">{card.title}</p>
            {canManage && (
              <span className="ml-auto inline-flex items-center gap-1.5">
                {/* 공통 서술 라이브러리 — 추가형: 기존 기록 유지 + 템플릿 행 append, 일자는 빈 값 (소방계획서_15_별도라이브러리 §4-1) */}
                <LibraryTextButton def={PLAN_TEXT_SECTIONS[card.key]}
                  extract={() => logs[card.key]}
                  onApply={(body, meta) => {
                    setLogs(p => ({ ...p, [card.key]: PLAN_TEXT_SECTIONS[card.key].merge(p[card.key], body) as LogRow[] }))
                    setDirty(true)
                    setLibMetas(p => ({ ...p, [card.key]: meta }))
                  }} />
                <button onClick={() => addRow(card)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
                  <Plus className="size-3" /> 기록 추가
                </button>
              </span>
            )}
          </div>
          {logs[card.key].length === 0 && (
            <p className="text-[11px] text-ink-faint">기록이 없습니다 — 발생 시 행을 추가해 기록하세요 (2년 보관 대상).</p>
          )}
          <div className="space-y-1.5">
            {logs[card.key].map((row, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                {card.cols.map(col => col.k === 'date' ? (
                  <DateInput key={col.k} value={row[col.k] ?? ''} disabled={!canManage} title={`${col.label} — YYYY-MM-DD (달력 버튼으로 선택 가능)`}
                    onChange={e => setCell(card.key, i, col.k, e.target.value)} className={`${inputCls} ${col.w}`} />
                ) : (
                  <input key={col.k} value={row[col.k] ?? ''} disabled={!canManage} placeholder={col.label}
                    onChange={e => setCell(card.key, i, col.k, e.target.value)} className={`${inputCls} ${col.w}`} />
                ))}
                {canManage && (
                  <button onClick={() => delRow(card.key, i)} className="text-ink-faint hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.12~1.15 저장
          </button>
          {msg && <span className="text-xs text-ink-sub">{msg}</span>}
        </div>
      )}
      <p className="text-[11px] text-ink-faint">※ 기록은 계획서 생성(HWP) 시 해당 서식 표에 병합됩니다 — 1.12는 13행·1.13은 11행·1.14는 2건까지, 1.15는 양식이 단일 사건 서식이라 첫 행(일자·피해 내용·복구 조치)만 반영됩니다.</p>
    </div>
  )
}
