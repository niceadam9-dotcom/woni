'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { generateFirePlanNow } from '@/lib/fire-plan-generate'

/** 소방계획서 생성 (소방계획서_7 H-13 — 서버 동기 전환, 2026-08-04)
 *  종전: fire_plan_gen_jobs 큐 등록 → Windows 워커(한글 SDK)가 폴링·처리.
 *  현행: 요청 액션이 서버에서 즉시 생성(HTML 템플릿 → Gotenberg PDF → 보관함 등록) — src/lib/fire-plan-generate.ts.
 *  잡 행은 완료 기록용으로 남김(status 즉시 done/failed) — 기존 폴링 UI(최근 결과·누락 안내)가 그대로 읽는다.
 *  같은 고객·연도의 대기/처리 중 요청(워커 큐 잔존분)은 유니크 인덱스·사전 체크로 중복 생성 방지.
 *
 *  ⚠ 공통 수기 프리셋(_presets/{유형}.json · presetType 인자 · 조회/저장 액션)은 **폐지**(2026-08-19).
 *  유형별 문구는 '계획서 공통문구'(plan_text_library)가 담당한다 — fire-plan-presets.ts 주석 참조. */

const BUCKET = 'fire-plans'

export async function searchCustomersForPlanAction(q: string): Promise<{
  customers: Array<{ id: string; name: string; type: string; purpose: string | null }>
}> {
  await requirePermission('customer_manage')
  if (!q.trim()) return { customers: [] }
  const admin = createAdminClient()
  const { data } = await admin.from('customers')
    .select('id, customer_name, inspection_type, buildings(purpose, is_active)')
    .eq('is_active', true)
    .ilike('customer_name', `%${q.trim()}%`)
    .order('customer_name')
    .limit(10)
  return {
    customers: ((data ?? []) as Array<{
      id: string; customer_name: string; inspection_type: string
      buildings: Array<{ purpose: string | null; is_active: boolean }> | null
    }>).map(c => ({
      id: c.id,
      name: c.customer_name,
      type: c.inspection_type,
      purpose: (c.buildings ?? []).find(b => b.is_active)?.purpose ?? null,
    })),
  }
}

// getFirePlanReadinessAction 삭제(2026-08-19) — 배치 발행 폐지로 유일한 소비자(generate-request-client)가
// 사라졌다. 'use server' export는 그 자체로 공개 엔드포인트라 쓰지 않는 것은 남기지 않는다.
// 준비율 계산 자체는 lib/fire-plan-readiness.ts에 그대로 있고 고객 상세·프로브가 계속 쓴다.

/** 생성 요청 — 다중 고객 순차 서버 동기 생성 (H-13)
 *  건당 수 초(Gotenberg 변환) — 30건 한도 유지. 완료/실패는 잡 행(done/failed)으로 기록해 기존 폴링 UI 호환. */
export async function requestFirePlanHwpAction(
  customerIds: string[], year: number,
): Promise<{ requested?: number; error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const ids = [...new Set(customerIds)].filter(Boolean)
  if (ids.length === 0) return { error: '고객을 선택해주세요.' }
  if (ids.length > 30) return { error: '일괄 요청은 최대 30건까지 가능합니다.' }
  if (!year || year < 2000 || year > 2100) return { error: '연도를 확인해주세요.' }

  const { data: custs } = await admin.from('customers')
    .select('id, customer_name, inspection_type').in('id', ids)
  const rows = (custs ?? []) as Array<{ id: string; customer_name: string; inspection_type: string }>
  const nameById = new Map(rows.map(c => [c.id, c.customer_name]))
  if (nameById.size !== ids.length) return { error: '고객을 찾을 수 없습니다.' }
  // 일반관리도 소방계획서 대상 (소방계획서_6 W-19·D-6) — 유형 거부 필터 제거

  // 대기/처리 중 요청(구 워커 큐 잔존분·동시 요청) 사전 체크 — 같은 고객·연도 중복 생성 방지
  const { data: activeJobs } = await admin.from('fire_plan_gen_jobs')
    .select('customer_id').eq('year', year).in('customer_id', ids).in('status', ['pending', 'processing'])
  const activeIds = new Set(((activeJobs ?? []) as Array<{ customer_id: string }>).map(j => j.customer_id))

  let requested = 0
  const dup: string[] = []
  const failed: string[] = []
  for (const id of ids) {
    const name = nameById.get(id) ?? id
    if (activeIds.has(id)) { dup.push(name); continue }
    const res = await generateFirePlanNow(admin, { customerId: id, year, requestedBy: profile.id })
    // 완료 기록 — 폴링 UI(최근 결과·누락 안내)·문서 현황이 잡 테이블을 그대로 읽는다
    await admin.from('fire_plan_gen_jobs').insert({
      customer_id: id,
      customer_name: name,
      year,
      preset_type: null,   // 프리셋 폐지(2026-08-19) — 컬럼은 과거 기록 보존을 위해 남긴다
      requested_by: profile.id,
      requested_by_name: profile.name,
      status: res.error ? 'failed' : 'done',
      missing: res.missing ?? null,
      error: res.error ? res.error.slice(0, 300) : null,
      finished_at: new Date().toISOString(),
    } as Record<string, unknown>)
    if (res.error) { failed.push(`${name}: ${res.error}`); continue }
    requested++
    revalidatePath(`/customers/${id}`)
  }
  const notes: string[] = []
  if (dup.length > 0) notes.push(`${dup.join(', ')}: 같은 연도의 대기/처리 중 요청이 이미 있어 건너뛰었습니다`)
  if (failed.length > 0) notes.push(`생성 실패 — ${failed.join(' / ')}`)
  if (notes.length > 0) {
    return { requested, error: notes.join(' · ') + (requested > 0 ? ` (나머지 ${requested}건은 생성 완료)` : '') }
  }
  return { requested }
}

/* ── P-1 연차 일괄 발행 마법사 삭제 (2026-08-19 사용자 확정) ──
 *  getAnnualTargetsAction·bulkAnnualIssueAction·AnnualTargets를 걷어냈다.
 *
 *  왜: 전 고객 일괄 발행의 전제가 무너져 있었다 — 실측(2026-08-19) 활성 고객 313명 중
 *  계획서 입력이 완비된 고객이 **0명**이라 일괄 발행은 빈칸투성이 문서 313건을 만들 뿐이었다.
 *  실사용도 없었다(소방계획서 생성 잡 총 8건·3일, 최근 2건은 실패).
 *  실제로 쓰인 '연차발행'은 이 마법사가 아니라 고객 상세 소방계획서 탭의 [연차] 버튼
 *  (fire-plan-actions.ts issueNextYearPlanAction)이며 그쪽은 그대로 남는다.
 *  잘못 눌러 빈 문서를 대량 생성할 위험이 이득보다 컸다. */

// getFirePlanPresetsAction·saveFirePlanPresetAction 삭제(2026-08-19) — 공통 수기 프리셋 폐지.
// 유형별 문구는 '계획서 공통문구'(plan_text_library)의 대안 항목이 담당한다.
// _presets/*.json은 더 이상 읽지 않는다(스토리지 파일은 남아 있어도 무해 — 아무도 참조하지 않음).

// getFirePlanGenStatusAction·GenStatus 삭제(2026-08-19) — 큐 현황판은 배치 발행 화면 전용이었다.
// 소비자(batch page·generate-request-client)가 함께 사라져 더는 읽히지 않는다.
// 생성 자체는 서버 동기(H-13, requestFirePlanHwpAction)라 큐를 들여다볼 화면이 필요 없고,
// 고객 상세는 잡이 아니라 결과(보관함 행)를 본다. 잡 행은 완료 기록용으로 계속 남는다.
