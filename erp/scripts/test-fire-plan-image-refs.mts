/** 소방계획서 **그림 배정 규칙** 검사 — 어느 사진이 어느 자리에 인쇄되는가 (2026-09-14)
 *
 *  이 축의 규칙은 어제까지 `assembleFirePlan` 한가운데에서 DB·스토리지 왕복과 섞여 있었고,
 *  그래서 **아무도 단언하지 못했다.** 이 파일이 겨누는 결함은 그 틈으로 샌 것이다:
 *
 *    「진입 경로도 바탕을 표지 건물 사진으로」를 **버튼**으로만 만들었다. 누르기 전에는 아무것도
 *    바뀌지 않으므로 기존 고객 전부가 옛 주행경로 지도(또는 공란)로 남았다 — 사용자가 본 것이 그것이다.
 *    이제 **제 경로도가 없으면 표지 사진이 곧 진입 경로도다**(대역).
 *
 *  ⭐ 판정축은 「route 자리가 찼는가」가 아니라 **「거기 있는 것이 표지와 같은 파일인가」**다.
 *    자리만 물으면 엉뚱한 사진을 넣어도 초록이다.
 *  ⭐ 대역은 **물러날 줄 알아야** 규칙이다 — 양성(표지가 선다)과 음성(제 그림이 있으면 안 선다)을 짝으로 묻는다.
 *
 *  의존 0 — 서버도 DB도 템플릿 바이트도 필요 없다.
 *  실행: npx tsx scripts/test-fire-plan-image-refs.mts
 */
import {
  planFirePlanImageRefs, firePlanImageCandidates, collectFirePlanImages, isRetiredRouteDraft,
  PRIORITY_SLOT, PRIORITY_FORM, PRIORITY_PHOTO, PRIORITY_FALLBACK, PRIORITY_RETIRED,
  type ImageRefInput,
} from '../src/lib/fire-plan-image-refs.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const COVER = 'cust-1/assets/cover.jpg'
const MAP_SLOT = 'cust-1/assets/map_location.png'
/** 사람이 올린 경로도 — `route-` 접두어가 없는 것이 자동 초안과 갈리는 지점이다([2-1] 참조).
 *  처음엔 여기에 `route-<숫자>`를 적었다가 [2-1]을 넣자마자 [2]가 빨강이 됐다 — 표본이 규칙을 배반한 것이고,
 *  스위트가 제 표본을 물어 준 셈이다. */
const ROUTE_OWN = 'cust-1/plan-assets/1757000000000.png'

/** 표지만 등록된 고객 — 실무에서 압도적으로 흔한 모양(경로도는 아무도 안 만들어 뒀다) */
const base: ImageRefInput = {
  slotAssets: [{ slot: 'cover', path: COVER }],
  sections: {},
  photos: [],
}
const pathsOf = (input: ImageRefInput, kind: string) =>
  planFirePlanImageRefs(input).filter(r => r.kind === kind).map(r => r.path)

console.log('\n[1] 대역 — 제 경로도가 없으면 표지 건물 사진이 진입 경로도가 된다')
{
  // 전제부터 단언한다 — 표본에 제 경로도가 없어야 이 절이 재는 것이 대역이다.
  // (있는 표본으로 재면 아래 단언들이 '대역 없음' 변이도 통과한다 = 공허 통과)
  check('전제: 표본에 제 경로도가 없다', !base.sections.fireAccess?.routeImage)

  const route = pathsOf(base, 'route')
  check('진입경로 자리가 채워진다', route.length === 1, `${route.length}장`)
  check('거기 있는 것이 표지와 **같은 파일**이다', route[0] === COVER, route[0])

  // 표지 자리는 그대로다 — 대역이 원본을 훔쳐 오는 게 아니라 **같은 것을 함께 가리킨다**
  const cover = pathsOf(base, 'cover')
  check('표지 자리도 그대로 표지 사진이다', cover.length === 1 && cover[0] === COVER)
}

console.log('\n[2] 대역은 물러난다 — 제 그림이 있으면 표지가 그 자리에 안 온다')
{
  const own: ImageRefInput = { ...base, sections: { fireAccess: { routeImage: ROUTE_OWN } } }
  const route = pathsOf(own, 'route')
  check('제 경로도가 이긴다', route.length === 1 && route[0] === ROUTE_OWN, String(route[0]))
  check('표지가 진입경로 자리에 **겹쳐 들어오지 않는다**', !route.includes(COVER))

  // 레거시 삽입 사진(kind route)도 대역보다 위다 — 서열이 규칙이라는 것의 확인
  const legacy: ImageRefInput = { ...base, photos: [{ path: 'cust-1/photos/old.jpg', kind: 'route', caption: '옛 경로도' }] }
  check('레거시 삽입 사진도 대역을 이긴다', pathsOf(legacy, 'route')[0] === 'cust-1/photos/old.jpg')
}

console.log('\n[2-1] 폐지된 자동 초안(주행경로 지도)은 「제 그림」이 아니다')
{
  // 사용자 확정(2026-09-14): 진입 경로도는 **주행경로 지도가 아니다**. 그런데 [경로도 초안 만들기]로
  // 이미 만들어 둔 고객이 있고(스테이징 8명 중 2명), 그걸 제 그림으로 치면 그 고객만 영영 옛 지도로 남는다.
  const DRAFT = 'cust-1/plan-assets/route-1786171322779.png'
  const drafted: ImageRefInput = { ...base, sections: { fireAccess: { routeImage: DRAFT } } }
  check('전제: 그 경로가 자동 초안으로 판정된다', isRetiredRouteDraft(DRAFT))
  check('표지가 있으면 자동 초안을 밀어낸다', pathsOf(drafted, 'route')[0] === COVER, String(pathsOf(drafted, 'route')[0]))
  check('밀어낸 자리에 옛 지도가 겹쳐 남지 않는다', pathsOf(drafted, 'route').length === 1)

  // 표지가 없으면 그래도 옛 지도를 인쇄한다 — 백지보다 낫다(대역보다 아래일 뿐 버리는 게 아니다)
  const draftedNoCover: ImageRefInput = { slotAssets: [], sections: { fireAccess: { routeImage: DRAFT } }, photos: [] }
  check('표지가 없으면 자동 초안이라도 인쇄한다', pathsOf(draftedNoCover, 'route')[0] === DRAFT)

  // 🚨 사람 손이 닿은 것은 건드리지 않는다 — 이름으로 가르는 규칙이라 경계를 못 박아 둔다
  check('업로드한 그림은 초안이 아니다', !isRetiredRouteDraft('cust-1/plan-assets/1789373797252.png'))
  check('표지에서 가져온 바탕은 초안이 아니다', !isRetiredRouteDraft('cust-1/plan-assets/route-cover-1789373797252.png'))
  check('화살표 합성본(업로드 이름)은 초안이 아니다', !isRetiredRouteDraft('cust-1/plan-assets/1789373797300.jpg'))
  const annotated: ImageRefInput = {
    ...base,
    sections: { fireAccess: { routeImage: 'cust-1/plan-assets/1789373797300.png' } },
  }
  check('화살표를 얹은 그림은 표지가 있어도 안 밀린다',
    pathsOf(annotated, 'route')[0] === 'cust-1/plan-assets/1789373797300.png')
}

console.log('\n[3] 표지가 없는 고객 — 없는 것을 지어내지 않는다')
{
  const noCover: ImageRefInput = { slotAssets: [], sections: {}, photos: [] }
  check('진입경로 자리가 빈다', pathsOf(noCover, 'route').length === 0)
  check('빈 경로가 후보로도 안 올라온다', firePlanImageCandidates(noCover).length === 0)

  // ⭐ 대역은 **표지**여야 한다 — 「슬롯에 뭐라도 있으면 그걸 쓴다」가 아니다.
  //   약도만 등록한 고객이 흔한데, 그 약도가 진입 경로도 자리에 앉으면 어제의 결함으로 되돌아간다
  //   (사용자가 「주행경로 지도 말고 항공사진」이라고 확정한 바로 그 갈래다).
  const mapOnly: ImageRefInput = { slotAssets: [{ slot: 'map_location', path: MAP_SLOT }], sections: {}, photos: [] }
  check('약도만 있는 고객은 진입경로 자리가 빈다(약도를 대역으로 쓰지 않는다)',
    pathsOf(mapOnly, 'route').length === 0, pathsOf(mapOnly, 'route').join(','))

  // 표지가 **목록 앞머리가 아닐 때도** 표지를 골라야 한다 — 스토리지 정렬은 이름순이라 실제로 이 순서다
  const mapFirst: ImageRefInput = {
    slotAssets: [{ slot: 'map_location', path: MAP_SLOT }, { slot: 'cover', path: COVER }],
    sections: {}, photos: [],
  }
  check('표지가 뒤에 있어도 대역은 표지다', pathsOf(mapFirst, 'route')[0] === COVER, String(pathsOf(mapFirst, 'route')[0]))
}

console.log('\n[4] 서열 — 대역이 가장 아래다')
{
  check('폐지초안 < 대역 < 삽입 사진 < 서식 < 슬롯',
    PRIORITY_SLOT < PRIORITY_FORM && PRIORITY_FORM < PRIORITY_PHOTO
    && PRIORITY_PHOTO < PRIORITY_FALLBACK && PRIORITY_FALLBACK < PRIORITY_RETIRED,
    `${PRIORITY_SLOT}·${PRIORITY_FORM}·${PRIORITY_PHOTO}·${PRIORITY_FALLBACK}·${PRIORITY_RETIRED}`)
  const c = firePlanImageCandidates(base).find(r => r.kind === 'route')
  check('대역 후보가 그 서열을 달고 나온다', c?.priority === PRIORITY_FALLBACK)
}

console.log('\n[5] 선재 규칙 무손상 — 대역을 들이면서 종전 규칙을 깨지 않았다')
{
  const both: ImageRefInput = {
    slotAssets: [{ slot: 'map_location', path: MAP_SLOT }],
    sections: { location: { mapImage: 'cust-1/plan-assets/map-form.png' } },
    photos: [],
  }
  const map = pathsOf(both, 'map')
  check('위치도는 슬롯·서식 둘 다 있어도 1장(슬롯 승)', map.length === 1 && map[0] === MAP_SLOT, `${map.length}장`)

  const evac: ImageRefInput = {
    slotAssets: [],
    sections: { evacMaps: [{ image: 'a.png', floor: '1층' }, { image: 'b.png', floor: '2층' }] },
    photos: [],
  }
  check('층별 평면도는 여러 장이 다 산다(자리가 1칸이 아니다)', pathsOf(evac, 'evacmap').length === 2)
  check('평면도 설명이 층 이름을 담는다',
    planFirePlanImageRefs(evac).some(r => r.caption === '1층'))

  // ⭐ 「자리가 1칸」 규칙은 **같은 서열에 같은 용도가 둘일 때** 비로소 일한다.
  //   서열이 다르면 위쪽 걸러내기가 먼저 처리해 버려서, 위 표본만으로는 이 규칙이 한 번도 안 돌았다
  //   (그 상태에서 SINGLE_KINDS를 통째로 지워도 스위트가 초록이었다 — 변이가 잡아냈다).
  const twoMaps: ImageRefInput = {
    slotAssets: [], sections: {},
    photos: [
      { path: 'cust-1/photos/m1.jpg', kind: 'map', caption: '약도1' },
      { path: 'cust-1/photos/m2.jpg', kind: 'map', caption: '약도2' },
    ],
  }
  check('같은 서열에 위치도가 둘이면 1장만 인쇄된다', pathsOf(twoMaps, 'map').length === 1,
    `${pathsOf(twoMaps, 'map').length}장`)
  check('그때 남는 것은 먼저 온 쪽이다', pathsOf(twoMaps, 'map')[0] === 'cust-1/photos/m1.jpg')
  // 자리가 1칸이 아닌 용도는 같은 서열에 둘이면 둘 다 산다 — 규칙이 **가려 적용된다**는 확인
  const twoEtc: ImageRefInput = {
    slotAssets: [], sections: {},
    photos: [
      { path: 'cust-1/photos/e1.jpg', kind: 'etc', caption: '' },
      { path: 'cust-1/photos/e2.jpg', kind: 'etc', caption: '' },
    ],
  }
  check('그 밖의 사진은 같은 서열에 둘이면 둘 다 산다', pathsOf(twoEtc, 'etc').length === 2)
}

console.log('\n[6] 바이트 수집 — 한 파일이 두 자리에 실린다')
{
  const hits: string[] = []
  const download = async (p: string) => { hits.push(p); return new Uint8Array([1, 2, 3]) }

  const { images, assets } = await collectFirePlanImages(download, planFirePlanImageRefs(base))
  const kinds = images.map(i => i.kind).sort()
  // 🚨 여기가 조용히 깨지던 자리다 — 종전 수집기는 **경로만** 보고 건너뛰어서,
  //    뒤에 온 진입경로 몫이 사라지고 그 상자가 빈 채로 인쇄됐다.
  check('표지·진입경로 **두 자리**가 다 실린다', kinds.join(',') === 'cover,route', kinds.join(','))
  check('바이트는 한 번만 담는다', assets.length === 1, `${assets.length}개`)
  check('내려받기도 한 번뿐이다', hits.length === 1, `${hits.length}회`)
  check('두 자리가 같은 자산을 가리킨다', new Set(images.map(i => i.file)).size === 1)

  // 진짜 중복(같은 용도·같은 경로)은 여전히 하나로 접힌다
  const dup = await collectFirePlanImages(download, [
    { path: COVER, kind: 'cover', caption: '' }, { path: COVER, kind: 'cover', caption: '' },
  ])
  check('같은 용도의 같은 경로는 한 장', dup.images.length === 1, `${dup.images.length}장`)

  // fail-soft — 한 장이 없어도 나머지는 인쇄된다
  const miss = await collectFirePlanImages(
    async p => (p === COVER ? null : new Uint8Array([9])),
    [{ path: COVER, kind: 'cover', caption: '' }, { path: 'x/y/z.png', kind: 'map', caption: '' }],
  )
  check('한 장이 없어도 나머지는 남는다', miss.images.length === 1 && miss.images[0].kind === 'map')

  // 이미지가 아닌 확장자는 조용히 빠진다(서식이 깨지지 않게)
  const bad = await collectFirePlanImages(download, [{ path: 'a/b/c.pdf', kind: 'map', caption: '' }])
  check('이미지가 아닌 파일은 안 싣는다', bad.images.length === 0)
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
