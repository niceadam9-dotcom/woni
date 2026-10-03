/** C5 2차 dev 실확인 — 스테이징 회사정보로 갑지·소방계획서 엑셀을 실제로 내려받아 운영사 칸을 덤프한다(읽기 위주, 만든 픽스처는 지움)
 *  실행: npx tsx scripts/_probe-c5-dev-download.mts */
import type { Page } from 'playwright'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import JSZip from 'jszip'

const SUF = Math.random().toString(36).slice(2, 6).toUpperCase()
const EMAIL = `c5probe.${SUF}@e2e.test`
let userId = '', custId = '', inspId = ''
let browser: import('playwright').Browser | null = null
const OPERATOR = /승진|덕평|잿말길|2020-01|1234567|772-3019|772-2419|586-86|김흥준|김  흥  준|직인생략|계약대상자/

const dec = (s: string) => s.replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
async function texts(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes); const out: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? [])
    out.push(dec([...si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')))
  for (const p of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    const xml = await zip.file(p)!.async('string')
    for (const m of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) out.push(dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')))
    for (const m of xml.matchAll(/t="str"[^>]*>(?:(?!<\/c>)[\s\S])*?<v>([\s\S]*?)<\/v>/g)) out.push(dec(m[1]))
  }
  return out
}

try {
  userId = await mkUser({ email: EMAIL, name: `C5확인${SUF}`, employeeId: `C5-${SUF}`, role: 'admin' })
  custId = await mkCustomer({ customer_name: `C5확인사${SUF}`, created_by: userId, address: '경기도 양평군 검증면 실주행로 27', fire_station: '양평' })
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
  for (const [label, url] of [['갑지', `${BASE}/inspections/${inspId}/workbook`], ['소방계획서', `${BASE}/customers/${custId}/fire-plan/xlsx`]] as const) {
    const res = await page.request.get(url, { timeout: 180_000 })
    const body = new Uint8Array(await res.body())
    console.log(`\n== ${label} status=${res.status()} ${(body.length / 1024).toFixed(0)}KB ${res.headers()['content-type']}`)
    if (res.status() !== 200) { console.log(new TextDecoder().decode(body).slice(0, 300)); continue }
    const hits = [...new Set((await texts(body)).filter(s => OPERATOR.test(s) || s.includes('승진소방ENG')))]
    for (const h of hits) console.log('  ' + JSON.stringify(h))
  }
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}
