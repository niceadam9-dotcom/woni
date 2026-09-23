/** 소방계획서 3장 저장값을 화면이 읽을 수 있는 모양으로 채운다 (2026-09-23)
 *
 *  🚨 결함: 3장 화면(`plan-ch3.tsx`)이 `plan.routes.map(...)`에서 **죽었다**(dev 로그 TypeError).
 *    스테이징 실측 — 저장된 `sections.evacPlan` 중 6건이 `procedure·evacMethod·falseAlarm` 세 키**만** 있고
 *    `routes`·`assembly`·`mapImage`가 **아예 없다**(서술 칸만 따로 쓰는 경로의 부분 저장으로 보인다).
 *    초기값이 `initialPlan ?? 기본값`이라 자료가 **있기만 하면** 빠진 키를 채우지 않았다.
 *  ⭐ 문서 생성기(`fire-plan-generate.ts`)는 이미 `evacPlan?.routes?.length ?? 0`으로 견딘다 —
 *    **화면만** 못 견뎠다. 그래서 고칠 곳은 저장 경로가 아니라 **읽는 쪽**이다(과거 자료도 함께 산다).
 *  ⚠ 값이 있는 키는 건드리지 않는다 — 빠진 키만 기본값으로. 배열 자리에 배열이 아닌 게 오면 빈 배열.
 */
import type { EvacPlanSection, VulnerableSection } from '@/components/customers/plan-ch3'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function normalizeEvacPlan(p: Partial<EvacPlanSection> | null | undefined): EvacPlanSection {
  const src = (p ?? {}) as Partial<EvacPlanSection>
  return {
    ...src,
    procedure: str(src.procedure),
    routes: Array.isArray(src.routes) ? src.routes : [],
    assembly: str(src.assembly),
    mapImage: typeof src.mapImage === 'string' ? src.mapImage : null,
  }
}

export function normalizeVulnerable(v: Partial<VulnerableSection> | null | undefined): VulnerableSection {
  const src = (v ?? {}) as Partial<VulnerableSection>
  return {
    ...src,
    none: src.none === true,
    counts: src.counts && typeof src.counts === 'object' && !Array.isArray(src.counts) ? src.counts : {},
    plans: Array.isArray(src.plans) ? src.plans : [],
  }
}
