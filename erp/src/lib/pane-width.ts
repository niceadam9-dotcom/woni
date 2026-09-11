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
 *  🚨 2026-09-11 — **칸 수가 단계마다 다르다.** ④ 소방서 제출과 ① 점검표가 2칸이고 나머지는
 *     3칸이다. 종전엔 `[number, number, number]`와 `PANE_LABELS` 3개가 3칸을 **타입으로
 *     못 박고** 있어서, 2칸 화면을 만들면 조정 UI·저장값·검사가 한꺼번에 어긋났다.
 *     그래서 길이를 가변으로 풀었다.
 *
 *  🚨 2026-09-11(2) — **저장값을 칸 수가 아니라 `PaneKind`로 가른다.**
 *     ①을 2칸으로 만들면서 ④와 칸 수가 같아졌는데, 저장 키가 칸 수(`"2"`)면 **둘이 한 값을
 *     공유**한다 — ④에서 미리보기를 넓히면 ①의 불량 내역이 덩달아 넓어진다. 두 화면은 칸 수만
 *     같을 뿐 칸의 **뜻이 다르다**(④=생성·제출/미리보기, ①=점검표/불량). 뜻이 다른 것을 같은
 *     칸에 담으면 사용자가 맞춰 둔 폭이 엉뚱한 화면으로 옮겨 간다.
 *  ⚠ 저장 키를 v2→v3로 올렸다. v2는 `{"2":[…],"3":[…]}`라 kind로 읽으면 전부 미스인데,
 *     그건 **기본값으로 떨어질 뿐**이라 안전하다(조용히 엉뚱한 칸에 얹히는 것보다 낫다).
 *
 *  렌더는 inspection-workbench, 회귀 고정은 scripts/_probe-pane-width.mts. */

/** 칸별 조정치 — 길이는 그 화면의 칸 수와 같다(2 또는 3) */
export type PaneW = readonly number[]

/** 단계가 쓰는 칸 구성 — `duo`·`entry`는 2칸, 나머지는 3칸 */
export type PaneKind = 'preview' | 'normal' | 'duo' | 'entry'

/** 화면폭 × 단계별 기본 비율 — 종전 하드코딩 클래스에서 그대로 옮긴 값
 *
 *  `duo`(2026-09-11 사용자 A안): ④에서 첫째 칸(제출 전제)을 없애고 그 폭을 **생성·제출 칸에 준다**.
 *  종전 3칸 preview는 lg `[1.15, 0.95, 1.5]` / xl `[1, 0.9, 1.8]`이라, 컨트롤이 가장 많은
 *  생성·제출 칸이 **셋 중 가장 좁았다**(칩이 줄바꿈되던 원인). 미리보기 폭은 줄이지 않는다 —
 *  서식을 읽는 칸이라 좁히면 이 화면의 목적이 무너진다.
 *
 *  `entry`(2026-09-11 사용자 지시): ①에서 셋째 칸(점검 인력·생성물)을 없앤다 — 참여자는 ②에,
 *  별지 4호 생성은 ④ 칩에, 생성물은 ④·첫째 칸에 이미 있었다(전부 중복). 남는 폭은 **점검표
 *  입력 칸**이 더 많이 가져간다: 시트 트리가 이 화면의 주 작업면이고, 불량 칸은 카드 목록이라
 *  `duo`의 미리보기처럼 넓을 필요가 없다. 그래서 `duo`와 **반대로 첫째 칸이 넓다**. */
export const PANE_BASE: Record<'lg' | 'xl', Record<PaneKind, number[]>> = {
  lg: { preview: [1.15, 0.95, 1.5], normal: [1.15, 1, 1], duo: [1.5, 1.5], entry: [1.6, 1.4] },
  xl: { preview: [1, 0.9, 1.8], normal: [1.15, 1, 1], duo: [1.5, 1.8], entry: [1.7, 1.3] },
}

export const PANE_STEP = 0.25
/** 어떤 칸도 이 아래로는 못 내려간다 — 0으로 접으면 그 칸의 ◀▶까지 같이 사라져 되돌릴 길이 없어진다 */
export const PANE_MIN = 0.45
export const PANE_W_KEY = 'wb-pane-width-v3'

/** 그 구성의 칸 수 — 호출부가 `PANE_BASE.lg[kind].length`를 따로 세지 않게 한다 */
export function paneCountOf(kind: PaneKind): number {
  return PANE_BASE.lg[kind].length
}

/** 칸 이름 — 조정 UI의 라벨. 2칸에서 「가운데 칸」이라 부르면 가운데가 없어 거짓말이 된다. */
export function paneLabels(n: number): readonly string[] {
  return n === 2 ? ['왼쪽 칸', '오른쪽 칸'] : ['첫째 칸', '가운데 칸', '셋째 칸']
}

/** 그 구성의 기본 조정치(=조정 없음) */
export function paneWDefault(kind: PaneKind): PaneW {
  return Array(paneCountOf(kind)).fill(0)
}

/** 3자리로 자른다 — 나머지 칸이 지는 부담이 PANE_STEP/2 = 0.125라 2자리로 자르면
 *  0.12가 되어 합이 0이 아니게 되고, 넓혔다 좁히면 [0.01, 0.01, 0]처럼 조금씩 어긋난 채 눌어붙는다
 *  (프로브가 잡은 실버그, 2026-08-20). 눈금이 ±0.125뿐이므로 3자리면 영구히 정확하다. */
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** grid-template-columns 값 — 조정치를 얹고 최소폭으로 자른다 */
export function paneCols(base: readonly number[], dw: PaneW): string {
  return base.map((v, i) => `minmax(0,${Math.max(PANE_MIN, round3(v + (dw[i] ?? 0)))}fr)`).join(' ')
}

/** 조정 후에도 그 구성의 **lg·2xl 양쪽** 기본값에서 최소폭을 지키는지.
 *  한쪽만 보면 다른 화면폭에서 칸이 뭉개진다 — 사용자는 lg에서 조정하고 2xl에서 볼 수 있다.
 *  ⚠ 종전에는 **같은 칸 수의 모든 기본값**을 봤다(`basesOfArity`). 칸 수가 같아도 구성이 다르면
 *    기본 비율이 다르므로, 남의 구성 때문에 내 화면의 조정이 막히는 일이 생긴다 — kind로 좁힌다. */
export function paneWidthOk(kind: PaneKind, dw: PaneW): boolean {
  const bases = [PANE_BASE.lg[kind], PANE_BASE.xl[kind]]
  // 길이가 그 구성의 칸 수와 다르면 쓸 수 없는 값이다(저장값이 낡았거나 깨진 것)
  if (dw.length !== bases[0].length) return false
  return bases.every(b => b.every((v, i) => v + (dw[i] ?? 0) >= PANE_MIN - 1e-9))
}

/** i번 칸을 한 눈금 넓히거나(+1) 좁힌다(-1). 나머지 칸이 균등하게 나눠 부담해 합은 0.
 *  최소폭에 걸리면 null — 호출부는 그걸로 버튼을 disabled 한다(눌리는데 아무 일도 안 일어나면 고장으로 보인다).
 *  ⚠ 나누는 수는 `length - 1`이다. 3으로 고정해 두면 2칸에서 합이 0이 아니게 되어 전체 폭이 흔들린다. */
export function nudgePaneW(kind: PaneKind, dw: PaneW, i: number, dir: 1 | -1): PaneW | null {
  const n = dw.length
  if (n < 2 || i < 0 || i >= n) return null
  const d = PANE_STEP * dir
  const next = [...dw]
  next[i] += d
  for (let j = 0; j < n; j++) if (j !== i) next[j] -= d / (n - 1)
  if (!paneWidthOk(kind, next)) return null
  return next.map(round3)
}

/** localStorage에서 읽은 값 검증 — 구성별 묶음에서 그 kind의 값을 꺼낸다.
 *  형태가 깨졌거나 최소폭을 어기면 null(기본값으로). */
export function parsePaneW(raw: string | null, kind: PaneKind): PaneW | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const entry = (v as Record<string, unknown>)[kind]
    if (!Array.isArray(entry) || entry.length !== paneCountOf(kind)) return null
    if (!entry.every(x => typeof x === 'number' && Number.isFinite(x))) return null
    return paneWidthOk(kind, entry as PaneW) ? (entry as PaneW) : null
  } catch { return null }
}

/* ── 외부 저장소(localStorage) 구독 ────────────────────────────────────────────
 *  useEffect로 읽어 setState하면 cascading render라 lint가 막고(react-hooks/set-state-in-effect),
 *  useState 초기화식에서 바로 읽으면 서버 렌더(0 배열)와 어긋나 hydration이 깨진다.
 *  useSyncExternalStore가 이 둘을 동시에 푸는 자리다 — 서버·hydration은 기본값을 쓰고,
 *  붙은 뒤에 저장값으로 한 번 다시 그린다.
 *  🚨 스냅샷은 **같은 참조**를 돌려줘야 무한 렌더가 안 난다 — 칸 수별로 캐시한다. */
const defaults = new Map<PaneKind, PaneW>()
const current = new Map<PaneKind, PaneW>()
const loaded = new Set<PaneKind>()
const listeners = new Set<() => void>()

function defaultOf(kind: PaneKind): PaneW {
  let d = defaults.get(kind)
  if (!d) { d = paneWDefault(kind); defaults.set(kind, d) }
  return d
}

export function subscribePaneW(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getPaneWSnapshot(kind: PaneKind): PaneW {
  if (!loaded.has(kind)) {
    loaded.add(kind)
    try { current.set(kind, parsePaneW(window.localStorage.getItem(PANE_W_KEY), kind) ?? defaultOf(kind)) }
    catch { current.set(kind, defaultOf(kind)) }
  }
  return current.get(kind) ?? defaultOf(kind)
}

/** 서버 렌더·hydration용 — 항상 기본값이라 마크업이 어긋나지 않는다 */
export function getPaneWServerSnapshot(kind: PaneKind): PaneW {
  return defaultOf(kind)
}

export function writePaneW(kind: PaneKind, next: PaneW): void {
  current.set(kind, next)
  loaded.add(kind)
  try {
    // 다른 구성의 저장값은 **보존한다** — ④에서 폭을 맞췄다고 ①의 폭이 초기화되면 안 된다
    const raw = window.localStorage.getItem(PANE_W_KEY)
    let all: Record<string, unknown> = {}
    try {
      const p: unknown = JSON.parse(raw ?? '{}')
      if (p && typeof p === 'object' && !Array.isArray(p)) all = p as Record<string, unknown>
    } catch { /* 깨진 값은 버린다 */ }
    all[kind] = next
    window.localStorage.setItem(PANE_W_KEY, JSON.stringify(all))
  } catch { /* 저장 실패는 화면 동작과 무관 */ }
  listeners.forEach(cb => cb())
}
