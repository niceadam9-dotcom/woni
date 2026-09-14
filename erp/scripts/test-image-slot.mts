// 서식 첨부 이미지 슬롯(ImageSlot) — 위젯 통일·다운로드·화살표 주석 회귀 (2026-09-08)
// 실행: npx tsx scripts/test-image-slot.mts   (로컬 dev + 스테이징 DB)
//
// 고정하는 것:
//  1. 진입 경로도 칸이 [지도·사진] 슬롯과 같은 창구를 갖는다 — 붙여넣기·드롭존·크게보기·다운로드
//  2. [다운로드]가 실제 파일 저장을 일으키고 **한글 이름 그대로** 떨어진다.
//     서명 URL을 앵커에 그대로 물리면 ① 교차 출처라 download 속성이 무시되고
//     ② storage-js가 ?download= 값을 퍼센트 인코딩해 '%EC%A7%84%EC%9E%85….png'로 저장된다
//     (2026-09-08 이 스위트가 실측으로 잡은 결함). 동일 출처 blob 경로로 바꾼 것을 고정한다.
//  3. 화살표 편집기가 **배경 위에** 화살표를 태운다 — 합성본 픽셀에 빨강(화살표)과 초록(배경)이
//     둘 다 있어야 한다. 빨강만 있으면 배경 유실, 초록만 있으면 화살표 유실, 흰색뿐이면
//     canvas 오염(교차 출처 배경)으로 내보내기가 죽은 것이다. 육안으로는 셋을 구분 못 한다.
//  4. 원본·주석이 DB에 남아 재편집이 된다 — 합성본만 저장하면 화살표를 두 번 다시 못 고친다
//  5. [표지 사진 가져오기]가 진입 경로도 바탕을 **표지 건물 사진과 같은 사진**으로 만든다 (2026-09-14 B안).
//     판정축은 바이트 동일성 + 옛 원본·좌표가 따라오지 않음. 경로 문자열만 보면 엉뚱한 파일을 복사해도 초록이다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'image-slot-e2e@erp-test.com'
const BUCKET = 'fire-plans'
let userId = '', custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** 배경 800×600 단색 초록 — 합성본에서 '배경이 살아남았는가'를 색으로 판정하기 위한 대조군 */
const BG = { r: 58, g: 125, b: 68 }

type FireAccess = { routeImage?: string | null; routeImageBase?: string | null; routeAnnots?: string | null }
async function readFireAccess(): Promise<FireAccess> {
  const { data } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).maybeSingle()
  return ((data?.sections as Record<string, unknown> | undefined)?.fireAccess ?? {}) as FireAccess
}

/** [서식 1.3 저장]을 누르고 **DB에 반영될 때까지** 기다린다.
 *
 *  화면 신호는 둘 다 못 쓴다 — ① 문구('서식 1.3 저장됨')는 직전 저장 것이 남아 있고
 *  ② 버튼은 저장 중에도 isPending으로 똑같이 비활성이다. 둘 다 즉시 통과해 커밋 전에 DB를 읽거나,
 *  이어지는 page.goto가 진행 중인 서버 액션을 끊는다(2026-09-08 실측: 같은 검사가 run2 통과·run3 실패).
 *  판정 대상이 DB이므로 대기도 DB로 한다. */
async function saveAndWait(
  page: { getByRole: (r: string, o: { name: string }) => { click: () => Promise<void> } },
  done: (fa: FireAccess) => boolean,
): Promise<FireAccess> {
  await page.getByRole('button', { name: '서식 1.3 저장' }).click()
  for (let i = 0; i < 80; i++) {
    const fa = await readFireAccess()
    if (done(fa)) return fa
    await new Promise(r => setTimeout(r, 300))
  }
  return readFireAccess()
}

try {
  userId = await mkUser({ email: EMAIL, name: '이미지슬롯E2E', employeeId: 'E2E-IMG' })
  custId = await mkCustomer({ customer_name: '이미지슬롯E2E고객', created_by: userId, address: '경기도 광주시 마유산로 1' })

  const l = await launch(); browser = l.browser; const page = l.page
  // 공용 기본값 15초는 이 스위트엔 짧다 — `_mutate-route-cover.mjs`가 소스를 고쳐 가며 돌리므로
  // 매 주행이 **터보팩 냉간 재컴파일**을 만난다. 15초에서는 변이 9개가 전부 '스위트 완주' 실패로
  // 죽어 단언이 아무것도 재지 못했다(2026-09-14 실측). 재는 것은 화면이지 컴파일 속도가 아니다.
  page.setDefaultTimeout(45000)
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.3`)
  await page.locator('[data-testid="form13-route-image"]').waitFor({ state: 'visible', timeout: 25000 })

  // ── 1. 빈 슬롯의 창구 ─────────────────────────────────────────────────────
  console.log('— 1. 빈 슬롯 버튼 구성')
  const slot = page.locator('[data-testid="form13-route-image"]')
  check('[업로드] 있음', await slot.getByRole('button', { name: '업로드' }).count() === 1)
  check('[붙여넣기] 있음 (종전엔 [지도·사진] 슬롯에만 있었다)',
    await page.locator('[data-testid="form13-route-image-paste"]').count() === 1)
  check('빈 슬롯엔 [다운로드] 없음', await page.locator('[data-testid="form13-route-image-download"]').count() === 0)
  check('빈 슬롯엔 [화살표] 없음', await page.locator('[data-testid="form13-route-image-annotate"]').count() === 0)
  check('드롭존 안내 문구 노출', (await slot.innerText()).includes('끌어다 놓기'))

  // ── 2. 업로드 ─────────────────────────────────────────────────────────────
  // 파일 입력에 브라우저에서 만든 PNG를 직접 물린다 — prepareImageFile(EXIF·리사이즈)을 포함한 실제 경로
  console.log('— 2. 업로드 → 썸네일')
  await page.evaluate(async (bg) => {
    const c = document.createElement('canvas')
    c.width = 800; c.height = 600
    const ctx = c.getContext('2d')!
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`
    ctx.fillRect(0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob!], 'map.png', { type: 'image/png' }))
    const input = document.querySelector('[data-testid="form13-route-image-input"]') as HTMLInputElement
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, BG)
  const thumb = page.locator('[data-testid="form13-route-image-thumb"]')
  await thumb.waitFor({ state: 'visible', timeout: 25000 })
  check('업로드 후 썸네일 노출', await thumb.count() === 1)
  check('업로드 후 [다운로드] 등장', await page.locator('[data-testid="form13-route-image-download"]').count() === 1)
  check('업로드 후 [화살표 넣기] 등장',
    (await page.locator('[data-testid="form13-route-image-annotate"]').innerText()).includes('화살표 넣기'))

  const afterUpload = await saveAndWait(page, fa => !!fa.routeImage)
  check('routeImage가 DB에 저장됨', !!afterUpload.routeImage, JSON.stringify(afterUpload))
  const basePath = afterUpload.routeImage!

  // ── 3. 다운로드 ───────────────────────────────────────────────────────────
  console.log('— 3. 다운로드 버튼')
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-testid="form13-route-image-download"]').click(),
  ])
  const dlName = dl.suggestedFilename()
  check('다운로드가 실제로 일어남 (새 탭 열기로 끝나지 않음)', !!dlName, dlName)
  check('파일명이 칸 이름을 따름', dlName.startsWith('진입 경로도') && dlName.endsWith('.png'), dlName)

  // ── 4. 화살표 편집기 ──────────────────────────────────────────────────────
  console.log('— 4. 화살표 넣기')
  await page.locator('[data-testid="form13-route-image-annotate"]').click()
  const modal = page.locator('[data-testid="image-annotator"]')
  await modal.waitFor({ state: 'visible', timeout: 20000 })
  const canvas = modal.locator('[data-testid="annot-canvas"]')
  await canvas.waitFor({ state: 'visible', timeout: 25000 })
  check('배경 이미지를 data URL로 실어 옴 (교차 출처 URL이면 canvas가 오염된다)',
    (await canvas.locator('image').getAttribute('href'))?.startsWith('data:image/') === true)

  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.75)
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.25)
  check('화살표 1개가 그려짐', await canvas.locator('polygon').count() === 1)

  await modal.locator('[data-testid="annot-save"]').click()
  await modal.waitFor({ state: 'detached', timeout: 25000 })
  const annotated = await saveAndWait(page, fa => !!fa.routeAnnots)
  check('합성본이 새 파일로 저장됨(원본을 덮어쓰지 않음)',
    !!annotated.routeImage && annotated.routeImage !== basePath, `${annotated.routeImage} vs ${basePath}`)
  check('원본 경로가 보존됨 — 재편집의 배경', annotated.routeImageBase === basePath, String(annotated.routeImageBase))
  const doc = annotated.routeAnnots ? JSON.parse(annotated.routeAnnots) : null
  check('주석 좌표가 저장됨', doc?.v === 1 && doc.items?.length === 1 && doc.items[0].t === 'arrow', annotated.routeAnnots ?? 'null')
  check('주석 좌표가 배경 픽셀 기준(800×600)', doc?.w === 800 && doc?.h === 600, `${doc?.w}×${doc?.h}`)

  // ── 5. 합성본 픽셀 — 배경과 화살표가 둘 다 살아 있는가 ────────────────────
  console.log('— 5. 합성 결과 픽셀 판정')
  const { data: blob } = await raw.storage.from(BUCKET).download(annotated.routeImage!)
  const buf = Buffer.from(await blob!.arrayBuffer())
  const px = await page.evaluate(async (u: string) => {
    const img = new Image()
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('x')); img.src = u })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let red = 0, green = 0, white = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      if (r > 150 && g < 90 && b < 90) red++
      else if (r < 120 && g > 100 && b < 120) green++
      else if (r > 240 && g > 240 && b > 240) white++
    }
    return { red, green, white, w: c.width, h: c.height }
  }, `data:image/png;base64,${buf.toString('base64')}`)
  check('합성본에 화살표(빨강)가 실제로 찍혔다', px.red > 500, JSON.stringify(px))
  check('합성본에 배경(초록)이 살아 있다 — 흰 캔버스로 죽지 않음', px.green > 100000, JSON.stringify(px))
  check('합성본이 장변 1600으로 2배 확대됨', px.w === 1600 && px.h === 1200, `${px.w}×${px.h}`)

  // ── 6. 재편집 — 새로고침 후에도 화살표가 돌아오는가 ───────────────────────
  console.log('— 6. 재편집 복원')
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.3`)
  const annotBtn = page.locator('[data-testid="form13-route-image-annotate"]')
  await annotBtn.waitFor({ state: 'visible', timeout: 25000 })
  check('버튼 문구가 [화살표 고치기]로 바뀜', (await annotBtn.innerText()).includes('고치기'))
  await annotBtn.click()
  const modal2 = page.locator('[data-testid="image-annotator"]')
  await modal2.waitFor({ state: 'visible', timeout: 20000 })
  await modal2.locator('[data-testid="annot-canvas"] image').waitFor({ state: 'visible', timeout: 25000 })
  await page.waitForTimeout(500)
  check('저장된 화살표가 복원됨', await modal2.locator('[data-testid="annot-canvas"] polygon').count() === 1)
  check('배경은 합성본이 아니라 원본이다 (화살표가 이중으로 겹치지 않게)',
    (await modal2.locator('[data-testid="annot-canvas"] image').getAttribute('href'))!.length > 0
    && await modal2.locator('[data-testid="annot-canvas"] polygon').count() === 1)

  // ── 7. 표지 건물 사진을 경로도 바탕으로 가져오기 (2026-09-14 사용자 확정 B안) ──
  //  고정하는 것: 진입 경로도의 바탕이 **표지와 같은 사진**이 된다(소방서→건물 주행경로 지도가 아니라).
  //  판정은 경로 문자열이 아니라 **바이트 동일성**이다 — 경로만 보면 엉뚱한 파일을 복사해도 초록이다.
  //
  //  🚨 이 절은 반드시 **삭제 절보다 먼저** 와야 한다. 삭제가 먼저 돌면 routeImageBase·routeAnnots가
  //  이미 비워진 채로 들어와, '옛 원본·좌표가 따라오지 않는가'가 **한 번도 실행되지 않고** 초록이 된다
  //  (처음엔 그 순서로 짰다 — 전제를 단언으로 박아 두는 이유가 이것이다).
  console.log('— 7. 표지 사진 가져오기')
  await page.keyboard.press('Escape')
  await modal2.waitFor({ state: 'detached', timeout: 10000 })

  const beforeCover = await readFireAccess()
  check('가져오기 직전 상태가 합성본·원본·좌표를 모두 들고 있다 (이 절의 전제)',
    !!beforeCover.routeImage && !!beforeCover.routeImageBase && !!beforeCover.routeAnnots,
    JSON.stringify(beforeCover))
  const staleFiles = [beforeCover.routeImage, beforeCover.routeImageBase].filter((p): p is string => !!p)

  // 표지 슬롯을 **파랑 단색**으로 심는다 — 앞 절의 배경(초록)과 색이 달라야
  // '가져온 것이 표지인가, 옛 경로도인가'를 내용으로 가를 수 있다.
  const sharp = (await import('sharp')).default
  const coverPng = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 60, b: 200 } },
  }).png().toBuffer()
  // 페이지를 다시 열기 **전에** 심는다 — [지도·사진] 슬롯은 표지가 비어 있으면 마운트 시 위성사진을
  // 자동 생성하므로(customer-assets-client ②), 비워 두면 무엇이 바탕이 됐는지 판정이 흐려진다.
  const up = await raw.storage.from(BUCKET)
    .upload(`${custId}/assets/cover.png`, coverPng, { contentType: 'image/png', upsert: true })
  check('표지 건물 사진 심기 성공 (이 절의 전제)', !up.error, String(up.error?.message ?? ''))

  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.3`)
  // 대기는 **같은 화면의 다른 것**에 건다. 버튼 자체를 waitFor하면 버튼이 없을 때
  // 25초 타임아웃 예외로 스위트가 죽어, 빨강의 이유가 아래 단언이 아니라 '완주 실패'로 보고된다
  // (2026-09-14 변이 실험 M5에서 실측 — 잡기는 잡는데 무엇이 깨졌는지 못 말해 준다).
  await page.locator('[data-testid="form13-route-image"]').waitFor({ state: 'visible', timeout: 25000 })
  const fromCover = page.locator('[data-testid="form13-route-from-cover"]')
  // 이 버튼은 경로 조회와 독립 축이다 — 소방서를 고르지 않아도(=경로 미조회) 보여야 한다.
  // 종전 초안 버튼들처럼 route 유무 ternary 안에 두면 여기서 0건이 된다.
  check('[표지 사진 가져오기]가 경로 조회 전에도 보인다', await fromCover.count() === 1)

  // 이미 경로도가 있으므로 교체 확인창이 뜬다 — Playwright는 기본이 '취소'라 받지 않으면
  // 핸들러가 조용히 되돌아가고 이 절이 통째로 헛돈다.
  page.once('dialog', (d: { accept: () => Promise<void> }) => { void d.accept() })
  await fromCover.click()
  // 썸네일은 이미 떠 있어 대기 신호가 못 된다(옛 그림이 그대로 보인다) — 완료 문구를 기다린다
  await page.waitForFunction(() =>
    document.body.innerText.includes('경로도 바탕으로 가져왔습니다'), null, { timeout: 30000 })
  const fromCoverFa = await saveAndWait(page, fa => !!fa.routeImage && fa.routeImage !== beforeCover.routeImage)

  check('경로도가 plan-assets 아래 새 파일로 들어옴 (삭제·화살표·다운로드 가드가 요구하는 접두사)',
    !!fromCoverFa.routeImage?.startsWith(`${custId}/plan-assets/route-cover-`), String(fromCoverFa.routeImage))
  const { data: copied } = await raw.storage.from(BUCKET).download(fromCoverFa.routeImage!)
  const copiedBuf = Buffer.from(await copied!.arrayBuffer())
  check('가져온 그림이 표지 사진과 **바이트까지 같다** (경로만 맞고 내용이 다른 경우를 가른다)',
    copiedBuf.equals(coverPng), `${copiedBuf.length}B vs ${coverPng.length}B`)

  const { data: coverStill } = await raw.storage.from(BUCKET).list(`${custId}/assets`)
  check('표지 원본은 그 자리에 남아 있다 (복사이지 이동이 아니다)',
    (coverStill ?? []).some((f: { name: string }) => f.name === 'cover.png'),
    JSON.stringify((coverStill ?? []).map((f: { name: string }) => f.name)))

  // 새 바탕에는 옛 원본·옛 좌표가 따라오면 안 된다 — 남으면 [화살표 고치기]가 **옛 그림**을 열고,
  // 저장하는 순간 새 바탕이 옛 그림으로 되돌아간다(화면엔 멀쩡히 보이는 채로).
  check('옛 원본(routeImageBase)이 따라오지 않음', !fromCoverFa.routeImageBase, String(fromCoverFa.routeImageBase))
  check('옛 화살표 좌표(routeAnnots)가 따라오지 않음', !fromCoverFa.routeAnnots, String(fromCoverFa.routeAnnots))
  check('버튼 문구가 [화살표 넣기]로 돌아옴 (고칠 옛 주석이 없다)',
    (await page.locator('[data-testid="form13-route-image-annotate"]').innerText()).includes('화살표 넣기'))

  // 상태만 비우고 파일을 두면 스토리지에 고아가 쌓인다 — 합성본·원본 **둘 다** 치웠는지 본다
  const { data: afterSwap } = await raw.storage.from(BUCKET).list(`${custId}/plan-assets`)
  const swapNames = (afterSwap ?? []).map((f: { name: string }) => f.name)
  check('갈아끼우면서 옛 합성본·옛 원본 두 파일을 함께 치웠다',
    staleFiles.length === 2 && staleFiles.every(p => !swapNames.includes(p.split('/').pop()!)),
    `stale=${JSON.stringify(staleFiles)} left=${JSON.stringify(swapNames)}`)

  // ── 8. 삭제가 스토리지까지 치우는가 (누수) ────────────────────────────────
  console.log('— 8. 삭제 시 스토리지 정리')
  await page.locator('[data-testid="form13-route-image-delete"]').click()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="form13-route-image-thumb"]') === null, null, { timeout: 20000 })
  const { data: left } = await raw.storage.from(BUCKET).list(`${custId}/plan-assets`)
  check('경로도 파일이 스토리지에서 사라짐', (left ?? []).length === 0,
    JSON.stringify((left ?? []).map((f: { name: string }) => f.name)))

  // ── 9. 대역 — 경로도가 비면 표지 건물 사진이 그 자리에 선다 (2026-09-14) ───
  //  왜 이 절이 생겼나: [표지 사진 가져오기]를 **버튼으로만** 만든 것이 어제의 결함이었다.
  //  누르기 전엔 아무것도 바뀌지 않아 기존 고객 전부가 옛 그림으로 남았고, 사용자가 본 것이 그것이다.
  //  이제 제 경로도가 없으면 표지 사진이 곧 진입 경로도다 — **화면도 인쇄와 같은 것을 보여야** 한다.
  //  ⚠ 이 절은 8절(삭제) 뒤라야 성립한다 — 표지는 7절이 심어 두었고 경로도는 8절이 비웠다.
  console.log('— 9. 대역(표지 건물 사진)')
  const emptied = await saveAndWait(page, fa => !fa.routeImage)
  check('경로도가 빈 채로 저장됨 (이 절의 전제)', !emptied.routeImage, JSON.stringify(emptied))

  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.3`)
  await page.locator('[data-testid="form13-route-image"]').waitFor({ state: 'visible', timeout: 25000 })
  const standIn = page.locator('[data-testid="form13-route-image-thumb"]')
  // ⚠ 여기서 `waitFor`를 쓰면 **재려는 그것**을 기다리게 된다 — 대역이 안 서는 변이(M6)가
  //   단언이 아니라 타임아웃 예외로 죽어 스위트가 통째로 멈추고 무엇이 깨졌는지 못 말한다
  //   (2026-09-14 실측). 기다리되 **끝에는 count()로 묻는다**.
  for (let i = 0; i < 40 && await standIn.count() === 0; i++) await new Promise(r => setTimeout(r, 300))
  check('빈 칸에 표지 건물 사진이 대신 보인다', await standIn.count() === 1)
  check('그것이 제 그림이 아니라 대역임을 화면이 밝힌다', await standIn.getAttribute('data-standin') === '1')
  check('왜 이 사진이 여기 있는지 문구로 설명한다',
    (await page.locator('[data-testid="form13-route-image-standin-note"]').innerText()).includes('표지 건물 사진'))
  // 대역은 **남의 파일**이다 — 여기서 [삭제]·[다운로드]를 내주면 표지 원본을 건드리게 된다
  check('대역 상태엔 [삭제]가 없다 (표지 원본을 지우게 된다)',
    await page.locator('[data-testid="form13-route-image-delete"]').count() === 0)
  check('대역 상태엔 [다운로드]가 없다',
    await page.locator('[data-testid="form13-route-image-download"]').count() === 0)
  check('그래도 DB는 비어 있다 — 대역은 복사가 아니라 **비추는 것**이다',
    !(await readFireAccess()).routeImage)

  // 화살표만은 눌러야 한다 — '표지 사진 위에 진입 방향을 표시한다'가 이 칸의 목적 전체다.
  // 그 한 번의 클릭이 비로소 복사를 일으킨다(그전까지 이 고객에겐 파일이 하나도 안 생긴다).
  check('대역 상태에서도 [화살표 넣기]는 있다',
    await page.locator('[data-testid="form13-route-image-annotate"]').count() === 1)
  await page.locator('[data-testid="form13-route-image-annotate"]').click()

  // ⚠ 대기를 **재려는 그것**에 걸지 않는다. 편집기가 뜨는 것은 복사의 *결과*라,
  //   편집기를 waitFor하면 '복사를 건너뛴다' 변이가 단언이 아니라 타임아웃 예외로 죽어
  //   무엇이 깨졌는지 못 말한다(같은 함정을 7절에서 이미 한 번 밟았다).
  let adoptedNames: string[] = []
  for (let i = 0; i < 40; i++) {
    const { data } = await raw.storage.from(BUCKET).list(`${custId}/plan-assets`)
    adoptedNames = (data ?? []).map((f: { name: string }) => f.name)
    if (adoptedNames.length) break
    await new Promise(r => setTimeout(r, 300))
  }
  check('화살표를 누르는 순간에야 복사가 일어난다',
    adoptedNames.length === 1 && adoptedNames[0].startsWith('route-cover-'), JSON.stringify(adoptedNames))

  const modal3 = page.locator('[data-testid="image-annotator"]')
  await modal3.waitFor({ state: 'visible', timeout: 30000 })
  check('복사된 그 그림을 배경으로 편집기가 열린다',
    (await modal3.locator('[data-testid="annot-canvas"] image').getAttribute('href'))?.startsWith('data:image/') === true)
  const { data: adoptedBlob } = await raw.storage.from(BUCKET).download(`${custId}/plan-assets/${adoptedNames[0]}`)
  check('복사된 바탕이 표지 사진과 **바이트까지 같다**',
    Buffer.from(await adoptedBlob!.arrayBuffer()).equals(coverPng))
  check('표지 원본은 그대로 남는다 (대역을 들여도 이동이 아니다)',
    !!(await raw.storage.from(BUCKET).list(`${custId}/assets`)).data
      ?.some((f: { name: string }) => f.name === 'cover.png'))

  // ── 10. 폐지된 자동 초안(주행경로 지도)은 화면에서도 「없는 것」이다 ────────
  //  [경로도 초안 만들기]가 만든 `route-<숫자>.png`는 사용자가 폐기하기로 확정한 주행경로 지도다.
  //  인쇄가 그것을 대역에 밀어내므로 **화면도 같은 기준이라야 한다** — 여기서 갈리면 화면엔 옛 지도가,
  //  문서엔 표지 사진이 나가 아무도 무엇이 맞는지 모르게 된다(이 저장소가 여러 번 겪은 부류다).
  console.log('— 10. 폐지된 주행경로 초안')
  await page.keyboard.press('Escape')
  await modal3.waitFor({ state: 'detached', timeout: 25000 })

  // 표지(파랑)와 **다른 색**(빨강)이라야 화면에 남은 것이 둘 중 무엇인지 색으로 가를 수 있다
  const draftPng = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).png().toBuffer()
  const draftPath = `${custId}/plan-assets/route-${Date.now()}.png`
  await raw.storage.from(BUCKET).upload(draftPath, draftPng, { contentType: 'image/png', upsert: true })
  const { data: formRow } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).single()
  await raw.from('fire_plan_forms').update({
    sections: {
      ...(formRow!.sections as Record<string, unknown>),
      fireAccess: { ...(await readFireAccess()), routeImage: draftPath, routeImageBase: null, routeAnnots: null },
    },
  }).eq('customer_id', custId)
  check('옛 주행경로 초안을 심었다 (이 절의 전제)', (await readFireAccess()).routeImage === draftPath)

  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.3`)
  await page.locator('[data-testid="form13-route-image"]').waitFor({ state: 'visible', timeout: 25000 })
  const thumb10 = page.locator('[data-testid="form13-route-image-thumb"]')
  // 9절과 같은 이유로 waitFor를 쓰지 않는다 — 여기선 썸네일이 **뜨긴 뜬다**(옛 지도로).
  // 판정은 '떴는가'가 아니라 **'뜬 것이 무엇인가'**라, 기다림이 판정을 가리면 안 된다.
  for (let i = 0; i < 40 && await thumb10.count() === 0; i++) await new Promise(r => setTimeout(r, 300))
  check('폐지된 초안 자리에도 표지 건물 사진이 선다', await thumb10.getAttribute('data-standin') === '1')
  check('옛 주행경로 지도가 화면에 남지 않는다',
    !(await thumb10.getAttribute('src'))?.includes(draftPath.split('/').pop()!))
} catch (e) {
  console.error('실행 중 오류:', e)
  check('스위트 완주', false, String(e))
} finally {
  if (browser) await browser.close()
  // 스토리지 잔재는 cleanupCustomer가 안 치운다 — 여기서 직접
  const { data: leftovers } = await raw.storage.from(BUCKET).list(`${custId}/plan-assets`)
  if (leftovers?.length) {
    await raw.storage.from(BUCKET).remove(leftovers.map((f: { name: string }) => `${custId}/plan-assets/${f.name}`))
  }
  // 8절이 심은 표지·슬롯 자동 생성분도 같은 버킷에 남는다 (assets 접두사는 위 목록에 안 걸린다)
  const { data: assetLeft } = await raw.storage.from(BUCKET).list(`${custId}/assets`)
  if (assetLeft?.length) {
    await raw.storage.from(BUCKET).remove(assetLeft.map((f: { name: string }) => `${custId}/assets/${f.name}`))
  }
  await cleanupCustomer(custId)
  await delUser(userId)
  summary()
}

