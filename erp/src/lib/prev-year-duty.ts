/** 별지 9호 2쪽 「소방계획서 · 자체점검(전년도) · 교육훈련(전년도)」 3행의 **단일 원천** (소방계획서_44)
 *
 *  서식 9쪽 작성방법 8호가 이 셋을 한 묶음("소방안전관리업무 실시사항", 화재예방법 제24조)으로 규정한다.
 *  그래서 사람이 확정하는 자리도 한 곳이다 — **소방계획서 서식 1.10 「전년도 업무 실시사항」**
 *  (`fire_plan_forms.sections.annexStatus`). 종전엔 점검 건의 별지 9호 패널(`annex_inputs`)에 있었다.
 *
 *  왜 옮겼나(44 §3):
 *   · 세 행은 **(고객, 연도) 사실**인데 `annex_inputs`는 점검 건 단위였다.
 *   · 값에 **연도가 새겨져 있지 않아** 「전년도」의 뜻을 읽는 시점(insp.year-1)이 정했고,
 *     전 회차 이어받기가 6칸을 통째로 복사해 **작년 확정이 올해 실적으로 인쇄**될 수 있었다.
 *  → 저장 키를 실적 연도로 잡는 것(`prevYear['2025']`)이 그 경로를 데이터 모양에서 없앤다.
 *
 *  판정 규칙은 여기 한 곳에만 적는다. 조립기(report9-assemble)·입력 화면(plan-form110)·
 *  작성 패널 요약이 같은 함수를 쓰므로 "화면은 실시라는데 서식은 공란"이 생길 수 없다.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { trainingDoneIn, type TrainingRecordLike } from '@/lib/training-records'

type Admin = ReturnType<typeof createAdminClient>

/** 3상태 — ''(자동 판정에 맡김) / 긍정 / 부정. 별지 9호 패널의 mark2 규약을 그대로 옮긴 것 */
export type DutyMark = '' | '실시' | '미실시'
export type PlanWrittenMark = '' | '작성' | '미작성'
export type PlanStoredMark = '' | '보관' | '미보관'

/** sections.annexStatus — 연도 키는 **실적 연도**(= 점검연도 - 1)다. 점검연도가 아니다. */
export type AnnexStatusSection = {
  prevYear?: Record<string, { edu?: string; drill?: string; op?: string; comp?: string }>
  /** 작성·보관은 '현재 상태'라 연도축이 없다 */
  plan?: { written?: string; stored?: string }
}

export type PrevYearDutyAuto = {
  /** 실적 연도 */
  year: number
  hasPlan: boolean
  opDone: boolean
  compDone: boolean
  eduDone: boolean
  drillDone: boolean
}

export type PrevYearDutyResolved = {
  year: number
  hasPlan: boolean; planNone: boolean
  stored: boolean; unstored: boolean
  opDone: boolean; opNone: boolean
  compDone: boolean; compNone: boolean
  eduDone: boolean; eduNone: boolean
  drillDone: boolean; drillNone: boolean
}

/** 별지 9호 ③계층 레거시(annex_inputs.fields) — Q-3: 입력구는 걷고 **읽기 폴백만** 남긴다 */
export type LegacyAnnexMarks = {
  eduDone?: string; drillDone?: string
  prevOpDone?: string; prevCompDone?: string
  firePlanWritten?: string; firePlanStored?: string
}

export const EMPTY_ANNEX_STATUS: AnnexStatusSection = { prevYear: {}, plan: { written: '', stored: '' } }

/** 실적 연도의 확정값 한 벌 꺼내기 (없으면 전부 '') */
export function annexStatusForYear(st: AnnexStatusSection | null | undefined, year: number): {
  edu: DutyMark; drill: DutyMark; op: DutyMark; comp: DutyMark
} {
  const r = st?.prevYear?.[String(year)] ?? {}
  const m = (v: unknown): DutyMark => (v === '실시' || v === '미실시' ? v : '')
  return { edu: m(r.edu), drill: m(r.drill), op: m(r.op), comp: m(r.comp) }
}

/** 확정값이 들어 있는 다른 연도들 — 화면이 '올해-1'만 편집하므로, 나머지가 안 보이면 안 된다 */
export function annexStatusOtherYears(st: AnnexStatusSection | null | undefined, year: number): string[] {
  return Object.entries(st?.prevYear ?? {})
    .filter(([y, v]) => y !== String(year) && Object.values(v ?? {}).some(x => String(x ?? '').trim()))
    .map(([y]) => y)
    .sort()
}

/** ── 자동 판정 (종전 report9-assemble.ts:294-324의 규칙 그대로 이관) ──────────────
 *
 *  **부정을 단정하지 않는다**(A9-6). 실적이 없으면 「미실시」가 아니라 판정 없음(=양쪽 공란)이다.
 *  부정 칸(미실시·미작성·미보관) √는 사람이 확정할 때만 나간다.
 */
export async function judgePrevYearDutyAuto(
  admin: Admin,
  args: {
    customerId: string
    /** 실적 연도(= 점검연도 - 1) */
    year: number
    /** fire_plan_forms.sections */
    sections: Record<string, unknown>
    /** customers.inspection_sub_type — 일반관리 고객의 작동/종합 축 복원용 */
    inspectionSubType?: string | null
  },
): Promise<PrevYearDutyAuto> {
  const { customerId, year, sections, inspectionSubType } = args

  // 작성 여부 = 서식 입력 존재(빈 껍데기 {} 제외).
  // ⚠ annexStatus 자신은 근거에서 뺀다 — 이 확정 블록만 저장하고 계획서를 한 줄도 안 썼는데
  //   「작성 √」가 나가면 자기 자신을 근거로 삼는 꼴이 된다(44에서 새로 생긴 자리라 종전엔 없던 함정).
  const hasPlan = Object.keys(sections ?? {}).filter(k => k !== 'annexStatus').length > 0

  const { data: prevRows } = await admin.from('inspections')
    .select('inspection_type').eq('customer_id', customerId).eq('year', year).eq('status', 'completed')
  const prevList = (prevRows ?? []) as Array<{ inspection_type: string }>
  // 종합은 종합, 작동은 작동 — 축을 섞지 않는다(2026-08-20 확정).
  // 일반관리 고객의 점검 행은 inspection_type='일반관리'라 어디에도 안 걸린다 → 고객의 sub_type으로 같은 축을 복원.
  const prevGeneral = prevList.some(r => r.inspection_type === '일반관리')
  const sub = inspectionSubType ?? ''
  const opDone = prevList.some(r => r.inspection_type === '작동') || (prevGeneral && sub === '작동')
  const compDone = prevList.some(r => r.inspection_type === '종합') || (prevGeneral && sub === '종합')

  // 교육·훈련 실적 원천은 서식 1.11.4 결과 기록부뿐 — 연도 판정은 lib/training-records 한 곳
  const records = ((sections['training'] as { records?: TrainingRecordLike[] } | null)?.records) ?? []
  const t = trainingDoneIn(records, year)

  return { year, hasPlan, opDone, compDone, eduDone: t.edu, drillDone: t.drill }
}

/** ── 확정 해석 사슬 ──────────────────────────────────────────────────────────
 *  ① sections.annexStatus (소방계획서 1.10 확정 — 새 정본)
 *  ② annex_inputs.fields  (레거시 읽기 폴백, Q-3 — 입력구는 없앴다)
 *  ③ 자동 판정 (부정 단정 없음)
 */
export function resolvePrevYearDuty(
  auto: PrevYearDutyAuto,
  status: AnnexStatusSection | null | undefined,
  legacy: LegacyAnnexMarks = {},
): PrevYearDutyResolved {
  const pick = (planVal: unknown, legacyVal: unknown, yes: string, no: string): 'yes' | 'no' | '' => {
    const p = String(planVal ?? '').trim()
    const v = p || String(legacyVal ?? '').trim()
    return v === yes ? 'yes' : v === no ? 'no' : ''
  }
  const y = annexStatusForYear(status, auto.year)

  const mEdu = pick(y.edu, legacy.eduDone, '실시', '미실시')
  const mDrill = pick(y.drill, legacy.drillDone, '실시', '미실시')
  const mOp = pick(y.op, legacy.prevOpDone, '실시', '미실시')
  const mComp = pick(y.comp, legacy.prevCompDone, '실시', '미실시')
  const mPlan = pick(status?.plan?.written, legacy.firePlanWritten, '작성', '미작성')
  const mStore = pick(status?.plan?.stored, legacy.firePlanStored, '보관', '미보관')

  const hasPlan = mPlan ? mPlan === 'yes' : auto.hasPlan
  const planNone = mPlan === 'no'
  // Q-4(2026-09-07 확정): 「보관」에는 원천이 없다. 종전엔 작성 여부를 그대로 따라
  // (firePlanStored ?? hasFirePlan) 근거 없이 보관 √가 찍혔다 —
  // **고르지 않으면 보관·미보관 둘 다 공란**이 답이다(부정도 긍정도 단정하지 않음, A9-6과 같은 축).
  // 미작성이면 보관 칸 자체가 성립하지 않으므로 양쪽을 끊는다.
  const stored = planNone ? false : mStore === 'yes'
  const unstored = planNone ? false : mStore === 'no'

  return {
    year: auto.year,
    hasPlan, planNone, stored, unstored,
    opDone: mOp ? mOp === 'yes' : auto.opDone, opNone: mOp === 'no',
    compDone: mComp ? mComp === 'yes' : auto.compDone, compNone: mComp === 'no',
    eduDone: mEdu ? mEdu === 'yes' : auto.eduDone, eduNone: mEdu === 'no',
    drillDone: mDrill ? mDrill === 'yes' : auto.drillDone, drillNone: mDrill === 'no',
  }
}

/** 작성 패널 1단 요약용 3줄 — **문서 문자열이 아니다**(문서는 report9.ts·xlsx-workbook.ts가 각자 조판한다).
 *  화면에서 "지금 무엇이 인쇄되는가"만 보여 주는 용도. */
export function prevYearDutyLines(r: PrevYearDutyResolved): Array<{ label: string; text: string }> {
  const m = (on: boolean) => (on ? '☑' : '☐')
  return [
    { label: '소방계획서', text: `${m(r.hasPlan)}작성 ${m(r.planNone)}미작성 · ${m(r.stored)}보관 ${m(r.unstored)}미보관` },
    { label: '자체점검', text: `작동 ${m(r.opDone)}실시 ${m(r.opNone)}미실시 · 종합 ${m(r.compDone)}실시 ${m(r.compNone)}미실시` },
    { label: '교육훈련', text: `교육 ${m(r.eduDone)}실시 ${m(r.eduNone)}미실시 · 훈련 ${m(r.drillDone)}실시 ${m(r.drillNone)}미실시` },
  ]
}
