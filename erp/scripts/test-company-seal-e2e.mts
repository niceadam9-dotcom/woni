/** 공문 직인 실주행 (C5 마무리 · 마이그 174 — dev 서버 + 스테이징 필요)
 *  실행: npx tsx --conditions=react-server scripts/test-company-seal-e2e.mts
 *
 *  ① 관리자가 본사 정보 화면에서 직인을 올린다 → 미리보기에 직인·「(직인생략)」 사라짐 · DB seal_path · 버킷 객체(PNG)
 *  ② 비공개 — anon 키로는 객체를 못 읽는다(정책 0)
 *  ③ 갑지 엑셀 다운로드 — 「공문」 시트에 그림 1장(png)·A34 명의에서 「(직인생략)」 사라짐
 *  ④ PDF 공문 조립(assembleOfficial) — 직인 data URI 실림·(직인생략) 없음
 *  ⑤ 직인 삭제 → seal_path null·객체 삭제·미리보기 「(직인생략)」 복귀
 *  ⚠ 스테이징 회사정보의 직인을 건드린다 — 시작 때 이미 직인이 있으면 **중단**한다(남의 직인을 지우지 않는다). */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login, check, summary } from './_e2e-helpers.mjs'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import sharp from 'sharp'
import { assembleOfficial } from '../src/lib/annex-cover-official'
import { renderOfficial } from '../src/lib/doc-templates/official'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `seal.${SUF}@e2e.test`
let userId = '', custId = '', inspId = ''
let browser: import('playwright').Browser | null = null
const SEAL_PNG = 'C:/Temp/c5seal/e2e-seal.jpg'

const { data: start } = await raw.from('company_profile').select('id, seal_path').order('id').limit(1).single()
if (start?.seal_path) { console.log(`⛔ 스테이징에 이미 직인이 있다(${start.seal_path}) — 지우지 않으려고 중단`); process.exit(1) }

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fdfdfd"/>
  <rect x="140" y="140" width="520" height="520" rx="30" fill="none" stroke="#c81414" stroke-width="40"/>
  <text x="400" y="470" font-size="230" text-anchor="middle" fill="#c81414" font-family="Malgun Gothic">印</text></svg>`
await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(SEAL_PNG)

try {
  userId = await mkUser({ email: EMAIL, name: `직인${SUF}`, employeeId: `SL-${SUF}`, role: 'admin' })
  custId = await mkCustomer({ customer_name: `직인검증사${SUF}`, created_by: userId, address: '경기도 양평군 검증면 실주행로 27', fire_station: '양평' })
  const { data: insp, error } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', plan_type: 'special_작동', sequence_num: 1,
    inspection_start_date: '2026-08-20', inspection_end_date: '2026-08-21',
    status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`점검 생성 실패: ${error.message}`)
  inspId = insp!.id

  const l = await launch(); browser = l.browser
  const page: Page = l.page
  await login(page, EMAIL)

  console.log('[1] 본사 정보 화면에서 직인 올리기')
  await page.goto(`${BASE}/company`)
  await page.getByText('공문에 이렇게 찍힙니다').waitFor({ timeout: 30_000 })
  // ⚠ 도움말 문장에도 「(직인생략)」이 있다 — 미리보기 줄(data-testid)만 본다
  const preview = page.getByTestId('seal-preview')
  check('업로드 전 미리보기 — (직인생략)', (await preview.innerText()).includes('(직인생략)'))
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles(SEAL_PNG)
  await page.locator('img[alt="직인"]').waitFor({ timeout: 30_000 })
  check('업로드 후 미리보기에 직인 그림', await page.locator('img[alt="직인"]').count() === 1)
  check('업로드 후 (직인생략) 사라짐', !(await preview.innerText()).includes('(직인생략)'), await preview.innerText())
  const { data: row } = await raw.from('company_profile').select('seal_path').order('id').limit(1).single()
  check('DB seal_path 기록', !!row?.seal_path && /^seal\/seal_\d+\.png$/.test(row.seal_path), row?.seal_path)
  const { data: obj, error: objErr } = await raw.storage.from('company-assets').download(row!.seal_path!)
  const objMeta = obj ? await sharp(new Uint8Array(await obj.arrayBuffer())).metadata() : null
  check('버킷 객체 = 투명 PNG', objMeta?.format === 'png' && objMeta.hasAlpha === true, objErr?.message ?? `${objMeta?.format}`)

  console.log('[2] 비공개 — anon 키로 못 읽는다')
  const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(x => x.includes('=') && !x.startsWith('#')).map(x => [x.slice(0, x.indexOf('=')).trim(), x.slice(x.indexOf('=') + 1).trim()]))
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: anonObj } = await anon.storage.from('company-assets').download(row!.seal_path!)
  check('anon 다운로드 거절', !anonObj)
  const { data: pub } = anon.storage.from('company-assets').getPublicUrl(row!.seal_path!)
  const pubRes = await fetch(pub.publicUrl)
  check('공개 URL 거절(비공개 버킷)', !pubRes.ok, `status=${pubRes.status}`)

  console.log('[3] 갑지 엑셀 「공문」 시트')
  const res = await page.request.get(`${BASE}/inspections/${inspId}/workbook`, { timeout: 180_000 })
  check('워크북 200', res.status() === 200, `status=${res.status()}`)
  const zip = await JSZip.loadAsync(await res.body())
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rid = /<sheet [^>]*name="공문"[^>]*r:id="([^"]+)"/.exec(wb)?.[1]
  const sheetPath = 'xl/' + (new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(wbRels)?.[1] ?? '').replace(/^\/?xl\//, '')
  const sheet = await zip.file(sheetPath)?.async('string') ?? ''
  check('공문 시트에 <drawing>', /<drawing r:id=/.test(sheet), sheetPath)
  const sheetRels = await zip.file(sheetPath.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'))?.async('string') ?? ''
  const drawingName = /Target="\.\.\/drawings\/([^"]+)"/.exec(sheetRels)?.[1]
  const drawingRels = drawingName ? await zip.file(`xl/drawings/_rels/${drawingName}.rels`)?.async('string') ?? '' : ''
  check('그림 파트 png 1장', (drawingRels.match(/\.png"/g) ?? []).length === 1, drawingRels.slice(0, 160))
  const sst = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
  const texts = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
  check('공문 명의에서 (직인생략) 사라짐', !texts.some(s => s.includes('직인생략')), texts.filter(s => s.includes('직인생략')).join(' | '))
  check('공문 명의 「대표이사 김흥준」', texts.includes('대표이사 김흥준'))
  const notice = decodeURIComponent(res.headers()['x-workbook-missing'] ?? '')
  check('고지에 직인 실패 없음', !notice.includes('직인'), notice.slice(0, 200))

  console.log('[4] PDF 공문 조립')
  const off = await assembleOfficial(raw, custId, inspId)
  const html = renderOfficial(off.data)
  check('조립에 직인(seal) 실림', !!off.seal && off.seal.width > 0)
  check('PDF HTML — 직인 <img>·(직인생략) 없음', html.includes('class="of-seal"') && !html.includes('직인생략'))

  console.log('[5] 직인 삭제')
  const path = row!.seal_path!
  await page.getByRole('button', { name: '직인 삭제' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="seal-preview"]')?.textContent?.includes('(직인생략)'), null, { timeout: 30_000 })
  const { data: after } = await raw.from('company_profile').select('seal_path').order('id').limit(1).single()
  check('DB seal_path null', after?.seal_path === null, String(after?.seal_path))
  // download는 삭제 직후에도 캐시된 바이트를 돌려준 적이 있다(2026-10-03 실측) — 목록으로 본다
  const { data: listed } = await raw.storage.from('company-assets').list('seal')
  check('버킷 객체 삭제', !(listed ?? []).some(o => `seal/${o.name}` === path), JSON.stringify(listed?.map(o => o.name)))
} finally {
  if (browser) await browser.close()
  // 실패로 끝났어도 스테이징 직인을 남기지 않는다(시작 때 없었음을 확인했다)
  const { data: left } = await raw.from('company_profile').select('id, seal_path').order('id').limit(1).single()
  if (left?.seal_path) {
    await raw.from('company_profile').update({ seal_path: null }).eq('id', left.id)
    await raw.storage.from('company-assets').remove([left.seal_path])
  }
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
summary()
