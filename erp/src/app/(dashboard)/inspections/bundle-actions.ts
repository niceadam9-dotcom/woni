'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import type { UserRole } from '@/types'
import { GENERATED_DOC_KINDS } from '@/lib/doc-requirements'
import { buildSheetOverviews } from '@/lib/sheet-overview'
import { isRegenBlocked, REGEN_BLOCKED_MESSAGE } from '@/lib/annex-regen-policy'
import { isMultiUseApplicable } from '@/lib/multi-use'
import { judgeStale, type BundleChecklist, type BundleItemStatus, type BundleGenResult, type BundleBlankRow } from '@/lib/bundle-status'
import { requestReport9Action, type AnnexType } from './report9-actions'

/** 원클릭 번들 (소방계획서_22 S13 — Q-13). 판정·타입은 lib/bundle-status.ts,
 *  이 파일은 async 서버 액션만 export 한다('use server' 규약 — 소방계획서_18 교훈).
 *
 *  구성요소(자체점검): 공문·위임장·표지·별지 9호·별지 4호 + 불량이 있으면 별지 10·11호.
 *  정기·레거시 event: 외관점검표 1종. 위임장은 S8(2026-08-15 사용자 '필요' 확정) —
 *  서식 원천은 '보고서 갑지.xls' [위임장] 탭, 값 없으면 공란 인쇄(Q-4 철학). */

const BUCKET = 'fire-plans'

type Admin = ReturnType<typeof createAdminClient>

async function bundleTargets(admin: Admin, inspectionId: string, isSpecial: boolean): Promise<AnnexType[]> {
  if (!isSpecial) return ['exterior']
  const { count } = await admin.from('inspection_defects')
    .select('id', { count: 'exact', head: true }).eq('inspection_id', inspectionId)
  const base: AnnexType[] = ['official', 'delegation', 'cover', 'report9', 'report4']
  // 별지 10(이행계획)·11(완료보고)은 불량이 있어야 의미가 있다 — 0건이면 빈 서식 혼입 방지 차원에서 제외
  return (count ?? 0) > 0 ? [...base, 'report10', 'report11'] : base
}

/** 관련 데이터 최신 수정 시각 — 점검표 응답·불량·서식 고유 값·펌프성능시험(S13-1의 비교 축).
 *  updated_at이 없는 테이블은 created_at으로 폴백(스키마 차이를 42703 캐치로 흡수). */
async function latestDataAt(admin: Admin, inspectionId: string): Promise<string | null> {
  const tables = ['inspection_sheet_responses', 'inspection_defects', 'annex_inputs', 'inspection_pump_tests']
  let max: string | null = null
  for (const t of tables) {
    for (const col of ['updated_at', 'created_at']) {
      const { data, error } = await admin.from(t).select(col)
        .eq('inspection_id', inspectionId).order(col, { ascending: false }).limit(1)
      if (error) continue   // 컬럼 없음(42703) → 다음 후보
      const v = (data?.[0] as unknown as Record<string, unknown> | undefined)?.[col]
      if (typeof v === 'string' && (!max || v > max)) max = v
      break
    }
  }
  return max
}

/** 구성요소 체크리스트 + stale 판정 + 공란 사전 리포트 (S13-1·3·4) */
export async function getBundleChecklistAction(inspectionId: string): Promise<{ checklist?: BundleChecklist; error?: string }> {
  const profile = await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('customer_id, plan_type, inspection_start_date, inspection_end_date')
    .eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const ins = insp as { customer_id: string; plan_type: string | null; inspection_start_date: string | null; inspection_end_date: string | null }
  const isSpecial = !ins.plan_type || ins.plan_type.startsWith('special')

  const [targets, dataMaxAt] = await Promise.all([
    bundleTargets(admin, inspectionId, isSpecial),
    latestDataAt(admin, inspectionId),
  ])

  // 타입별 최신 생성물 — 파일명 규약 {type}_{stampMs}.pdf (requestReport9Action 업로드 규약)
  const prefix = `${ins.customer_id}/inspections/${inspectionId}`
  // 독립검증 지적(2026-08-15) — 상한이 낮으면 재생성 누적 시 사전순 앞쪽(cover_*)이 먼저 잘려 '미생성' 오판
  const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
  const latestByType = new Map<string, string>()
  for (const o of objects ?? []) {
    const m = o.name.match(/^([a-z0-9]+)_(\d+)\.pdf$/)
    if (!m) continue
    const at = new Date(Number(m[2])).toISOString()
    const cur = latestByType.get(m[1])
    if (!cur || at > cur) latestByType.set(m[1], at)
  }

  const items: BundleItemStatus[] = targets.map(t => {
    const generatedAt = latestByType.get(t) ?? null
    const { stale, reason } = judgeStale(generatedAt, dataMaxAt)
    return { type: t, label: GENERATED_DOC_KINDS[t]?.label ?? t, generatedAt, stale, reason }
  })

  // 공란(미점검) 사전 리포트 — 진행률 집계와 같은 소스(sheet-overview). 경고만, 차단 아님(S13-3)
  const blanks: BundleBlankRow[] = []
  if (isSpecial) {
    const [{ overviews }, { data: formRow }] = await Promise.all([
      buildSheetOverviews(admin, [inspectionId], { id: profile.id, role: profile.role as UserRole }),
      // 독립검증 지적(2026-08-15) — STD-32는 설비 맵 미등재라 installed 축에 안 잡힌다.
      // 인쇄 조립과 같은 판별 축(서식 1.10.3 multiUse 업종 ≥1)으로 공란 리포트에 편입한다
      admin.from('fire_plan_forms').select('sections').eq('customer_id', ins.customer_id).limit(1).maybeSingle(),
    ])
    const mu = ((formRow?.sections as Record<string, unknown> | null)?.['multiUse'] ?? null) as
      { applicable?: boolean; categories?: Record<string, string> } | null
    // 해당 여부 판정은 lib/multi-use 한 곳 — 여기는 거기에 '업종 개소 ≥1'을 더 요구하는 축이다
    const hasMultiUse = !!mu && isMultiUseApplicable(mu) && Object.values(mu.categories ?? {}).some(c => String(c ?? '').trim())
    const ov = overviews[inspectionId]
    for (const s of ov?.sheets ?? []) {
      // 인쇄 대상 축(Q-3 근사): 설치 매칭 + 응답 있음 + 기타사항(항상) + 다중이용업소(업종 축)
      if (!(s.installed || s.responded > 0 || s.sheetCode === 'STD-31' || (s.sheetCode === 'STD-32' && hasMultiUse))) continue
      const blank = s.total - s.responded
      if (blank > 0) blanks.push({ sheetName: s.sheetName, blank, total: s.total })
    }
  }

  return {
    checklist: {
      items, dataMaxAt, blanks,
      regenBlocked: isRegenBlocked(ins),
    },
  }
}

/** 대상 타입 병렬 생성(S13-2) — 타입 간 독립이라 Promise.all. 부분 실패는 타입별로 명시 반환 */
export async function generateBundleAction(
  inspectionId: string, types: AnnexType[],
): Promise<{ results?: BundleGenResult[]; error?: string }> {
  await requirePermission('inspection_register')
  if (!types.length) return { error: '생성할 문서가 없습니다.' }
  // 독립검증 지적(2026-08-15) — 타입별 requestReport9Action 가드(개별 차단)만 있으면
  // 차단 사유가 부분 실패 N건으로 흩어져 보인다. 번들 진입에서 한 번에 선제 차단.
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('inspection_start_date, inspection_end_date').eq('id', inspectionId).single()
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  if (isRegenBlocked(insp)) return { error: REGEN_BLOCKED_MESSAGE }
  const results = await Promise.all(types.map(async (t): Promise<BundleGenResult> => {
    const label = GENERATED_DOC_KINDS[t]?.label ?? t
    try {
      const res = await requestReport9Action(inspectionId, t)
      return { type: t, label, ok: !res.error, error: res.error }
    } catch (e) {
      return { type: t, label, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }))
  return { results }
}
