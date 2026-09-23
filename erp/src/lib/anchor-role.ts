/** 기준일 띠의 두 칸(사용승인일·점검일자) 중 **어느 쪽이 실제 기산점인가** — 화면 배지용 (2026-09-23)
 *
 *  사용자 요청: 「사용승인일·점검일자는 중요하니 쉽게 눈에 띄게」. 두 날짜를 크게 두는 것만으론
 *  「어느 날짜로 일정이 잡히는가」가 안 보인다(실측 65%가 사용승인일에 밀려 다른 날에 앉았다).
 *  그래서 **쓰이는 칸에 `기산점` 배지**, 값은 있지만 안 쓰이는 칸엔 `참고`를 단다.
 *
 *  ⚠ 판정 규칙을 새로 짜지 않는다 — 서버·생성기와 **같은** `resolveAnchor`의 source를 그대로 옮긴다.
 *    두 벌로 적으면 「배지는 사용승인일인데 일정은 점검일자」가 곧바로 생긴다.
 */
import { resolveAnchor, type AnchorInput } from './plan-anchor'

export type AnchorRole = 'anchor' | 'reference' | 'empty'

export function anchorRoles(c: AnchorInput): { approval: AnchorRole; plan: AnchorRole } {
  const r = resolveAnchor(c)
  const has = (v: string | null | undefined) => !!(v && v.trim())
  const role = (isAnchor: boolean, v: string | null | undefined): AnchorRole =>
    isAnchor ? 'anchor' : has(v) ? 'reference' : 'empty'
  return {
    approval: role(r.source === 'approval', c.use_approval_date),
    plan: role(r.source === 'manual', c.plan_anchor_date),
  }
}
