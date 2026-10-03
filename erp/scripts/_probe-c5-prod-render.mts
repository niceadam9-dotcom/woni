/** C5 2차 운영 확인(읽기 전용) — 운영 company_profile 값으로 두 템플릿을 치환해 운영사 칸을 덤프한다 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import JSZip from 'jszip'
import { reportWorkbookRules, firePlanWorkbookRules } from '../src/lib/company-literals'
import { personalizeWorkbook } from '../src/lib/xlsx-personalize'
const e = Object.fromEntries(readFileSync('.env.production', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: p, error } = await db.from('company_profile').select('company_name, official_sender_name, official_rep_title, representative, business_number, phone, fax, address, address_jibun, management_reg_no').single()
if (error) throw error
console.log(`운영 ${e.NEXT_PUBLIC_SUPABASE_URL.slice(8, 20)} address_jibun=${JSON.stringify(p.address_jibun)}`)
const dec = (s: string) => s.replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
for (const [f, rules] of [['templates/report-workbook-full.xlsx', reportWorkbookRules], ['templates/fire-plan-workbook.xlsx', firePlanWorkbookRules]] as const) {
  const r = await personalizeWorkbook(new Uint8Array(readFileSync(f)), rules(p as never))
  const zip = await JSZip.loadAsync(r.bytes); const out: string[] = []
  const sst = zip.file('xl/sharedStrings.xml')
  if (sst) for (const si of (await sst.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) out.push(dec([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')))
  for (const k of Object.keys(zip.files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)))
    for (const m of (await zip.file(k)!.async('string')).matchAll(/<is>([\s\S]*?)<\/is>/g)) out.push(dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')))
  console.log(`\n== ${f} 바뀐 칸 ${r.changed.length}`)
  for (const s of new Set(out.filter(s => /승진|덕평|잿말길|2020-01|772-|586-86|김흥준|김  흥/.test(s)))) console.log('  ' + JSON.stringify(s).slice(0, 170))
}
