// 고객 일괄 이관 (P1A-2) — 소방점검리스트.xls 26년 시트 → customers/customer_contacts/buildings
// 실행: node scripts/migrate-customers.mjs            (dry-run: 파싱·검수 리포트만)
//       node scripts/migrate-customers.mjs --execute  (.env.local DB에 삽입)
// 주의: .env.local이 현재 스테이징 DB를 가리킴. 이미 존재하는 customer_name은 건너뜀(멱등).
import xlsx from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SRC = 'F:/AI/ERP/erp_goal/_Data/소방점검리스트.xls'
const execute = process.argv.includes('--execute')
const C = { name: 1, type: 2, date: 3, region: 9, area: 10, approval: 11, contact: 13, phone: 14, untaxed: 15, taxed: 16 }
const 양평읍면 = new Set(['양평','용문','양동','개군','옥천','양서','청운','강하','강상','지평','서종','단월'])

function parseDate(v) { // "2014.01.15" / "2024.07.2" → YYYY-MM-DD, 그 외 null
  const m = String(v).trim().match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  const iso = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  return isNaN(Date.parse(iso)) ? null : iso
}
function parsePlanDate(v) { // "1.7" / "12.20" / 범위 "1.23~1.24"(다일 점검→시작일) / 오타 "4..17"
  let s = String(v).replace(/\s/g,'').split(/[~∼]/)[0].replace(/\.+/g,'.')
  const m = s.match(/^(\d{1,2})\.(\d{1,2})$/)
  if (!m) return null
  const iso = `2026-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`
  return isNaN(Date.parse(iso)) ? null : iso
}
function cleanName(v) { return String(v ?? '').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim() }
function mapType(t) {
  t = String(t).trim()
  if (t === '종합' || t === '최초') return '종합'
  if (t === '작동') return '작동'
  return '일반관리' // 안전 등
}
function firstPhone(v) {
  const m = String(v).replace(/\s+/g,' ').match(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/)
  return m ? m[0].replace(/\s/g,'') : (String(v).split(/[\n]/)[0].trim() || null)
}

// ── 파싱 ──
const wb = xlsx.readFile(SRC)
const rows = xlsx.utils.sheet_to_json(wb.Sheets['26년'], { header: 1, defval: '', blankrows: false })
const byName = new Map()
const flags = []
for (const r of rows.slice(2)) {
  const name = cleanName(r[C.name])
  const rawType = String(r[C.type] ?? '').trim()
  if (!name || !rawType) continue
  if (byName.has(name)) continue // 최초 등장(최초 점검일) 우선
  const region = String(r[C.region] ?? '').trim()
  const type = mapType(rawType)
  const approval = parseDate(r[C.approval])
  const plan = parsePlanDate(r[C.date])
  const num = (v) => { const n = Math.round(parseFloat(String(v).replace(/[^\d.]/g,''))); return Number.isFinite(n) && n > 0 ? n : null }
  const area = parseFloat(String(r[C.area]).replace(/[^\d.]/g,'')) || null
  const untaxed = num(r[C.untaxed])
  const taxed = num(r[C.taxed])
  if (rawType === '안전') flags.push(`구분'안전'→일반관리: ${name}`)
  if (!plan) flags.push(`점검계획일 없음: ${name} (날짜="${r[C.date]}")`)
  byName.set(name, { name, rawType, type, region, approval, plan, area, untaxed, taxed,
    contact: cleanName(r[C.contact]) || null, phone: firstPhone(r[C.phone]) })
}
const list = [...byName.values()]
console.log(`파싱: ${list.length}곳 (고유) / 플래그 ${flags.length}건`)
console.log('타입:', JSON.stringify(list.reduce((a,c)=>{a[c.type]=(a[c.type]||0)+1;return a;},{})))
console.log('샘플:', list.slice(0,3).map(c=>`${c.name}[${c.type}] ${c.region} 승인${c.approval} 계획${c.plan} ${c.area}㎡`).join('\n        '))
if (flags.length) console.log('플래그(앞 8):', flags.slice(0,8).join(' / '))

if (!execute) { console.log('\n[dry-run] --execute 로 스테이징 반영'); process.exit(0) }

// ── DB 삽입 ──
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
console.log('대상 DB:', env.NEXT_PUBLIC_SUPABASE_URL)

const { data: prof } = await admin.from('profiles').select('id').eq('is_active',true).limit(1)
const createdBy = prof[0].id
const { data: fsRows } = await admin.from('region_fire_stations').select('region, fire_station, region_si')
const fsMap = new Map(fsRows.map(r=>[r.region, r]))
const { data: existing } = await admin.from('customers').select('customer_name')
const have = new Set(existing.map(c=>c.customer_name))
// 코드 시퀀스
const { data: codes } = await admin.from('customers').select('customer_code').like('customer_code','C%')
let seq = codes.reduce((m,c)=>{const n=parseInt(String(c.customer_code).replace(/\D/g,''));return n>m?n:m;},0)

let ins=0, skip=0
for (const c of list) {
  if (have.has(c.name)) { skip++; continue }
  const fs = fsMap.get(c.region)
  const isYp = 양평읍면.has(c.region)
  const region_si = isYp ? '양평군' : (fs?.region_si || c.region)
  const region_myeon = isYp ? c.region : ''
  const cat = c.type === '일반관리' ? '일반관리' : '소방안전관리'
  const sub = c.type === '종합' ? '종합' : c.type === '작동' ? '작동' : null
  const isMonthly = c.type === '종합' || c.type === '작동'
  seq++
  const code = 'C' + String(seq).padStart(4,'0')
  const { data: cust, error } = await admin.from('customers').insert({
    customer_code: code, customer_name: c.name, inspection_type: c.type,
    inspection_category: cat, inspection_sub_type: sub,
    use_approval_date: c.approval, plan_anchor_date: c.plan,
    region_si, region_myeon, region_ri: '',
    fire_station: fs?.fire_station ?? null,
    monthly_fee_untaxed: isMonthly ? c.untaxed : null, monthly_fee_taxed: isMonthly ? c.taxed : null,
    fee_untaxed: isMonthly ? null : c.untaxed, fee_taxed: isMonthly ? null : c.taxed,
    is_active: true, created_by: createdBy,
  }).select('id').single()
  if (error) { console.error(`실패 ${c.name}:`, error.message); continue }
  if (c.contact) await admin.from('customer_contacts').insert({ customer_id: cust.id, role:'대표', name: c.contact, phone: c.phone })
  if (c.area) await admin.from('buildings').insert({ customer_id: cust.id, building_name: c.name, total_area: c.area, is_active: true, created_by: createdBy }).then(()=>{}, ()=>{})
  ins++
}
console.log(`이관 완료 — 신규 ${ins} / 건너뜀(기존) ${skip}`)
const { count } = await admin.from('customers').select('*',{count:'exact',head:true})
console.log('customers 총:', count)
