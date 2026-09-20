'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ExternalLink } from 'lucide-react'
import { saveFirePlanSectionsAction, getPrevYearDutyAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { annexStatusMarks, type AnnexStatusSection, type DutyMark, type PlanStoredMark, type PlanWrittenMark, type PrevYearDutyAuto } from '@/lib/prev-year-duty'
import { useUnsavedWarning } from '@/components/ui/fields'

/** 전년도 업무 실시사항 카드 — **별지 9호 2쪽 3행의 확정 자리** (소방계획서_44 S2 → 2026-09-20 [보고서] 탭 이사).
 *
 *  왜 여기(보고서 탭)인가: 이 값(sections.annexStatus)은 **별지 9호 2쪽에만** 인쇄되고 소방계획서
 *  워크북 50시트 어디에도 실리지 않는다 — 사용자 확정 3분리 기준(별지만 = 보고서 탭)의 정면 사례다.
 *  종전 자리(소방계획서 1.10)에서 카드째 옮겼다. 저장소·마크 규약(mark2)·자동 판정은 그대로.
 *
 *  ⚠ 확정값에는 연도가 없다(D-6) — 소방계획서는 살아 있는 한 벌이고 표지 연도는 사람이 고른다.
 *    ERP는 연도를 고르지도 저장하지도 않고 최신 확정만 유지한다. dutyAuto.year는 **자동 판정의
 *    기준 연도**일 뿐 저장 축이 아니다.
 *  ⚠ annex(확정) 로드 전(null)에는 저장 패치에 싣지 않는다 — 빈 값을 실으면 아직 못 읽은 기존
 *    확정을 덮어쓴다. 부분 업데이트라 {annexStatus}만 보내면 다른 섹션은 그대로 산다. */
export function PlanAnnexStatusCard({ customerId, canManage }: {
  customerId: string
  canManage: boolean
}) {
  const router = useRouter()
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

  /** 전년도 실적 확정 — 같은 칩을 다시 누르면 ''(자동 판정에 맡김)으로 돌아간다.
   *  ⚠ 연도 키 없음(D-6): 확정은 **한 벌**이고 어느 회차를 찍든 그대로 적용된다. */
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
        if (!annex) { resolve(true); return }   // 아직 못 읽었으면 덮어쓸 것도 없다
        const res = await saveFirePlanSectionsAction(customerId, { annexStatus: annex })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 전년도 업무 실시사항 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const chip = (on: boolean) => `h-form-6 px-2 rounded-full text-form-xs border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
  /** 전년도 실적 체크쌍 — 별지 9호 패널의 mark2 규약 그대로: 둘 다 해제 = 자동 판정에 맡김 */
  const markPair = (
    label: string, value: string, yes: string, no: string,
    onPick: (v: string) => void, autoTextStr: string, disabled = false,
  ) => (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={label}>
      {/* 폭은 em(글자 크기 파생) — px로 고정하면 전역 글자 배율에서 라벨이 쪼개진다 */}
      <span className="text-form-xs font-medium text-ink-sub w-[8em] shrink-0 whitespace-nowrap">{label}</span>
      <button disabled={!canManage || disabled} className={chip(value === yes)}
        aria-pressed={value === yes} onClick={() => onPick(value === yes ? '' : yes)}>{yes}</button>
      <button disabled={!canManage || disabled} className={chip(value === no)}
        aria-pressed={value === no} onClick={() => onPick(value === no ? '' : no)}>{no}</button>
      <span className="text-form-2xs text-ink-meta">{disabled ? '미작성 — 보관 칸은 성립하지 않습니다' : autoTextStr}</span>
    </div>
  )
  /** 자동 판정은 부정을 단정하지 않는다 — 실적이 없으면 「미실시」가 아니라 양쪽 공란이다 */
  const autoText = (on: boolean, yes: string, src: string) =>
    on ? `자동 판정: ${yes} (${src})` : '자동 판정 없음 — 고르지 않으면 양쪽 공란으로 인쇄'
  const dy = annexStatusMarks(annex)

  return (
    <div id="c-1.10-prev" className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint p-4 space-y-2"
      data-testid="annex-status-card">
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
            {/* Q-2 — 실적의 원천은 1.11.4 기록부다. <a>(전체 이동) — 같은 경로 soft nav는 서버를
                재렌더하지 않아 ?form= 딥링크가 무시된다(소방계획서_34 S6-1). */}
            <p className="text-form-2xs text-ink-meta">
              실적의 원천은 1.11.4 결과 기록부입니다 —
              <a href={`/customers/${customerId}?tab=plan&form=1.11`}
                className="text-brand hover:underline ml-1 inline-flex items-center gap-0.5">
                1.11.4 기록부로 이동 <ExternalLink className="size-2.5" />
              </a>
            </p>
          </div>
          <p className="text-form-2xs text-ink-meta">
            자동 판정 기준은 가장 최근 점검({dutyAuto.year + 1}년)의 전년도인 {dutyAuto.year}년 실적입니다.
            고른 값에는 연도가 없어 모든 회차의 별지 9호에 그대로 인쇄됩니다.
          </p>
          {canManage && (
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => { void save() }} disabled={!dirty || isPending} data-testid="annex-status-save"
                className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg bg-brand text-white text-form-xs font-medium disabled:opacity-50">
                {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 저장
              </button>
              {msg && <span className="text-form-xs text-ink-sub">{msg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
