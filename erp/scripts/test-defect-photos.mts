/** 불량 전/후 사진 표시 E2E (2026-08-18)
 *  실행: npx tsx scripts/test-defect-photos.mts  (dev 서버 localhost:3000 또는 TEST_BASE_URL)
 *
 *  회귀 방어 대상: 업로드가 비공개 버킷에 public URL을 저장해 사진이 **화면 전체에서** 뜨지
 *  않던 결함. src 속성만 보면 통과해 버리므로 **실제로 픽셀이 실린 이미지인지**(naturalWidth)
 *  까지 확인한다 — 깨진 이미지도 src는 멀쩡해 보인다.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'test-defectphoto@erp-test.com'
const PW = 'DefPhoto1!'
const TAG = `ZZP${Math.random().toString(36).slice(2, 6).toUpperCase()}`
// 1x1 PNG (투명) — 픽셀이 실렸는지만 보면 되므로 최소 이미지
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) }
}

let userId = '', customerId = '', inspectionId = '', defectId = ''
const uploaded: string[] = []
let browser: import('playwright').Browser | null = null

try {
  console.log('[셋업]')
  const { data: existing } = await raw.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  userId = nu!.user!.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST-사진관리자', role: 'admin', is_active: true, employee_id: 'TEST-DPH', email: EMAIL })

  const { data: cust } = await raw.from('customers').insert({
    customer_code: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, customer_name: `${TAG}사진고객`,
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    is_active: true, created_by: userId,
  }).select('id').single()
  customerId = cust!.id
  const { data: insp, error: iErr } = await raw.from('inspections').insert({
    customer_id: customerId, sequence_num: 1, inspection_type: '작동', assigned_employee_id: userId,
    inspection_start_date: '2026-08-18', status: 'in_progress', created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspectionId = insp!.id

  const { data: def, error: dErr } = await raw.from('inspection_defects').insert({
    inspection_id: inspectionId, defect_name: `${TAG}유도등불량`, severity: '보통',
  }).select('id').single()
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)
  defectId = def!.id

  // 전·후 사진을 버킷에 올리고 **경로**를 저장한다(신형식)
  for (const [field, name] of [['photo_url', `${Date.now()}.png`], ['after_photo_url', `after_${Date.now()}.png`]] as const) {
    const path = `${inspectionId}/${defectId}/${name}`
    const { error: uErr } = await raw.storage.from('inspection-defects').upload(path, PNG, { contentType: 'image/png', upsert: true })
    if (uErr) throw new Error(`사진 업로드 실패: ${uErr.message}`)
    uploaded.push(path)
    await raw.from('inspection_defects').update({ [field]: path }).eq('id', defectId)
  }
  console.log(`  셋업 완료 (TAG=${TAG})`)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 30000 })

  /** 화면에 실제로 그려진(픽셀이 실린) 불량사진 수 — 깨진 이미지는 naturalWidth가 0이다 */
  // src는 자르지 않는다 — 잘라서 판정하면 '/object/sign/' 같은 조건이 조용히 거짓이 된다
  const loadedPhotos = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter(i => i.src.includes('inspection-defects'))
      .map(i => ({ ok: i.naturalWidth > 0, src: i.src })))
  const brief = (s: Array<{ ok: boolean; src: string }>) =>
    JSON.stringify(s.map(x => ({ ok: x.ok, src: x.src.slice(0, 70) })))

  console.log('[1] 점검 상세 — 저장값이 화면에 서명 URL로 나온다')
  await page.goto(`${BASE}/inspections/${inspectionId}`)
  await page.locator(`text=${TAG}유도등불량`).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)   // 이미지 디코드 대기
  const shots = await loadedPhotos()
  check('불량사진 img 태그 존재', shots.length > 0, `${shots.length}개`)
  check('저장값이 아니라 서명 URL로 나감(token 포함)',
    shots.every(s => s.src.includes('/object/sign/') && s.src.includes('token=')), brief(shots))
  check('공개 URL(죽은 주소)이 아님', shots.every(s => !s.src.includes('/object/public/')))
  check('실제로 픽셀이 실린 이미지', shots.every(s => s.ok), brief(shots))

  console.log('[2] 전/후 사진 모아보기 모달')
  const galleryBtn = page.locator('button', { hasText: '전/후 사진 모아보기' })
  if (await galleryBtn.count() > 0) {
    await galleryBtn.first().click()
    await page.locator('text=/전\\/후 사진 \\(/').waitFor({ timeout: 15000 })
    await page.waitForTimeout(1200)
    const modalShots = await loadedPhotos()
    check('모달에 사진 표시', modalShots.length >= 2, `${modalShots.length}개`)
    check('모달 사진도 실제로 로드됨', modalShots.every(s => s.ok), brief(modalShots))
  } else {
    check('전/후 사진 모아보기 버튼 존재', false, '버튼을 찾지 못함')
  }

  console.log('[3] 제출 패키지 — 별지 11호 ZIP에 증빙 사진이 담긴다')
  {
    // 종전엔 죽은 URL을 fetch해 조용히 실패 → 사진 0장으로 ZIP이 만들어졌다
    const { data: rows } = await raw.from('inspection_defects')
      .select('photo_url, after_photo_url').eq('inspection_id', inspectionId)
    const stored = (rows ?? []).flatMap(r => [r.photo_url, r.after_photo_url]).filter(Boolean) as string[]
    check('DB 저장값이 경로 형식(http 아님)', stored.length === 2 && stored.every(v => !v.startsWith('http')),
      JSON.stringify(stored))
    let downloadable = 0
    for (const p of stored) {
      const { data: blob } = await raw.storage.from('inspection-defects').download(p)
      if (blob) downloadable++
    }
    check('저장값으로 버킷에서 바로 내려받힘(ZIP 첨부 경로)', downloadable === stored.length, `${downloadable}/${stored.length}`)
  }

  console.log('[3-b] 실제 업로드 경로 — 화면에서 올린 사진도 경로로 저장된다')
  {
    // 결함의 발원지는 업로드 액션이었다. 화면에서 올린 값이 다시 public URL이 되면 원위치다.
    const { data: def2 } = await raw.from('inspection_defects').insert({
      inspection_id: inspectionId, defect_name: `${TAG}업로드경로`, severity: '경미',
    }).select('id').single()
    const newDefectId = def2!.id
    await page.goto(`${BASE}/inspections/${inspectionId}`)
    await page.locator(`text=${TAG}업로드경로`).first().waitFor({ timeout: 20000 })
    // 숨은 input을 DOM으로 찾아가는 건 구조 변경에 약하다 — 실제 사용자처럼 슬롯을 눌러
    // 파일 선택창을 띄우고 그 이벤트에 파일을 준다. 사진이 없는 불량만 이 버튼을 그린다.
    const slot = page.getByRole('button', { name: '전(불량) 사진' }).first()
    await slot.waitFor({ timeout: 20000 })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      slot.click(),
    ])
    await chooser.setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
    // 저장이 끝날 때까지 DB를 폴링 — 고정 대기는 느린 환경에서 흔들린다
    let stored: string | null = null
    for (let i = 0; i < 30 && !stored; i++) {
      await page.waitForTimeout(500)
      const { data: r } = await raw.from('inspection_defects').select('photo_url').eq('id', newDefectId).single()
      stored = (r as { photo_url: string | null } | null)?.photo_url ?? null
    }
    check('업로드가 경로로 저장(public URL 아님)', !!stored && !stored.startsWith('http'), String(stored))
    if (stored) {
      const { data: blob } = await raw.storage.from('inspection-defects').download(stored)
      check('업로드한 파일이 그 경로에 실재', !!blob)
      uploaded.push(stored)
    }
    await raw.from('inspection_defects').delete().eq('id', newDefectId)
  }

  console.log('[4] 회귀 방어 — 공개 URL은 실제로 죽어 있다')
  {
    const pub = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/inspection-defects/${uploaded[0]}`
    const res = await fetch(pub)
    check('공개 URL은 200이 아니다(그래서 저장하면 안 된다)', !res.ok, `status=${res.status}`)
  }
} catch (e) {
  fail++
  console.error('ERROR:', e instanceof Error ? e.message : e)
} finally {
  if (browser) await browser.close()
  console.log('[정리]')
  if (uploaded.length) await raw.storage.from('inspection-defects').remove(uploaded)
  if (defectId) await raw.from('inspection_defects').delete().eq('id', defectId)
  if (inspectionId) {
    await raw.from('inspection_steps').delete().eq('inspection_id', inspectionId)
    await raw.from('inspections').delete().eq('id', inspectionId)
  }
  if (customerId) await raw.from('customers').delete().eq('id', customerId)
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId).catch(() => {}) }
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL`)
  process.exitCode = fail > 0 ? 1 : 0
}
