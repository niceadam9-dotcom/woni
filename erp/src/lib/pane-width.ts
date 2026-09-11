/** 점검 작업대 칸 폭 — 기본 비율 + 사용자 조정치 (2026-08-20, 2026-09-11 칸 수 일반화)
 *
 *  기본 비율은 "대부분의 건에서 좋은 값"이지 모든 건에 맞는 값이 아니다. 불량이 20건인 건은
 *  목록 칸이, 서식을 검토할 때는 미리보기 칸이 더 필요하다. 그래서 칸마다 ◀▶를 두어 **그 칸만**
 *  넓히고 나머지가 균등하게 양보하게 한다 — 조정치의 합은 항상 0이라 전체 폭은 변하지 않는다.
 *
 *  ⚠ 기본 비율은 lg·2xl 두 벌이고 단계에 따라서도 다르다(미리보기 단계는 마지막 칸에 실려 있다).
 *     조정치는 그 **위에 얹는다** — 인라인 style로 통째로 덮으면 2xl 재배분(1920 기준 표시율
 *     87%→99%, 실측 2026-08-18)이 사라진다. 그래서 화면폭별 CSS 변수 두 개로 넘긴다.
 *
 *  🚨 2026-09-11 — **칸 수가 단계마다 다르다.** ④ 소방서 제출은 2칸(생성·제출 / 미리보기)이고
 *     나머지는 3칸이다. 종전엔 `[number, number, number]`와 `PANE_LABELS` 3개가 3칸을 **타입으로
 *     못 박고** 있어서, 2칸 화면을 만들면 조정 UI·저장값·검사가 한꺼번에 어긋났다.
 *     그래서 길이를 가변으로 풀고, 저장값도 **칸 수별로** 따로 둔다.
 *  ⚠ 저장 키를 v1→v2로 올렸다. v1은 3칸 배열 하나라 2칸 화면에서 길이가 안 맞는데,
 *     길이가 안 맞는 값을 조용히 자르면 사용자가 맞춰 둔 폭이 엉뚱한 칸으로 옮겨 간다.
 *
 *  렌더는 inspection-workbench, 회귀 고정은 scripts/_probe-pane-width.mts. */

/** 칸별 조정치 — 길이는 그 화면의 칸 수와 같다(2 또는 3) */
export type PaneW = readonly number[]

/** 단계가 쓰는 칸 구성 — `duo`는 2칸(④ 소방서 제출), 나머지는 3칸 */
export type PaneKind = 'preview' | 'normal' | 'duo'

/** 화면폭 × 단계별 기본 비율 — 종전 하드코딩 클래스에서 그대로 옮긴 값
 *
 *  `duo`(2026-09-11 사용자 A안): ④에서 첫째 칸(제출 전제)을 없애고 그 폭을 **생성·제출 칸에 준다**.
 *  종전 3칸 preview는 lg `[1.15, 0.95, 1.5]` / xl `[1, 0.9, 1.8]`이라, 컨트롤이 가장 많은
 *  생성·제출 칸이 **셋 중 가장 좁았다**(칩이 줄바꿈되던 원인). 미리보기 폭은 줄이지 않는다 —
 *  서식을 읽는 칸이라 좁히면 이 화면의 목적이 무너진다. */
export const PANE_BASE: Record<'lg' | 'xl', Record<PaneKind, number[]>> = {
  lg: { preview: [1.15, 0.95, 1.5], normal: [1.15, 1, 1], duo: [1.5, 1.5] },
  xl: { preview: [1, 0.9, 1.8], normal: [1.15, 1, 1], duo: [1.5, 1.8] },
}

export const PANE_STEP = 0.25
/** 어떤 칸도 이 아래로는 못 내려간다 — 0으로 접으면 그 칸의 ◀▶까지 같이 사라져 되돌릴 길이 없어진다 */
export const PANE_MIN = 0.45
export const PANE_W_KEY = 'wb-pane-width-v2'

/** 칸 이름 — 조정 UI의 라벨. 2칸에서 「가운데 칸」이라 부르면 가운데가 없어 거짓말이 된다. */
export function paneLabels(n: number): readonly string[] {
  return n === 2 ? ['왼쪽 칸', '오른쪽 칸'] : ['첫째 칸', '가운데 칸', '셋째 칸']
}

/** 그 칸 수의 기본 조정치(=조정 없음) */
export function paneWDefault(n: number): PaneW {
  return Array(n).fill(0)
}

/** 3자리로 자른다 — 나머지 칸이 지는 부담이 PANE_STEP/2 = 0.125라 2자리로 자르면
 *  0.12가 되어 합이 0이 아니게 되고, 넓혔다 좁히면 [0.01, 0.01, 0]처럼 조금씩 어긋난 채 눌어붙는다
 *  (프로브가 잡은 실버그, 2026-08-20). 눈금이 ±0.125뿐이므로 3자리면 영구히 정확하다. */
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** grid-template-columns 값 — 조정치를 얹고 최소폭으로 자른다 */
export function paneCols(base: readonly number[], dw: PaneW): string {
  return base.map((v, i) => `minmax(0,${Math.max(PANE_MIN, round3(v + (dw[i] ?? 0)))}fr)`).join(' ')
}

/** 그 칸 수를 쓰는 모든 기본값 — 한쪽(lg)만 보면 다른 화면폭에서 칸이 뭉개진다.
 *  사용자는 lg에서 조정하고 2xl에서 볼 수 있다. */
function basesOfArity(n: number): number[][] {
  const all = [PANE_BASE.lg, PANE_BASE.xl].flatMap(o => Object.values(o))
  return all.filter(b => b.length === n)
}

/** 조정 후에도 **같은 칸 수의 모든 기본값**에서 최소폭을 지키는지 */
export function paneWidthOk(dw: PaneW): boolean {
  const bases = basesOfArity(dw.length)
  // 칸 수가 어떤 기본값과도 안 맞으면 쓸 수 없는 값이다(저장값이 낡았거나 깨진 것)
  if (bases.length === 0) return false
  return bases.every(b => b.every((v, i) => v + (dw[i] ?? 0) >= PANE_MIN - 1e-9))
}

/** i번 칸을 한 눈금 넓히거나(+1) 좁힌다(-1). 나머지 칸이 균등하게 나눠 부담해 합은 0.
 *  최소폭에 걸리면 null — 호출부는 그걸로 버튼을 disabled 한다(눌리는데 아무 일도 안 일어나면 고장으로 보인다).
 *  ⚠ 나누는 수는 `length - 1`이다. 3으로 고정해 두면 2칸에서 합이 0이 아니게 되어 전체 폭이 흔들린다. */
export function nudgePaneW(dw: PaneW, i: number, dir: 1 | -1): PaneW | null {
  const n = dw.length
  if (n < 2 || i < 0 || i >= n) return null
  const d = PANE_STEP * dir
  const next = [...dw]
  next[i] += d
  for (let j = 0; j < n; j++) if (j !== i) next[j] -= d / (n - 1)
  if (!paneWidthOk(next)) return null
  return next.map(round3)
}

/** localStorage에서 읽은 값 검증 — 칸 수별 묶음에서 n칸짜리를 꺼낸다.
 *  형태가 깨졌거나 최소폭을 어기면 null(기본값으로). */
export function parsePaneW(raw: string | null, n: number): PaneW | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const entry = (v as Record<string, unknown>)[String(n)]
    if (!Array.isArray(entry) || entry.length !== n) return null
    if (!entry.every(x => typeof x === 'number' && Number.isFinite(x))) return null
    return paneWidthOk(entry as PaneW) ? (entry as PaneW) : null
  } catch { return null }
}

/* ── 외부 저장소(localStorage) 구독 ────────────────────────────────────────────
 *  useEffect로 읽어 setState하면 cascading render라 lint가 막고(react-hooks/set-state-in-effect),
 *  useState 초기화식에서 바로 읽으면 서버 렌더(0 배열)와 어긋나 hydration이 깨진다.
 *  useSyncExternalStore가 이 둘을 동시에 푸는 자리다 — 서버·hydration은 기본값을 쓰고,
 *  붙은 뒤에 저장값으로 한 번 다시 그린다.
 *  🚨 스냅샷은 **같은 참조**를 돌려줘야 무한 렌더가 안 난다 — 칸 수별로 캐시한다. */
const defaults = new Map<number, PaneW>()
const current = new Map<number, PaneW>()
const loaded = new Set<number>()
const listeners = new Set<() => void>()

function defaultOf(n: number): PaneW {
  let d = defaults.get(n)
  if (!d) { d = paneWDefault(n); defaults.set(n, d) }
  return d
}

export function subscribePaneW(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getPaneWSnapshot(n: number): PaneW {
  if (!loaded.has(n)) {
    loaded.add(n)
    try { current.set(n, parsePaneW(window.localStorage.getItem(PANE_W_KEY), n) ?? defaultOf(n)) }
    catch { current.set(n, defaultOf(n)) }
  }
  return current.get(n) ?? defaultOf(n)
}

/** 서버 렌더·hydration용 — 항상 기본값이라 마크업이 어긋나지 않는다 */
export function getPaneWServerSnapshot(n: number): PaneW {
  return defaultOf(n)
}

export function writePaneW(next: PaneW): void {
  const n = next.length
  current.set(n, next)
  loaded.add(n)
  try {
    // 다른 칸 수의 저장값은 **보존한다** — ④에서 폭을 맞췄다고 ①의 폭이 초기화되면 안 된다
    const raw = window.localStorage.getItem(PANE_W_KEY)
    let all: Record<string, unknown> = {}
    try {
      const p: unknown = JSON.parse(raw ?? '{}')
      if (p && typeof p === 'object' && !Array.isArray(p)) all = p as Record<string, unknown>
    } catch { /* 깨진 값은 버린다 */ }
    all[String(n)] = next
    window.localStorage.setItem(PANE_W_KEY, JSON.stringify(all))
  } catch { /* 저장 실패는 화면 동작과 무관 */ }
  listeners.forEach(cb => cb())
}
