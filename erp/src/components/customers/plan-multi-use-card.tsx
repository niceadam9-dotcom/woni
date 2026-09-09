'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { MULTI_USE_CATEGORIES } from '@/lib/doc-requirements'
import { NumStepper, formatPhoneKR, useUnsavedWarning } from '@/components/ui/fields'

/** 1.10.3 다중이용업소 현황 — 카드 1장 (소방계획서_43 S7, 2026-09-09 사용자 확정 B안).
 *
 *  왜 1.4로 옮겼나: 이 절이 곧 별지 9호 「안전시설등」 설비 구분의 **설치 축**이다(43 §9).
 *  다른 6개 구분은 1.4에서 체크하는데 이것 하나만 1.10 아래 떨어져 있었고, 축이 멀다는 이유로
 *  `hasMultiUse`(STD-32 시트 편입 축)를 빌려 쓰다 D-6 결함이 났다. 입력 자리를 판정 구조에 맞춘다.
 *
 *  ⚠ **저장 단위가 1.4와 다르다.** 1.4는 `fire_facilities`(건물별 행)이고 여기는
 *    `fire_plan_forms.sections.multiUse`(고객별 JSONB 1행)다. 그래서 1.4의 `saveFacilitiesAction`에
 *    섞지 않고 이 카드가 **자기 저장을 따로** 가진다 — 건물을 바꿔도 값은 그대로다.
 *    건물 선택기 바로 아래라 '이 동의 다중이용업소'로 읽힐 소지가 있어 화면에도 그 경계를 적는다.
 *
 *  ⚠ **서식 번호는 1.10.3 그대로다.** 법정 서식의 절 번호이고 별지 9호 2쪽이 그 번호로 인쇄된다 —
 *    입력 자리를 옮기는 것과 번호를 바꾸는 것은 다른 일이다(43 §10 위험 2).
 *    같은 이유로 인쇄물의 「안전시설등」 문자열도 손대지 않는다(갑지 앵커 라벨 대조 축). */

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
export const EMPTY_MULTI_USE: MultiUseSection = {
  applicable: false, categories: {}, bizName: '', location: '', owner: '', phone: '', hours: '', users: '', capacity: '',
}

export function PlanMultiUseCard({ customerId, canManage, initialMultiUse }: {
  customerId: string
  canManage: boolean
  initialMultiUse: MultiUseSection | null
}) {
  const router = useRouter()
  const [mu, setMu] = useState<MultiUseSection>(initialMultiUse ?? EMPTY_MULTI_USE)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]

  function pm(p: Partial<MultiUseSection>) { setMu(v => ({ ...v, ...p })); setDirty(true) }

  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공).
   *  patch에 multiUse 키만 싣는다 — 부분 업데이트라 나머지 1.10 섹션은 그대로 산다
   *  (fire-plan-form-actions.ts:74 sections 병합). */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, { multiUse: mu })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 1.10.3 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-form-7 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand'
  const chip = (on: boolean) => `h-form-6 px-2 rounded-full text-form-xs border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`

  return (
    <div id="c-1.10.3" data-testid="form14-multi-use"
      className="scroll-mt-4 rounded-xl border border-brand-line-soft bg-brand-tint px-4 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-form-sm font-semibold text-ink-sub">1.10.3 다중이용업소 현황</p>
        <button disabled={!canManage} className={chip(mu.applicable)} onClick={() => pm({ applicable: !mu.applicable })}>
          {mu.applicable ? '해당' : '해당없음'}
        </button>
        {/* 저장 단위 경계 — 위 42종·기타는 건물별인데 이 카드만 고객 단위다(43 §10 위험 3) */}
        <span className="text-form-xs text-ink-meta">
          ※ 별지 9호 「안전시설등」의 설치 축입니다 —
          <span className="font-semibold text-ink-sub"> 건물이 아니라 고객 단위</span>라 대상명을 바꿔도 같은 값입니다
        </span>
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
      {/* 저장 버튼이 1.4와 따로인 이유는 위 머리주석 참조 — 저장소가 다르다 */}
      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending} data-testid="form14-multi-use-save"
            className="inline-flex items-center gap-1 h-form-7 px-2.5 rounded-lg border border-brand-line bg-surface text-form-xs text-brand font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 1.10.3 저장
          </button>
          {msg && <span className="text-form-xs text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
