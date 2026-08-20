/** 점검 작업대 3칸 폭 — 기본 비율 + 사용자 조정치 (2026-08-20)
 *
 *  기본 비율은 "대부분의 건에서 좋은 값"이지 모든 건에 맞는 값이 아니다. 불량이 20건인 건은
 *  목록 칸이, 서식을 검토할 때는 미리보기 칸이 더 필요하다. 그래서 칸마다 ◀▶를 두어 **그 칸만**
 *  넓히고 나머지 둘이 균등하게 양보하게 한다 — 조정치의 합은 항상 0이라 전체 폭은 변하지 않는다.
 *
 *  ⚠ 기본 비율은 lg·2xl 두 벌이고 단계에 따라서도 다르다(미리보기 단계는 3번째 칸에 실려 있다).
 *     조정치는 그 **위에 얹는다** — 인라인 style로 통째로 덮으면 2xl 재배분(1920 기준 표시율
 *     87%→99%, 실측 2026-08-18)이 사라진다. 그래서 화면폭별 CSS 변수 두 개로 넘긴다.
 *
 *  렌더는 inspection-workbench, 회귀 고정은 scripts/_probe-pane-width.mts. */

export type PaneW = [number, number, number]

/** 화면폭 × 단계별 기본 비율 — 종전 하드코딩 클래스에서 그대로 옮긴 값 */
export const PANE_BASE: Record<'lg' | 'xl', Record<'preview' | 'normal', PaneW>> = {
  lg: { preview: [1.15, 0.95, 1.5], normal: [1.15, 1, 1] },
  xl: { preview: [1, 0.9, 1.8], normal: [1.15, 1, 1] },
}

export const PANE_STEP = 0.25
/** 어떤 칸도 이 아래로는 못 내려간다 — 0으로 접으면 그 칸의 ◀▶까지 같이 사라져 되돌릴 길이 없어진다 */
export const PANE_MIN = 0.45
export const PANE_W_KEY = 'wb-pane-width-v1'
export const PANE_LABELS = ['첫째 칸', '가운데 칸', '셋째 칸'] as const

/** 3자리로 자른다 — 나머지 두 칸이 지는 부담이 PANE_STEP/2 = 0.125라 2자리로 자르면
 *  0.12가 되어 합이 0이 아니게 되고, 넓혔다 좁히면 [0.01, 0.01, 0]처럼 조금씩 어긋난 채 눌어붙는다
 *  (프로브가 잡은 실버그, 2026-08-20). 눈금이 ±0.125뿐이므로 3자리면 영구히 정확하다. */
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** grid-template-columns 값 — 조정치를 얹고 최소폭으로 자른다 */
export function paneCols(base: PaneW, dw: PaneW): string {
  return base.map((v, i) => `minmax(0,${Math.max(PANE_MIN, round3(v + dw[i]))}fr)`).join(' ')
}

/** 조정 후에도 lg·2xl **양쪽 기본값**에서 최소폭을 지키는지.
 *  한쪽만 보면 다른 화면폭에서 칸이 뭉개진다 — 사용자는 lg에서 조정하고 2xl에서 볼 수 있다. */
export function paneWidthOk(dw: PaneW): boolean {
  const bases = [PANE_BASE.lg.preview, PANE_BASE.lg.normal, PANE_BASE.xl.preview, PANE_BASE.xl.normal]
  return bases.every(b => b.every((v, i) => v + dw[i] >= PANE_MIN - 1e-9))
}

/** i번 칸을 한 눈금 넓히거나(+1) 좁힌다(-1). 나머지 두 칸이 절반씩 나눠 부담해 합은 0.
 *  최소폭에 걸리면 null — 호출부는 그걸로 버튼을 disabled 한다(눌리는데 아무 일도 안 일어나면 고장으로 보인다). */
export function nudgePaneW(dw: PaneW, i: number, dir: 1 | -1): PaneW | null {
  const d = PANE_STEP * dir
  const next = [...dw] as PaneW
  next[i] += d
  for (let j = 0; j < 3; j++) if (j !== i) next[j] -= d / 2
  if (!paneWidthOk(next)) return null
  return next.map(round3) as PaneW
}

/** localStorage에서 읽은 값 검증 — 형태가 깨졌거나 최소폭을 어기면 기본값으로 */
export function parsePaneW(raw: string | null): PaneW | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v) || v.length !== 3) return null
    if (!v.every(n => typeof n === 'number' && Number.isFinite(n))) return null
    return paneWidthOk(v as PaneW) ? (v as PaneW) : null
  } catch { return null }
}

/* ── 외부 저장소(localStorage) 구독 ────────────────────────────────────────────
 *  useEffect로 읽어 setState하면 cascading render라 lint가 막고(react-hooks/set-state-in-effect),
 *  useState 초기화식에서 바로 읽으면 서버 렌더([0,0,0])와 어긋나 hydration이 깨진다.
 *  useSyncExternalStore가 이 둘을 동시에 푸는 자리다 — 서버·hydration은 기본값을 쓰고,
 *  붙은 뒤에 저장값으로 한 번 다시 그린다. 스냅샷은 **같은 참조**를 돌려줘야 무한 렌더가 안 난다. */
export const PANE_W_DEFAULT: PaneW = [0, 0, 0]
let current: PaneW = PANE_W_DEFAULT
let loaded = false
const listeners = new Set<() => void>()

export function subscribePaneW(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getPaneWSnapshot(): PaneW {
  if (!loaded) {
    loaded = true
    try { current = parsePaneW(window.localStorage.getItem(PANE_W_KEY)) ?? PANE_W_DEFAULT } catch { /* 저장소 불가 */ }
  }
  return current
}

/** 서버 렌더·hydration용 — 항상 기본값이라 마크업이 어긋나지 않는다 */
export function getPaneWServerSnapshot(): PaneW {
  return PANE_W_DEFAULT
}

export function writePaneW(next: PaneW): void {
  current = next
  loaded = true
  try { window.localStorage.setItem(PANE_W_KEY, JSON.stringify(next)) } catch { /* 저장 실패는 화면 동작과 무관 */ }
  listeners.forEach(cb => cb())
}
