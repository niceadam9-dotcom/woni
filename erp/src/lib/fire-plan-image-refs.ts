/**
 * 소방계획서에 **어느 그림이 어느 자리에 인쇄되는가** — 그 규칙만 담은 순수 함수 (2026-09-14 분리).
 *
 * 종전엔 이 규칙이 `assembleFirePlan` 한가운데에 DB·스토리지 왕복과 섞여 있어 **아무도 단언할 수 없었다**.
 * 그림 축의 결함이 두 번(엑셀 사진 0장·진입 경로도) 검사 밖에서 샌 경로가 그것이다.
 * 여기엔 import가 없다 — `server-only` 표식에 걸리지 않으므로 검사가 그대로 부른다.
 *
 * ## 규칙 (소방계획서_11 §13-B)
 *  ① 한 용도(kind)는 **가장 상위 출처만** 인쇄한다 — 종전엔 출처별로 쌓기만 해서 같은 그림이 2장 나왔다.
 *  ② `cover`·`map`은 그 출처 안에서도 **1장만**(문서에 자리가 한 칸뿐이라).
 *  ③ 제 그림이 하나도 없는 자리에는 **대역(代役)**을 세울 수 있다 — 지금은 진입 경로도 한 자리뿐이다.
 */

/** 출처의 서열 — 숫자가 작을수록 이긴다 */
export const PRIORITY_SLOT = 1      // [지도·사진] 슬롯 자산 (자동 생성·붙여넣기를 가진 단일 원천)
export const PRIORITY_FORM = 2      // 서식 입력 이미지 (1.3 경로도·1.5 평면도 …)
export const PRIORITY_PHOTO = 3     // 삽입 사진 (레거시)
/** 제 그림이 **하나도 없을 때만** 서는 대역 — 위 어느 출처든 있으면 그쪽이 이긴다 */
export const PRIORITY_FALLBACK = 4
/** **폐지된 자동 초안** — 대역보다도 아래다. 표지가 있으면 밀려나고, 없으면 그래도 인쇄된다(백지보다 낫다) */
export const PRIORITY_RETIRED = 5

/**
 * 이 경로가 **[경로도 초안 만들기]가 자동 생성한 주행경로 지도**인가 (2026-09-14 사용자 확정으로 폐지).
 *
 * 진입 경로도는 소방서→건물 **주행경로 지도**가 아니라 표지와 같은 **위성 항공사진** 위에 진입 방향을
 * 표시한 그림이라야 한다. 그런데 그 주행경로 지도를 이미 만들어 둔 고객이 있고(스테이징 8명 중 2명),
 * 그것을 「사용자가 고른 제 그림」으로 치면 그 고객들만 **영영 옛 지도로 남는다**.
 *
 * 🚨 **판정은 파일 이름으로 한다** — 자동 생성기만 `route-<타임스탬프>.<ext>`를 쓰기 때문이다
 *   (`generateRouteImageAction`). 사람이 올린 그림은 `<타임스탬프>.<ext>`,
 *   표지에서 가져온 바탕은 `route-cover-<타임스탬프>.<ext>`라 여기 안 걸린다.
 *   화살표를 얹은 합성본도 업로드 이름이라 안 걸린다 — **사람의 손이 닿은 것은 존중한다**.
 */
export function isRetiredRouteDraft(path: string | null | undefined): boolean {
  return !!path && /(^|\/)route-\d+\.[a-z0-9]+$/i.test(path)
}

/** 문서에서 자리가 1칸인 용도 */
const SINGLE_KINDS = new Set(['cover', 'map'])

export type ImageRef = { path: string; kind: string; caption: string }
type Scored = ImageRef & { priority: number }

export type ImageRefInput = {
  /** [지도·사진] 슬롯 — `cover` / `map_location` / `evac_*` */
  slotAssets: Array<{ slot: string; path: string }>
  sections: {
    location?: { mapImage?: string | null } | null
    fireAccess?: { routeImage?: string | null; entryImage?: string | null } | null
    evacMaps?: Array<{ image?: string | null; floor?: string; desc?: string }> | null
    evacPlan?: { mapImage?: string | null } | null
    /** 1.11.4 뒷쪽 훈련·교육 사진 (2026-09-18) — 1.11 카드가 소유·저장한다 */
    training?: { photos?: Array<{ path?: string | null; kind?: string; caption?: string }> | null } | null
    /** 1.14.2 홍보 결과 증빙 사진 (2026-09-18) — 1.12~1.15 카드가 소유·저장한다 */
    promoPhotos?: Array<{ path?: string | null; caption?: string }> | null
  }
  /** 삽입 사진 — 경로가 있는 것만 (호출부가 이미 걸러 온다) */
  photos: Array<ImageRef>
}

/** 서열을 매기기 전의 후보 전부 — 규칙 ①②를 적용하기 **전** 상태다(검사가 중간을 볼 수 있게 열어 둔다) */
export function firePlanImageCandidates({ slotAssets, sections, photos }: ImageRefInput): Scored[] {
  const refs: Scored[] = []
  for (const a of slotAssets) {
    const kind = a.slot === 'cover' ? 'cover' : a.slot === 'map_location' ? 'map' : 'evacuation'
    refs.push({ path: a.path, kind, caption: '', priority: PRIORITY_SLOT })
  }
  const s = sections
  if (s.location?.mapImage) refs.push({ path: s.location.mapImage, kind: 'map', caption: '위치도', priority: PRIORITY_FORM })
  if (s.fireAccess?.routeImage) {
    // 폐지된 자동 초안은 대역보다 아래로 내린다 — 표지가 있으면 밀려나고, 없으면 그래도 인쇄된다
    const priority = isRetiredRouteDraft(s.fireAccess.routeImage) ? PRIORITY_RETIRED : PRIORITY_FORM
    refs.push({ path: s.fireAccess.routeImage, kind: 'route', caption: '소방차 진입경로', priority })
  }
  // 2026-09-14 — 법정 서식 1.3 아래쪽 상자용 사진. 종전엔 이 자리를 채울 입력 자체가 없었다.
  if (s.fireAccess?.entryImage) {
    refs.push({ path: s.fireAccess.entryImage, kind: 'entry', caption: '소방차 진입장소 및 주변 소방시설 현황', priority: PRIORITY_FORM })
  }
  for (const m of s.evacMaps ?? []) {
    if (m.image) refs.push({ path: m.image, kind: 'evacmap', caption: [m.floor, m.desc].filter(Boolean).join(' — '), priority: PRIORITY_FORM })
  }
  if (s.evacPlan?.mapImage) refs.push({ path: s.evacPlan.mapImage, kind: 'evacuation', caption: '피난경로도', priority: PRIORITY_FORM })
  /* 1.11.4 뒷쪽 훈련·교육 사진 (2026-09-18) — 서식 입력이라 `PRIORITY_FORM`이다.
   * `kind`는 상자가 요구하는 어휘(`train`·`edu`)이고, 다른 상자는 이 종류를 안 받으므로
   * 서열 경쟁이 없다(1.3·1.5.2 상자와 섞이지 않는다). 순서가 곧 index 0·1이다. */
  for (const p of s.training?.photos ?? []) {
    if (p?.path && (p.kind === 'train' || p.kind === 'edu')) {
      refs.push({ path: p.path, kind: p.kind, caption: p.caption ?? '', priority: PRIORITY_FORM })
    }
  }
  /* 1.14.2 홍보 결과 증빙 2장 — 종류가 하나뿐이라 `kind`를 저장하지 않고 여기서 붙인다 */
  for (const p of s.promoPhotos ?? []) {
    if (p?.path) refs.push({ path: p.path, kind: 'promo', caption: p.caption ?? '', priority: PRIORITY_FORM })
  }
  for (const p of photos) refs.push({ ...p, priority: PRIORITY_PHOTO })

  // ③ **진입 경로도의 기본 바탕은 표지 건물 사진이다** (2026-09-14 사용자 확정).
  //
  // 종전엔 서식 1.3의 [표지 사진 가져오기]를 눌러야만 그렇게 됐다. 그 수동 축은 **기존 고객 전부를**
  // 옛 주행경로 지도(또는 공란)로 남겨 두었고, "여전히 표지와 다르다"는 지적이 바로 그 상태였다.
  // 대역은 복사본을 만들지 않고 표지 원본을 그대로 가리킨다 — 백필도, 고아 파일도, 마이그레이션도 없다.
  // 화살표를 얹으면 그 합성본이 PRIORITY_FORM으로 들어와 대역을 밀어낸다(서열이 곧 그 규칙이다).
  const cover = slotAssets.find(a => a.slot === 'cover')?.path
  if (cover) refs.push({ path: cover, kind: 'route', caption: '소방차 진입경로', priority: PRIORITY_FALLBACK })

  return refs
}

/** 실제로 인쇄될 그림 목록 — 규칙 ①②를 적용한 결과 */
export function planFirePlanImageRefs(input: ImageRefInput): ImageRef[] {
  const refs = firePlanImageCandidates(input)
  const best = new Map<string, number>()
  for (const r of refs) best.set(r.kind, Math.min(best.get(r.kind) ?? 99, r.priority))
  const taken = new Set<string>()
  return refs
    .filter(r => r.priority === best.get(r.kind))
    .filter(r => {
      if (!SINGLE_KINDS.has(r.kind)) return true
      if (taken.has(r.kind)) return false
      taken.add(r.kind)
      return true
    })
    .map(({ path, kind, caption }) => ({ path, kind, caption }))
}

// ── 바이트 수집 ───────────────────────────────────────────────────────────────

export type FirePlanAsset = { name: string; data: Uint8Array; mime: string }
export type FirePlanImageRef = { file: string; kind: string; caption: string }

const IMG_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

/**
 * 목록의 그림을 실제 바이트로 바꾼다 — 실패 항목은 건너뛴다(fail-soft: 한 장 때문에 문서를 막지 않는다).
 *
 * 스토리지를 모른다(`download` 주입) — 그래서 DB·서버 없이 그대로 단언할 수 있다.
 *
 * 🚨 **중복의 단위는 경로가 아니라 (용도, 경로)다.** 종전엔 경로만 보고 건너뛰었는데,
 * 한 장이 **두 자리에 인쇄되어야 하는 갈래**가 생겼다 — 표지 건물 사진이 진입 경로도의
 * 기본 바탕이다(2026-09-14). 경로로만 거르면 **뒤에 온 진입경로 몫이 조용히 사라져**
 * 그 자리가 빈 채로 나온다. (같은 용도의 중복 인쇄는 위쪽 서열·SINGLE_KINDS가 이미 막는다.)
 *
 * 바이트는 그래도 한 번만 담는다 — 두 자리가 **같은 자산 이름을 가리키게** 해 문서가 무거워지지 않는다.
 */
export async function collectFirePlanImages(
  download: (path: string) => Promise<Uint8Array | null>,
  refs: ImageRef[],
): Promise<{ images: FirePlanImageRef[]; assets: FirePlanAsset[] }> {
  const images: FirePlanImageRef[] = []
  const assets: FirePlanAsset[] = []
  const seen = new Set<string>()             // 같은 (용도, 경로) — 진짜 중복
  const fileOf = new Map<string, string>()   // 경로 → 이미 담아 둔 자산 이름
  let i = 0
  for (const r of refs) {
    const path = r.path?.trim()
    if (!path) continue
    const key = `${r.kind}|${path}`
    if (seen.has(key)) continue
    seen.add(key)
    const already = fileOf.get(path)
    if (already) { images.push({ file: already, kind: r.kind, caption: r.caption }); continue }
    const ext = (path.split('.').pop() ?? '').toLowerCase()
    const mime = IMG_MIME[ext]
    if (!mime) continue
    try {
      const data = await download(path)
      if (!data) continue
      const file = `img_${i++}.${ext}`
      fileOf.set(path, file)
      assets.push({ name: file, data, mime })
      images.push({ file, kind: r.kind, caption: r.caption })
    } catch {
      /* 이미지 1장 실패로 생성을 막지 않음 */
    }
  }
  return { images, assets }
}
