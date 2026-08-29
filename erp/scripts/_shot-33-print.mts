/** 소방계획서_33 — 표지·별지 9호를 실제로 **그려서 PNG로** 남긴다 (육안 확인용).
 *  1차(종합)와 2차(작동)를 나란히 뽑아 대조한다.
 *  실행: npx tsx --conditions=react-server scripts/_shot-33-print.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { chromium } from 'playwright'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
for (const [k, v] of Object.entries(env)) process.env[k] ??= v
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const OUT = new URL('../.test-shots/soban33/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { assembleCover } = await import('../src/lib/annex-cover-official.ts')
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { renderCover } = await import('../src/lib/doc-templates/cover.ts')
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')
const admin = createAdminClient()

const { data: i2 } = await raw.from('inspections')
  .select('id, customer_id, sequence_num, inspection_type, plan_type, customers(customer_name)')
  .eq('sequence_num', 2).limit(1).single()
const { data: i1 } = await raw.from('inspections')
  .select('id, customer_id, sequence_num, inspection_type, plan_type, customers(customer_name)')
  .eq('sequence_num', 1).eq('plan_type', 'special_종합').limit(1).single()

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 })).newPage()

for (const [tag, row] of [['2nd-operational', i2], ['1st-comprehensive', i1]] as const) {
  const r = row as never as { id: string; customer_id: string; inspection_type: string; plan_type: string; customers: { customer_name: string } }
  console.log(`\n== ${tag}: ${r.customers?.customer_name} type=${r.inspection_type} plan_type=${r.plan_type}`)

  const cov = await assembleCover(admin, r.customer_id, r.id, { forPreview: true })
  const covHtml = renderCover(cov.data as never)
  writeFileSync(`${OUT}cover-${tag}.html`, covHtml, 'utf8')
  await page.setContent(covHtml, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}cover-${tag}.png`, fullPage: true })
  console.log(`   표지 typeLabel=${JSON.stringify(cov.data.typeLabel)} → cover-${tag}.png`)

  const r9 = await assembleReport9(admin, r.customer_id, r.id)
  const d9: Record<string, unknown> = (r9 as never as { data: Record<string, unknown> }).data ?? (r9 as never as Record<string, unknown>)
  const r9Html = renderReport9(d9 as never)
  writeFileSync(`${OUT}report9-${tag}.html`, r9Html, 'utf8')
  await page.setContent(r9Html, { waitUntil: 'networkidle' })
  // 별지 9호 1쪽(점검 구분 체크칸이 있는 면)만 자른다
  await page.screenshot({ path: `${OUT}report9-${tag}.png`, clip: { x: 0, y: 0, width: 1000, height: 900 } })
  console.log(`   별지9호 ck={op:${d9.ckOp}, initial:${d9.ckInitial}, compEtc:${d9.ckCompEtc}} → report9-${tag}.png`)
}

await browser.close()
console.log(`\n출력 폴더: ${OUT}`)
