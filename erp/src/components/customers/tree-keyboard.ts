/** 좌측 목차 트리의 키보드 왕복 규약 (2026-09-21 사용자 요청).
 *
 *  공통·보고서 트리(`tab-form-tree`)와 소방계획서 트리(`plan-tab-view`)가 **나눠 쓴다**.
 *  두 트리가 각자 키 분기를 들고 있으면 조작감이 조용히 갈라진다 — 규칙을 JSX에 묻지 않고
 *  순수 함수로 올려 두면 단언도 여기 하나에 걸린다(같은 축의 선례: `lib/primary-building`).
 *
 *  ⚠ 순환하지 않는다(첫 노드에서 ↑ = 제자리). 13개짜리 목록에서 끝이 처음으로 되감기면
 *    지금 어디 있는지를 잃는다 — 경계에 서는 편이 위치 감각을 지킨다. 끝으로 갈 때는 Home/End.
 */

/** 키 하나가 뜻하는 것 — 이웃 노드로 이동하거나, 오른쪽 상세로 들어가거나, 아무것도 아니거나 */
export type TreeKeyAction = { kind: 'move'; to: string } | { kind: 'enter' }

/** 트리에 포커스가 있을 때 눌린 키의 해석.
 *  ↑←=이전 · ↓→=다음 · Home=첫 · End=마지막 · Enter=상세로 진입. 그 외·경계 밖이면 null(=기본 동작에 맡김). */
export function treeKeyAction(keys: readonly string[], cur: string, pressed: string): TreeKeyAction | null {
  if (pressed === 'Enter') return { kind: 'enter' }
  const i = keys.indexOf(cur)
  if (i < 0) return null
  const to = pressed === 'ArrowDown' || pressed === 'ArrowRight' ? keys[i + 1]
    : pressed === 'ArrowUp' || pressed === 'ArrowLeft' ? keys[i - 1]
    : pressed === 'Home' ? keys[0]
    : pressed === 'End' ? keys[keys.length - 1]
    : undefined
  // 경계(undefined)와 제자리(Home인데 이미 첫 노드)는 둘 다 '아무 일 없음' — preventDefault도 하지 않는다
  return to === undefined || to === cur ? null : { kind: 'move', to }
}

/** 상세에서 트리로 돌아갈 때 — 선택된 노드에 포커스.
 *  ⚠ 노드 키에 따옴표가 없다는 전제(전부 대장 리터럴: '1.2'·'ch2'·'etc'…). 점(.)은 따옴표 안이라 무해하다. */
export function focusTreeNode(root: HTMLElement | null, key: string): void {
  root?.querySelector<HTMLButtonElement>(`[data-plan-node="${key}"]`)?.focus()
}

const FOCUSABLE = [
  'input:not([type=hidden]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'a[href]',
].join(', ')

/** 트리에서 상세로 들어갈 때 — 그 서식의 첫 입력칸에 포커스.
 *  입력칸이 하나도 없는 표시 전용 서식은 패널 자체를 받게 한다(스크린리더가 제목부터 읽는다).
 *  반환 false = 그 패널이 DOM에 없다(지연 마운트 등) — 호출부는 포커스를 트리에 둔 채로 둔다. */
export function focusDetailPanel(root: HTMLElement | null, key: string): boolean {
  const panel = root?.querySelector<HTMLElement>(`[data-detail-panel="${key}"]`)
  if (!panel) return false
  const first = panel.querySelector<HTMLElement>(FOCUSABLE)
  if (first) {
    first.focus()
  } else {
    panel.tabIndex = -1
    panel.focus()
  }
  return true
}
