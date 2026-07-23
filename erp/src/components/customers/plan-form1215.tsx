'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { useUnsavedWarning } from '@/components/ui/fields'

/** 서식 1.12~1.15 기록부 4종 (소방계획서_4.md §3 — §12-3 결정 2026-07-23: v1 포함)
 *  1.12 화기취급 감독 · 1.13 소방시설 공사/정비 기록 · 1.14 화재예방 및 홍보 · 1.15 피해 복구
 *  공통 = 일자 + 텍스트 열 행 기록 (섹션 카드 세로 배치, 저장 버튼 1개 — §1-2) */

export type LogRow = Record<string, string>

type CardDef = { key: string; title: string; cols: Array<{ k: string; label: string; w: string }> }
const CARDS: CardDef[] = [
  {
    key: 'fireworkLog', title: '1.12 화기취급 감독',
    cols: [
      { k: 'date', label: '일자', w: 'w-28' }, { k: 'place', label: '작업 장소', w: 'w-32' },
      { k: 'work', label: '작업 내용', w: 'flex-1 min-w-40' }, { k: 'supervisor', label: '감독자', w: 'w-24' },
      { k: 'measure', label: '안전조치', w: 'w-40' },
    ],
  },
  {
    key: 'constructionLog', title: '1.13 소방시설 공사·정비 기록',
    cols: [
      { k: 'date', label: '일자', w: 'w-28' }, { k: 'facility', label: '대상 설비', w: 'w-32' },
      { k: 'content', label: '공사·정비 내용', w: 'flex-1 min-w-40' }, { k: 'company', label: '시공업체', w: 'w-28' },
      { k: 'note', label: '비고', w: 'w-28' },
    ],
  },
  {
    key: 'promoLog', title: '1.14 화재예방 및 홍보',
    cols: [
      { k: 'date', label: '일자', w: 'w-28' }, { k: 'method', label: '방법(게시·방송·교육 등)', w: 'w-40' },
      { k: 'content', label: '내용', w: 'flex-1 min-w-40' }, { k: 'target', label: '대상', w: 'w-28' },
    ],
  },
  {
    key: 'recoveryLog', title: '1.15 피해 복구',
    cols: [
      { k: 'date', label: '일자', w: 'w-28' }, { k: 'damage', label: '피해 내용', w: 'flex-1 min-w-40' },
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
  useUnsavedWarning(dirty) // §11-4 이탈 경고
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

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
  function save() {
    startTransition(async () => {
      const patch = Object.fromEntries(CARDS.map(c => [
        c.key, logs[c.key].filter(r => Object.values(r).some(v => v.trim())),
      ]))
      const res = await saveFirePlanSectionsAction(customerId, patch)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.12~1.15 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'

  return (
    <div className="space-y-4">
      {CARDS.map(card => (
        <div key={card.key} className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-semibold text-[#514b81]">{card.title}</p>
            {canManage && (
              <button onClick={() => addRow(card)}
                className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                <Plus className="size-3" /> 기록 추가
              </button>
            )}
          </div>
          {logs[card.key].length === 0 && (
            <p className="text-[11px] text-[#b0acd6]">기록이 없습니다 — 발생 시 행을 추가해 기록하세요 (2년 보관 대상).</p>
          )}
          <div className="space-y-1.5">
            {logs[card.key].map((row, i) => (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                {card.cols.map(col => (
                  <input key={col.k} value={row[col.k] ?? ''} disabled={!canManage} placeholder={col.label}
                    onChange={e => setCell(card.key, i, col.k, e.target.value)} className={`${inputCls} ${col.w}`} />
                ))}
                {canManage && (
                  <button onClick={() => delRow(card.key, i)} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.12~1.15 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
      <p className="text-[11px] text-[#b0acd6]">※ 기록은 계획서 생성(HWP) 시 해당 서식 표에 병합됩니다 — 1.12는 13행·1.13은 11행·1.14는 2건까지, 1.15는 양식이 단일 사건 서식이라 첫 행(일자·피해 내용·복구 조치)만 반영됩니다.</p>
    </div>
  )
}
