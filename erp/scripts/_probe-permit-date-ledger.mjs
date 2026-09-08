/** 건축허가일(pmsDay)이 건축물대장 표제부에서 **실제로 오는가** — 읽기 전용 실호출 계량.
 *  앱 코드(customers/actions.ts:1799 getBrTitleInfo, :1828 pmsDay, :1855 day8)와 같은 경로를 그대로 재현한다.
 *  실행: node scripts/_probe-permit-date-ledger.mjs [.env파일]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] ?? '.env.local'
const env = {}
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const key = env.BUILDING_LEDGER_API_KEY
if (!key) { console.log('BUILDING_LEDGER_API_KEY 없음 — 중단'); process.exit(1) }

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('buildings')
    .select('building_name, address_jibun, bcode, is_active, permit_date, building_area')
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  rows.push(...data); if (data.length < 1000) break
}
const runnable = rows.filter(r => r.is_active !== false
  && r.bcode && String(r.bcode).length === 10
  && r.address_jibun && /(\d+)(-\d+)?$/.test(String(r.address_jibun).trim()))

// 앱과 동일한 파싱 (actions.ts:1794-1797, :1829)
const day8 = v => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null)
const num = v => { const n = parseFloat(String(v ?? '')); return isNaN(n) || n === 0 ? null : n }

console.log(`env=${envFile}  대상 ${runnable.length}동 — 표제부 getBrTitleInfo 실호출\n`)
let ok = 0, noPms = 0, noRecord = 0, err = 0, archOk = 0

for (const r of runnable) {
  const m = String(r.address_jibun).trim().match(/(\d+)(?:-(\d+))?$/)
  const bun = m[1].padStart(4, '0'), ji = (m[2] ?? '0').padStart(4, '0')
  const url = new URL('https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo')
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('sigunguCd', String(r.bcode).slice(0, 5))
  url.searchParams.set('bjdongCd', String(r.bcode).slice(5))
  url.searchParams.set('bun', bun); url.searchParams.set('ji', ji)
  url.searchParams.set('numOfRows', '10'); url.searchParams.set('_type', 'json')

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    const json = await res.json()
    if (json.response?.header?.resultCode !== '00') {
      console.log(`  ✗ ${r.building_name} — API: ${json.response?.header?.resultMsg}`); err++; continue
    }
    const raw = json.response?.body?.items?.item
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    if (list.length === 0) { console.log(`  · ${r.building_name} — 해당 지번 대장 없음`); noRecord++; continue }
    const item = list.reduce((a, b) => (num(a.totArea) ?? 0) >= (num(b.totArea) ?? 0) ? a : b)
    const pms = day8(String(item.pmsDay ?? ''))
    const arch = num(item.archArea)
    if (arch != null) archOk++
    if (pms) { ok++; console.log(`  ✓ ${r.building_name} — 허가일 ${pms} | 건축면적 ${arch ?? '(없음)'} | DB현재 허가일=${r.permit_date ?? '(공란)'}`) }
    else { noPms++; console.log(`  ✗ ${r.building_name} — pmsDay 원본="${item.pmsDay ?? ''}" (대장에 허가일 없음) | 건축면적 ${arch ?? '(없음)'}`) }
  } catch (e) { console.log(`  ✗ ${r.building_name} — ${e.message}`); err++ }
}

console.log(`\n=== 결과 ===`)
console.log(`  건축허가일 받아옴 : ${ok}/${runnable.length}`)
console.log(`  대장에 허가일 공란 : ${noPms}`)
console.log(`  해당 지번 대장 없음: ${noRecord}`)
console.log(`  API 오류          : ${err}`)
console.log(`  건축면적 받아옴    : ${archOk}/${runnable.length}`)
