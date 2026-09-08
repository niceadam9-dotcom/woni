'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2, ExternalLink } from 'lucide-react'
import { saveFirePlanSectionsAction, getPrevYearDutyAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { annexStatusMarks, type AnnexStatusSection, type DutyMark, type PlanStoredMark, type PlanWrittenMark, type PrevYearDutyAuto } from '@/lib/prev-year-duty'
import { MULTI_USE_CATEGORIES } from '@/lib/doc-requirements'
import { CardAnchorBar, MonthField, NumStepper, formatPhoneKR, useUnsavedWarning } from '@/components/ui/fields'
import { DateInput } from '@/components/ui/date-input'

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
/** M-16(소방계획서_15, 2026-08-11 보강): 이용자 유형 4종 — 설계 4.md §3-8 */
export const MULTI_USE_USER_TYPES = ['노유자', '주취자', '청소년', '신체부자유자'] as const
export type MultiUseSection = {
  applicable: boolean
  categories: Record<string, string> // 업종 → 개소
  bizName: string; location: string; owner: string; phone: string
  hours: string; users: string; capacity: string
  /** M-16: 영업시간 세분(평일/휴일 × 주간/야간, 예 '09:00~18:00') — hours(자유 텍스트)는 레거시 폴백 */
  hoursDetail?: { wkDay: string; wkNight: string; holDay: string; holNight: string }
  /** M-16: 이용자 유형 체크 — users(자유 텍스트)는 레거시 병기 */
  userTypes?: string[]
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
  // 소방계획서_44 — 별지 9호 2쪽 3행의 확정값. 로드 전(null)에는 저장 패치에 싣지 않는다:
  // 빈 값을 실으면 아직 못 읽은 기존 확정을 덮어쓴다.
  const [annex, setAnnex] = useState<AnnexStatusSection | null>(null)
  const [dutyAuto, setDutyAuto] = useState<PrevYearDutyAuto | null>(null)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let alive = true
    getPrevYearDutyAction(customerId).then(r => {
      if (!alive || r.error) return
      setAnnex(r.status ?? {})
      setDutyAuto(r.auto)
    })
    return () => { alive = false }
  }, [customerId])

  function pi(p: Partial<InspectionPlanSection>) { setInsp(v => ({ ...v, ...p })); setDirty(true) }
  function pm(p: Partial<MultiUseSection>) { setMu(v => ({ ...v, ...p })); setDirty(true) }
  /** 전년도 실적 확정 — 같은 칩을 다시 누르면 ''(자동 판정에 맡김)으로 돌아간다.
   *  ⚠ 연도 키 없음(D-6): 확정은 **한 벌**이고 어느 회차를 찍든 그대로 적용된다.
   *    구본이 연도 맵으로 저장돼 있으면 annexStatusMarks가 최신 연도를 흡수해 오므로,
   *    여기서 평평한 객체로 덮어쓰는 순간 구조도 함께 정리된다. */
  function pd(key: 'edu' | 'drill' | 'op' | 'comp', v: DutyMark) {
    setAnnex(prev => ({ ...(prev ?? {}), prevYear: { ...annexStatusMarks(prev), [key]: v } }))
    setDirty(true)
  }
  function pp(p: { written?: PlanWrittenMark; stored?: PlanStoredMark }) {
    setAnnex(prev => {
      const base = prev ?? {}
      const plan = { ...(base.plan ?? {}), ...p }
      // 미작성이면 보관 칸 자체가 성립하지 않는다 — 화면에서도 값을 끊는다(조립기와 같은 규칙)
      if (plan.written === '미작성') plan.stored = ''
      return { ...base, plan }
    })
    setDirty(true)
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          inspection: insp, multiUse: mu,
          fireHistory: hist.filter(h => h.at.trim() || h.place.trim() || h.cause.trim()),
          dutyLog: duty.filter(d => d.date.trim() || d.content.trim()),
          // 아직 못 읽었으면 아예 보내지 않는다 — 부분 업데이트라 키를 빼면 기존 값이 그대로 산다
          ...(annex ? { annexStatus: annex } : {}),
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

  /** 전년도 실적 체크쌍 — 별지 9호 패널의 mark2 규약 그대로: 둘 다 해제 = 자동 판정에 맡김 */
  const markPair = (
    label: string, value: string, yes: string, no: string,
    onPick: (v: string) => void, autoText: string, disabled = false,
  ) => (
    // role=group + aria-pressed는 별지 9호 mark2 칸이 쓰던 규약 그대로다 — 확정 자리가 옮겨져도
    // '무엇이 눌려 있는가'를 읽는 방법은 같아야 한다(스크린리더·E2E 양쪽).
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={label}>
      <span className="text-form-xs font-medium text-ink-sub w-24">{label}</span>
      <button disabled={!canManage || disabled} className={chip(value === yes)}
        aria-pressed={value === yes} onClick={() => onPick(value === yes ? '' : yes)}>{yes}</button>
      <button disabled={!canManage || disabled} className={chip(value === no)}
        aria-pressed={value === no} onClick={() => onPick(value === no ? '' : no)}>{no}</button>
      <span className="text-form-2xs text-ink-meta">{disabled ? '미작성 — 보관 칸은 성립하지 않습니다' : autoText}</span>
    </div>
  )
  /** 자동 판정은 부정을 단정하지 않는다 — 실적이 없으면 「미실시」가 아니라 양쪽 공란이다 */
  const autoText = (on: boolean, yes: string, src: string) =>
    on ? `자동 판정: ${yes} (${src})` : `자동 판정 없음 — 고르지 않으면 양쪽 공란으로 인쇄`
  const dy = annexStatusMarks(annex)

  return (
    <div className="space-y-4">
      {/* §1-2 카드 앵커 점프 */}
      <CardAnchorBar items={[
        { id: 'c-1.10.1', label: '1.10.1 연간 계획' }, { id: 'c-1.10-prev', label: '전년도 실시사항' },
        { id: 'c-1.10.2', label: '1.10.2 업무수행 기록' },
        { id: 'c-1.10.3', label: '1.10.3 다중이용업소' }, { id: 'c-1.10.4', label: '1.10.4 화재 이력' },
      ]} />
      {/* 1.10.1 연간 점검 계획 */}
      <div id="c-1.10.1" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <p className="text-form-sm font-semibold text-ink-sub">1.10.1 연간 자체점검 계획
          <span className="font-normal text-ink-meta ml-2">시기는 점검계획일 기준 자동 — 수정 가능</span>
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

      {/* 전년도 업무 실시사항 — 별지 9호 2쪽 3행의 확정 자리 (소방계획서_44 S2)
          서식 9쪽 작성방법 8호가 「소방계획서·자체점검(전년도)·교육훈련(전년도)」을 한 묶음
          ('소방안전관리업무 실시사항')으로 규정하므로 한 블록에 둔다. 종전 자리는 점검 건의
          별지 9호 작성 패널이었다 — 값에 연도가 없어 전 회차 이어받기가 작년 실적을 올해 칸에
          실을 수 있었다(그 이어받기는 44에서 소멸).
          ⚠ 확정값에는 연도가 없다(D-6) — 소방계획서는 살아 있는 한 벌이고 표지 연도는 사람이 고른다.
            ERP는 연도를 고르지도 저장하지도 않고 최신 확정만 유지한다. dutyAuto.year는 **자동 판정의
            기준 연도**일 뿐 저장 축이 아니다. */}
      <div id="c-1.10-prev" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <p className="text-form-sm font-semibold text-ink-sub">
          전년도 업무 실시사항
          <span className="font-normal text-ink-meta ml-2">
            별지 9호 2쪽·갑지 「정보」 시트에 그대로 인쇄됩니다 — 자동 판정과 다를 때만 고르세요
          </span>
        </p>
        {!dutyAuto ? (
          <p className="text-form-xs text-ink-meta inline-flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> 자동 판정 불러오는 중…
          </p>
        ) : (
          <div className="space-y-1.5">
            {markPair('소방계획서 작성', annex?.plan?.written ?? '', '작성', '미작성',
              v => pp({ written: v as PlanWrittenMark }),
              autoText(dutyAuto.hasPlan, '작성', '소방계획서 서식 입력 있음'))}
            {markPair('소방계획서 보관', annex?.plan?.stored ?? '', '보관', '미보관',
              v => pp({ stored: v as PlanStoredMark }),
              // 「보관」에는 자동 원천이 없다(현장 비치 여부를 ERP가 알 수 없다) — Q-4
              '자동 판정 없음(원천 없음) — 고르지 않으면 양쪽 공란으로 인쇄',
              (annex?.plan?.written ?? '') === '미작성')}
            <div className="border-t border-dashed border-brand-line-soft pt-1.5 space-y-1.5">
              {markPair('자체점검 작동', dy.op ?? '', '실시', '미실시', v => pd('op', v as DutyMark),
                autoText(dutyAuto.opDone, '실시', `${dutyAuto.year}년 완료 점검 이력`))}
              {markPair('자체점검 종합', dy.comp ?? '', '실시', '미실시', v => pd('comp', v as DutyMark),
                autoText(dutyAuto.compDone, '실시', `${dutyAuto.year}년 완료 점검 이력`))}
              <p className="text-form-2xs text-ink-meta">ERP 도입 전 이력(종이·타사)은 자동 판정에 잡히지 않습니다 — 그때만 고르세요.</p>
            </div>
            <div className="border-t border-dashed border-brand-line-soft pt-1.5 space-y-1.5">
              {markPair('소방안전교육', dy.edu ?? '', '실시', '미실시', v => pd('edu', v as DutyMark),
                autoText(dutyAuto.eduDone, '실시', '1.11.4 기록부'))}
              {markPair('소방훈련', dy.drill ?? '', '실시', '미실시', v => pd('drill', v as DutyMark),
                autoText(dutyAuto.drillDone, '실시', '1.11.4 기록부'))}
              {/* Q-2 — 실적의 원천은 1.11.4 기록부다. 여기서 '실시'만 찍고 기록을 안 남기면
                  1.11.4 배지와 어긋나므로 원천으로 가는 길을 함께 둔다.
                  ⚠ next/link가 아니라 <a>(전체 이동) — 같은 경로 soft nav는 서버를 재렌더하지 않아
                    ?form= 딥링크가 무시된다(소방계획서_34 S6-1). */}
              <p className="text-form-2xs text-ink-meta">
                실적의 원천은 1.11.4 결과 기록부입니다 —
                <a href={`/customers/${customerId}?tab=plan&form=1.11`}
                  className="text-brand hover:underline ml-1 inline-flex items-center gap-0.5">
                  1.11.4 기록부로 이동 <ExternalLink className="size-2.5" />
                </a>
              </p>
            </div>
            {/* 확정값에 연도가 없다는 사실을 화면이 말한다 — 연도를 안 밝히면 사용자가 "올해분만
                고쳤다"고 오해하고, 밝히기만 하고 편집 축이 없으면 그것대로 거짓말이 된다(D-6). */}
            <p className="text-form-2xs text-ink-meta">
              자동 판정 기준은 가장 최근 점검({dutyAuto.year + 1}년)의 전년도인 {dutyAuto.year}년 실적입니다.
              고른 값에는 연도가 없어 모든 회차의 별지 9호에 그대로 인쇄됩니다.
            </p>
          </div>
        )}
      </div>

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

      {/* 1.10.3 다중이용업소 */}
      <div id="c-1.10.3" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-form-sm font-semibold text-ink-sub">1.10.3 다중이용업소 현황</p>
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
                      <NumStepper value={mu.categories[cat]} disabled={!canManage} label={`${cat} 개소`}
                        onChange={v => pm({ categories: { ...mu.categories, [cat]: v } })}>
                        <input value={mu.categories[cat]} disabled={!canManage} inputMode="numeric"
                          onChange={e => pm({ categories: { ...mu.categories, [cat]: e.target.value } })}
                          className={`${inputCls} w-10`} title="개소" />
                      </NumStepper>
                    )}
                  </span>
                )
              })}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={mu.bizName} disabled={!canManage} placeholder="사업장명" onChange={e => pm({ bizName: e.target.value })} className={`${inputCls} w-32`} />
              <input value={mu.location} disabled={!canManage} placeholder="위치" onChange={e => pm({ location: e.target.value })} className={`${inputCls} w-28`} />
              <input value={mu.owner} disabled={!canManage} placeholder="영업주" onChange={e => pm({ owner: e.target.value })} className={`${inputCls} w-24`} />
              <input value={mu.phone} disabled={!canManage} inputMode="tel" placeholder="010-0000-0000" onChange={e => pm({ phone: formatPhoneKR(e.target.value) })} className={`${inputCls} w-28`} />
              <NumStepper value={mu.capacity} disabled={!canManage} label="수용인원" onChange={v => pm({ capacity: v })}>
                <input value={mu.capacity} disabled={!canManage} inputMode="numeric" placeholder="수용인원" onChange={e => pm({ capacity: e.target.value })} className={`${inputCls} w-20`} />
              </NumStepper>
            </div>
            {/* M-16(소방계획서_15, 2026-08-11 보강): 영업시간 평일/휴일 × 주간/야간 세분 — 자유 텍스트(hours)는 레거시 폴백 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-form-xs font-medium text-ink-sub">영업시간</span>
              <span className="text-form-2xs text-ink-meta">평일</span>
              <input value={mu.hoursDetail?.wkDay ?? ''} disabled={!canManage} placeholder="주간 09:00~18:00"
                onChange={e => pm({ hoursDetail: { wkDay: e.target.value, wkNight: mu.hoursDetail?.wkNight ?? '', holDay: mu.hoursDetail?.holDay ?? '', holNight: mu.hoursDetail?.holNight ?? '' } })} className={`${inputCls} w-36`} />
              <input value={mu.hoursDetail?.wkNight ?? ''} disabled={!canManage} placeholder="야간"
                onChange={e => pm({ hoursDetail: { wkDay: mu.hoursDetail?.wkDay ?? '', wkNight: e.target.value, holDay: mu.hoursDetail?.holDay ?? '', holNight: mu.hoursDetail?.holNight ?? '' } })} className={`${inputCls} w-32`} />
              <span className="text-form-2xs text-ink-meta">휴일</span>
              <input value={mu.hoursDetail?.holDay ?? ''} disabled={!canManage} placeholder="주간"
                onChange={e => pm({ hoursDetail: { wkDay: mu.hoursDetail?.wkDay ?? '', wkNight: mu.hoursDetail?.wkNight ?? '', holDay: e.target.value, holNight: mu.hoursDetail?.holNight ?? '' } })} className={`${inputCls} w-32`} />
              <input value={mu.hoursDetail?.holNight ?? ''} disabled={!canManage} placeholder="야간"
                onChange={e => pm({ hoursDetail: { wkDay: mu.hoursDetail?.wkDay ?? '', wkNight: mu.hoursDetail?.wkNight ?? '', holDay: mu.hoursDetail?.holDay ?? '', holNight: e.target.value } })} className={`${inputCls} w-32`} />
              {mu.hours.trim() !== '' && (
                <input value={mu.hours} disabled={!canManage} placeholder="영업시간(구 자유입력)" onChange={e => pm({ hours: e.target.value })} className={`${inputCls} w-44`} title="구버전 자유 입력 — 세분 칸 입력 시 문서에는 세분 값이 인쇄됩니다" />
              )}
            </div>
            {/* M-16: 이용자 유형 체크 — 자유 텍스트(users)는 레거시 병기 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-form-xs font-medium text-ink-sub">이용자</span>
              {MULTI_USE_USER_TYPES.map(t => {
                const on = (mu.userTypes ?? []).includes(t)
                return (
                  <button key={t} disabled={!canManage} className={chip(on)}
                    onClick={() => pm({ userTypes: on ? (mu.userTypes ?? []).filter(x => x !== t) : [...(mu.userTypes ?? []), t] })}>
                    {t}
                  </button>
                )
              })}
              <input value={mu.users} disabled={!canManage} placeholder="기타 이용자 유형" onChange={e => pm({ users: e.target.value })} className={`${inputCls} w-32`} />
            </div>
          </>
        )}
      </div>

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
