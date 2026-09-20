'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { CardAnchorBar, MonthField, useUnsavedWarning } from '@/components/ui/fields'
import { DateInput } from '@/components/ui/date-input'

/** 서식 1.10 소방안전관리자 자체점검 및 업무 수행 — 섹션 카드 3개 (소방계획서_4.md §3)
 *  1.10.1 연간 점검 계획(sections.inspection — 종합 블록은 종합 고객만, §9-8 필드 조건부)
 *  1.10.2 업무수행 기록(sections.dutyLog — §12-1 결정 2026-07-23: ERP 입력 관리)
 *  1.10.4 화재/비화재보 이력(sections.fireHistory)
 *
 *  ⚠ 「전년도 업무 실시사항」(sections.annexStatus)은 2026-09-20부터 **[보고서] 탭**에 있다 —
 *    별지 9호 2쪽에만 인쇄되고 계획서 워크북에 안 실리는 값이라 3분리 기준(별지만=보고서)을 따랐다.
 *    카드 본체: components/customers/plan-annex-status-card.tsx. 여기 save()는 annexStatus를
 *    싣지 않는다(부분 업데이트라 키를 빼면 기존 값이 그대로 산다 — multiUse와 같은 규약).
 *
 *  ⚠ 1.10.3 다중이용업소는 2026-09-09부터 **서식 1.4 「기타」 아래**에 있다(소방계획서_43 S7 B안).
 *    그 절이 곧 별지 9호 「안전시설등」 설비 구분의 설치 축이라 판정 구조에 입력 자리를 맞춘 것이다.
 *    저장은 여전히 sections.multiUse지만, 카드가 자기 저장을 갖고 있어 여기 save()는 싣지 않는다
 *    (부분 업데이트라 키를 빼면 기존 값이 그대로 산다) — components/customers/plan-multi-use-card.tsx */

export type InspectionPlanSection = {
  opMonth: string; opInspector: '자체' | '외주' | ''
  isInitial: boolean; initialMonth: string
  compMonth: string; comp2Month: string; compInspector: '자체' | '외주' | ''
}
export type FireHistoryRow = { kind: '화재' | '비화재보'; at: string; place: string; cause: string; action: string }
/** 1.10.2 업무수행 기록 행 (§12-1 — ERP 입력 관리) */
export type DutyLogRow = { date: string; content: string; action: string; note: string }

/** 1.10.4 발생일시 — 저장은 지금까지처럼 단일 문자열('YYYY-MM-DD HH:MM', 시각 생략 시 날짜만).
 *  입력만 달력·시각 두 칸으로 나누므로 스키마·병합 템플릿(1.10.4 표 '일시' 칸)은 그대로다.
 *  형식을 벗어난 값(레거시 자유 텍스트)은 날짜 칸에 원문을 그대로 두어 보존한다. */
const AT_RE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?$/
function splitAt(at: string): [date: string, time: string] {
  const m = at.trim().match(AT_RE)
  return m ? [m[1], m[2] ?? ''] : [at, '']
}
function joinAt(date: string, time: string): string {
  const d = date.trim(), t = time.trim()
  return d && t ? `${d} ${t}` : d || t
}

export const EMPTY_INSPECTION: InspectionPlanSection = {
  opMonth: '', opInspector: '외주', isInitial: false, initialMonth: '', compMonth: '', comp2Month: '', compInspector: '외주',
}
export function PlanForm110({ customerId, canManage, isComprehensive, autoOpMonth, autoCompMonth, useApprovalDate, fireStation, initialInspection, initialHistory, initialDutyLog = [] }: {
  customerId: string
  canManage: boolean
  isComprehensive: boolean          // 종합 고객만 종합점검 블록 표시 (§9-8)
  autoOpMonth: string               // 점검계획일 기반 자동값 (수정 가능)
  autoCompMonth: string
  useApprovalDate: string
  fireStation: string
  initialInspection: InspectionPlanSection | null
  initialHistory: FireHistoryRow[]
  initialDutyLog?: DutyLogRow[]
}) {
  const router = useRouter()
  const [insp, setInsp] = useState<InspectionPlanSection>(initialInspection ?? {
    ...EMPTY_INSPECTION, opMonth: autoOpMonth, compMonth: isComprehensive ? autoCompMonth : '',
  })
  const [hist, setHist] = useState<FireHistoryRow[]>(initialHistory)
  const [duty, setDuty] = useState<DutyLogRow[]>(initialDutyLog)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function pi(p: Partial<InspectionPlanSection>) { setInsp(v => ({ ...v, ...p })); setDirty(true) }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          // multiUse·annexStatus는 여기서 싣지 않는다 — 각자 자기 저장을 갖는 카드로 이사했다
          // (1.4 PlanMultiUseCard · [보고서] 탭 PlanAnnexStatusCard). 부분 업데이트라
          // 키를 빼면 기존 값이 그대로 산다(fire-plan-form-actions.ts:74).
          inspection: insp,
          fireHistory: hist.filter(h => h.at.trim() || h.place.trim() || h.cause.trim()),
          dutyLog: duty.filter(d => d.date.trim() || d.content.trim()),
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.10 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-form-7 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand'
  const chip = (on: boolean) => `h-form-6 px-2 rounded-full text-form-xs border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  const inspectorSeg = (v: '자체' | '외주' | '', on: (nv: '자체' | '외주') => void) => (
    <span className="inline-flex gap-1">
      {(['자체', '외주'] as const).map(o => (
        <button key={o} disabled={!canManage} className={chip(v === o)} onClick={() => on(o)}>{o}</button>
      ))}
    </span>
  )

  return (
    <div className="space-y-4">
      {/* §1-2 카드 앵커 점프 — 「전년도 실시사항」은 [보고서] 탭으로 이사(2026-09-20 3분리) */}
      <CardAnchorBar items={[
        { id: 'c-1.10.1', label: '1.10.1 연간 계획' },
        { id: 'c-1.10.2', label: '1.10.2 업무수행 기록' },
        { id: 'c-1.10.4', label: '1.10.4 화재 이력' },
      ]} />
      {/* 1.10.1 연간 점검 계획 */}
      <div id="c-1.10.1" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <p className="text-form-sm font-semibold text-ink-sub">1.10.1 연간 자체점검 계획
          <span className="font-normal text-ink-meta ml-2">시기는 점검일자 기준 자동 — 수정 가능</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-form-xs font-medium text-ink-sub w-16">작동점검</span>
          <MonthField value={insp.opMonth} disabled={!canManage} onChange={opMonth => pi({ opMonth })} className={`${inputCls} w-36`} />
          <span className="text-form-xs text-ink-sub">점검자</span>
          {inspectorSeg(insp.opInspector, v => pi({ opInspector: v }))}
        </div>
        {isComprehensive && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-form-xs font-medium text-ink-sub w-16">종합점검</span>
              <button disabled={!canManage} className={chip(insp.isInitial)} onClick={() => pi({ isInitial: !insp.isInitial })}>최초점검</button>
              {insp.isInitial && (
                <span className="inline-flex items-center gap-1"><span className="text-form-2xs text-ink-meta">최초</span>
                  <MonthField value={insp.initialMonth} disabled={!canManage} onChange={initialMonth => pi({ initialMonth })} className={`${inputCls} w-36`} /></span>
              )}
              <span className="inline-flex items-center gap-1"><span className="text-form-2xs text-ink-meta">종합</span>
                <MonthField value={insp.compMonth} disabled={!canManage} onChange={compMonth => pi({ compMonth })} className={`${inputCls} w-36`} /></span>
              <span className="inline-flex items-center gap-1"><span className="text-form-2xs text-ink-meta">2차(특급)</span>
                <MonthField value={insp.comp2Month} disabled={!canManage} onChange={comp2Month => pi({ comp2Month })} className={`${inputCls} w-36`} /></span>
              <span className="text-form-xs text-ink-sub">점검자</span>
              {inspectorSeg(insp.compInspector, v => pi({ compInspector: v }))}
            </div>
          </>
        )}
        <p className="text-form-xs text-ink-meta">사용승인일 {useApprovalDate || '—'} · 제출처 {fireStation ? `${fireStation}장` : '관할 소방서장'} (자동)</p>
      </div>

      {/* 「전년도 업무 실시사항」(sections.annexStatus)은 [보고서] 탭으로 이사 (2026-09-20 3분리 —
          별지 9호 2쪽 전용 값이라 별지-전용 입력 탭이 소유한다). plan-annex-status-card.tsx */}

      {/* 1.10.2 업무수행 기록 (§12-1 결정: ERP 입력 관리) */}
      <div id="c-1.10.2" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-form-sm font-semibold text-ink-sub">1.10.2 소방안전관리자 업무수행 기록</p>
          {canManage && (
            <button onClick={() => { setDuty(p => [...p, { date: '', content: '', action: '', note: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
              <Plus className="size-3" /> 기록 추가
            </button>
          )}
        </div>
        {duty.length === 0 && <p className="text-form-xs text-ink-meta">수행 일자·업무 내용·조치사항을 기록하세요 — 업무수행 기록표는 계획서와 별도 보관 서류(2년)라 HWP에는 병합되지 않고 ERP에 기록·보관됩니다.</p>}
        <div className="space-y-1.5">
          {duty.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <DateInput value={d.date} disabled={!canManage} title="수행 일자 — YYYY-MM-DD (달력 버튼으로 선택 가능)"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, date: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-36`} />
              <input value={d.content} disabled={!canManage} placeholder="수행 업무 내용"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, content: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-48`} />
              <input value={d.action} disabled={!canManage} placeholder="조치사항"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, action: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-44`} />
              <input value={d.note} disabled={!canManage} placeholder="비고"
                onChange={e => { setDuty(p => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-28`} />
              {canManage && (
                <button onClick={() => { setDuty(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-ink-meta hover:text-red-500" aria-label="행 삭제"><Trash2 className="size-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 1.10.3 다중이용업소 — 서식 1.4 「기타」 아래로 옮겼다 (소방계획서_43 S7, 2026-09-09).
          입력 자리만 옮긴 것이고 절 번호·저장소(sections.multiUse)·인쇄물은 그대로다.
          카드 본체: components/customers/plan-multi-use-card.tsx */}

      {/* 1.10.4 화재/비화재보 이력 */}
      <div id="c-1.10.4" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-form-sm font-semibold text-ink-sub">1.10.4 화재·비화재보 발생 이력</p>
          {canManage && (
            <button onClick={() => { setHist(p => [...p, { kind: '비화재보', at: '', place: '', cause: '', action: '' }]); setDirty(true) }}
              className="ml-auto inline-flex items-center gap-1 h-form-7 px-2 rounded-lg border border-brand-line text-form-xs text-brand hover:bg-brand-tint">
              <Plus className="size-3" /> 행 추가
            </button>
          )}
        </div>
        {hist.length === 0 && <p className="text-form-xs text-ink-meta">발생 이력이 없으면 비워둡니다.</p>}
        <div className="space-y-1.5">
          {hist.map((h, i) => {
            const [atDate, atTime] = splitAt(h.at)
            const setAt = (v: string) => { setHist(p => p.map((x, j) => j === i ? { ...x, at: v } : x)); setDirty(true) }
            return (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <select value={h.kind} disabled={!canManage}
                onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, kind: e.target.value as FireHistoryRow['kind'] } : x)); setDirty(true) }}
                className="h-form-7 rounded border border-brand-line bg-surface px-1 text-form-sm outline-none">
                <option value="화재">화재</option>
                <option value="비화재보">비화재보</option>
              </select>
              <DateInput value={atDate} disabled={!canManage} title="발생 일자 — YYYY-MM-DD (달력 버튼으로 선택 가능)"
                onChange={e => setAt(joinAt(e.target.value, atTime))} className={`${inputCls} w-36`} />
              <input type="time" value={atTime} disabled={!canManage} aria-label="발생 시각" title="발생 시각 (선택 — 비워두면 날짜만 기록)"
                onChange={e => setAt(joinAt(atDate, e.target.value))} className={`${inputCls} w-24`} />
              <input value={h.place} disabled={!canManage} placeholder="장소" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, place: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-28`} />
              <input value={h.cause} disabled={!canManage} placeholder="원인" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, cause: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-28`} />
              <input value={h.action} disabled={!canManage} placeholder="조치사항" onChange={e => { setHist(p => p.map((x, j) => j === i ? { ...x, action: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-28`} />
              {canManage && (
                <button onClick={() => { setHist(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-ink-meta hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )})}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.10 저장
          </button>
          {msg && <span className="text-form-sm text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
