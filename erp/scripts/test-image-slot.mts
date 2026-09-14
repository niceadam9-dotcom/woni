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

  // ── 7. 삭제가 원본까지 치우는가 (스토리지 누수) ───────────────────────────
  console.log('— 7. 삭제 시 원본·합성본 동반 정리')
  await page.keyboard.press('Escape')
  await modal2.waitFor({ state: 'detached', timeout: 10000 })
  await page.locator('[data-testid="form13-route-image-delete"]').click()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="form13-route-image-thumb"]') === null, null, { timeout: 20000 })
  const { data: left } = await raw.storage.from(BUCKET).list(`${custId}/plan-assets`)
  check('합성본·원본 모두 스토리지에서 사라짐', (left ?? []).length === 0,
    JSON.stringify((left ?? []).map((f: { name: string }) => f.name)))
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
  await cleanupCustomer(custId)
  await delUser(userId)
  summary()
}

