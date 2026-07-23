'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { MULTI_USE_CATEGORIES } from '@/lib/doc-requirements'
import { CardAnchorBar, MonthField, useUnsavedWarning } from '@/components/ui/fields'

/** 서식 1.10 소방안전관리자 자체점검 및 업무 수행 — 섹션 카드 4개 (소방계획서_4.md §3)
 *  1.10.1 연간 점검 계획(sections.inspection — 종합 블록은 종합 고객만, §9-8 필드 조건부)
 *  1.10.2 업무수행 기록(sections.dutyLog — §12-1 결정 2026-07-23: ERP 입력 관리)
 *  1.10.3 다중이용업소(sections.multiUse — 업종은 별지 9호 28종 선택형, §9-6④)
 *  1.10.4 화재/비화재보 이력(sections.fireHistory) */

export type InspectionPlanSection = {
  opMonth: string; opInspector: '자체' | '외주' | ''
  isInitial: boolean; initialMonth: string
  compMonth: string; comp2Month: string; compInspector: '자체' | '외주' | ''
}
export type MultiUseSection = {
  applicable: boolean
  categories: Record<string, string> // 업종 → 개소
  bizName: string; location: string; owner: string; phone: string
  hours: string; users: string; capacity: string
}
export type FireHistoryRow = { kind: '화재' | '비화재보'; at: string; place: string; cause: string; action: string }
/** 1.10.2 업무수행 기록 행 (§12-1 — ERP 입력 관리) */
export type DutyLogRow = { date: string; content: string; action: string; note: string }

export const EMPTY_INSPECTION: InspectionPlanSection = {
  opMonth: '', opInspector: '외주', isInitial: false, initialMonth: '', compMonth: '', comp2Month: '', compInspector: '외주',
}
export const EMPTY_MULTI_USE: MultiUseSection = {
  applicable: false, categories: {}, bizName: '', location: '', owner: '', phone: '', hours: '', users: '', capacity: '',
}

export function PlanForm110({ customerId, canManage, isComprehensive, autoOpMonth, autoCompMonth, useApprovalDate, fireStation, initialInspection, initialMultiUse, initialHistory, initialDutyLog = [] }: {
  customerId: string
  canManage: boolean
  isComprehensive: boolean          // 종합 고객만 종합점검 블록 표시 (§9-8)
  autoOpMonth: string               // 점검계획일 기반 자동값 (수정 가능)
  autoCompMonth: string
  useApprovalDate: string
  fireStation: string
  initialInspection: InspectionPlanSection | null
  initialMultiUse: MultiUseSection | null
  initialHistory: FireHistoryRow[]
  initialDutyLog?: DutyLogRow[]
}) {
  const router = useRouter()
  const [insp, setInsp] = useState<InspectionPlanSection>(initialInspection ?? {
    ...EMPTY_INSPECTION, opMonth: autoOpMonth, compMonth: isComprehensive ? autoCompMonth : '',
  })
  const [mu, setMu] = useState<MultiUseSection>(initialMultiUse ?? EMPTY_MULTI_USE)
  const [hist, setHist] = useState<FireHistoryRow[]>(initialHistory)
  const [duty, setDuty] = useState<DutyLogRow[]>(initialDutyLog)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty) // §11-4 이탈 경고
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function pi(p: Partial<InspectionPlanSection>) { setInsp(v => ({ ...v, ...p })); setDirty(true) }
  function pm(p: Partial<MultiUseSection>) { setMu(v => ({ ...v, ...p })); setDirty(true) }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        inspection: insp, multiUse: mu,
        fireHistory: hist.filter(h => h.at.trim() || h.place.trim() || h.cause.trim()),
        dutyLog: duty.filter(d => d.date.trim() || d.content.trim()),
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.10 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const chip = (on: boolean) => `h-6 px-2 rounded-full text-[11px] border transition-colors ${
    on ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`
  const inspectorSeg = (v: '자체' | '외주' | '', on: (nv: '자체' | '외주') => void) => (
    <span className="inline-flex gap-1">
      {(['자체', '외주'] as const).map(o => (
        <button key={o} disabled={!canManage} className={chip(v === o)} onClick={() => on(o)}>{o}</button>
      ))}
    </span>
  )

  return (
    <div className="space-y-4">
      {/* §1-2 카드 앵커 점프 */}
      <CardAnchorBar items={[
        { id: 'c-1.10.1', label: '1.10.1 연간 계획' }, { id: 'c-1.10.2', label: '1.10.2 업무수행 기록' },
        { id: 'c-1.10.3', label: '1.10.3 다중이용업소' }, { id: 'c-1.10.4', label: '1.10.4 화재 이력' },
      ]} />
      {/* 1.10.1 연간 점검 계획 */}
      <div id="c-1.10.1" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <p className="text-xs font-semibold text-[#514b81]">1.10.1 연간 자체점검 계획
          <span className="font-normal text-[#b0acd6] ml-2">시기는 점검계획일 기준 자동 — 수정 가능</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[#514b81] w-16">작동점검</span>
          <MonthField value={insp.opMonth} disabled={!canManage} onChange={opMonth => pi({ opMonth })} className={`${inputCls} w-36`} />
          <span className="text-[11px] text-[#514b81]">점검자</span>
          {inspectorSeg(insp.opInspector, v => pi({ opInspector: v }))}
        </div>
        {isComprehensive && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-medium text-[#514b81] w-16">종합점검</span>
              <button disabled={!canManage} className={chip(insp.isInitial)} onClick={() => pi({ isInitial: !insp.isInitial })}>최초점검</button>
              {insp.isInitial && (
                <span className="inline-flex items-center gap-1"><span className="text-[10px] text-[#b0acd6]">최초</span>
                  <MonthField value={insp.initialMonth} disabled={!canManage} onChange={initialMonth => pi({ initialMonth })} className={`${inputCls} w-36`} /></span>
              )}
              <span className="inline-flex items-center gap-1"><span className="text-[10px] text-[#b0acd6]">종합</span>
                <MonthField value={insp.compMonth} disabled={!canManage} onChange={compMonth => pi({ compMonth })} className={`${inputCls} w-36`} /></span>
              <span className="inline-flex items-center gap-1"><span className="text-[10px] text-[#b0acd6]">2차(특급)</span>
                <MonthField value={insp.comp2Month} disabled={!canManage} onChange={comp2Month => pi({ comp2Month })} className={`${inputCls} w-36`} /></span>
              <span className="text-[11px] text-[#514b81]">점검자</span>
              {inspectorSeg(insp.compInspector, v => pi({ compInspector: v }))}
            </div>
          </>
        )}
        <p className="text-[11px] text-[#b0acd6]">사용승인일 {useApprovalDate || '—'} · 제출처 {fireStation ? `${fireStation}장` : '관할 소방서장'} (자동)</p>
      </div>

      {/* 1.10.2 업무수행 기록 (§12-1 결정: ERP 입력 관리) */}
      <div id="c-1.10.2" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">1.10.2 소방안전관리자 업무수행 기록</p>
          {canManage && (
            <button onClick={() => { setDuty(p => [...p, { date: '', content: '', action: '', note: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Plus className="size-3" /> 기록 추가
            </button>
          )}
        </div>
        {duty.length === 0 && <p className="text-[11px] text-[#b0acd6]">수행 일자·업무 내용·조치사항을 기록하세요 — 업무수행 기록표는 계획서와 별도 보관 서류(2년)라 HWP에는 병합되지 않고 ERP에 기록·보관됩니다.</p>}
        <div className="space-y-1.5">
          {duty.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={d.date} disabled={!canManage} placeholder="일자 (YYYY-MM-DD)"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-32`} />
              <input value={d.content} disabled={!canManage} placeholder="수행 업무 내용"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, content: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-48`} />
              <input value={d.action} disabled={!canManage} placeholder="조치사항"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, action: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-44`} />
              <input value={d.note} disabled={!canManage} placeholder="비고"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-28`} />
              {canManage && (
                <button onClick={() => { setDuty(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 1.10.3 다중이용업소 */}
      <div id="c-1.10.3" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#514b81]">1.10.3 다중이용업소 현황</p>
          <button disabled={!canManage} className={chip(mu.applicable)} onClick={() => pm({ applicable: !mu.applicable })}>
            {mu.applicable ? '해당' : '해당없음'}
          </button>
        </div>
        {mu.applicable && (
          <>
            <div className="flex items-center gap-1 flex-wrap">
              {MULTI_USE_CATEGORIES.map(cat => {
                const on = mu.categories[cat] !== undefined
                return (
                  <span key={cat} className="inline-flex items-center gap-0.5">
                    <button disabled={!canManage} className={chip(on)}
                      onClick={() => {
                        const next = { ...mu.categories }
                        if (on) delete next[cat]
                        else next[cat] = '1'
                        pm({ categories: next })
                      }}>
                      {cat}
                    </button>
                    {on && (
                      <input value={mu.categories[cat]} disabled={!canManage} inputMode="numeric"
                        onChange={e => pm({ categories: { ...mu.categories, [cat]: e.target.value } })}
                        className={`${inputCls} w-10`} title="개소" />
                    )}
                  </span>
                )
              })}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={mu.bizName} disabled={!canManage} placeholder="사업장명" onChange={e => pm({ bizName: e.target.value })} className={`${inputCls} w-32`} />
              <input value={mu.location} disabled={!canManage} placeholder="위치" onChange={e => pm({ location: e.target.value })} className={`${inputCls} w-28`} />
              <input value={mu.owner} disabled={!canManage} placeholder="영업주" onChange={e => pm({ owner: e.target.value })} className={`${inputCls} w-24`} />
              <input value={mu.phone} disabled={!canManage} placeholder="연락처" onChange={e => pm({ phone: e.target.value })} className={`${inputCls} w-28`} />
              <input value={mu.hours} disabled={!canManage} placeholder="영업시간 (평일/휴일·주간/야간)" onChange={e => pm({ hours: e.target.value })} className={`${inputCls} w-52`} />
              <input value={mu.users} disabled={!canManage} placeholder="이용자 유형" onChange={e => pm({ users: e.target.value })} className={`${inputCls} w-28`} />
              <input value={mu.capacity} disabled={!canManage} inputMode="numeric" placeholder="수용인원" onChange={e => pm({ capacity: e.target.value })} className={`${inputCls} w-20`} />
            </div>
          </>
        )}
      </div>

      {/* 1.10.4 화재/비화재보 이력 */}
      <div id="c-1.10.4" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">1.10.4 화재·비화재보 발생 이력</p>
          {canManage && (
            <button onClick={() => { setHist(p => [...p, { kind: '비화재보', at: '', place: '', cause: '', action: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Plus className="size-3" /> 행 추가
            </button>
          )}
        </div>
        {hist.length === 0 && <p className="text-[11px] text-[#b0acd6]">발생 이력이 없으면 비워둡니다.</p>}
        <div className="space-y-1.5">
          {hist.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <select value={h.kind} disabled={!canManage}
                onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, kind: e.target.value as FireHistoryRow['kind'] } : x)); setDirty(true) }}
                className="h-7 rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none">
                <option value="화재">화재</option>
                <option value="비화재보">비화재보</option>
              </select>
              <input value={h.at} disabled={!canManage} placeholder="발생일시" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, at: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-32`} />
              <input value={h.place} disabled={!canManage} placeholder="장소" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, place: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-28`} />
              <input value={h.cause} disabled={!canManage} placeholder="원인" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, cause: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-28`} />
              <input value={h.action} disabled={!canManage} placeholder="조치사항" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, action: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-28`} />
              {canManage && (
                <button onClick={() => { setHist(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.10 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
