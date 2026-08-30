// §15 V-1 심층 — 27건이 '어느 산출물이 옳은가' 문제인지, 아니면 '입력 데이터가 어긋난' 문제인지.
// 판정자 D 관찰: 대장은 「할론소화설비」인데 응답은 「할로겐화합물 및 불활성기체」 점검표에 들어 있다.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-s15-halogen.mjs
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

const CUST = 'c98d316f-21ba-463b-9493-62dacdf44f56'   // 서림사 C330
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'

// ① 설비 대장 — 이 고객이 '있다'고 등록한 설비
const { data: blds, error: bErr } = await raw.from('buildings').select('id, building_name')
  .eq('customer_id', CUST).eq('is_active', true)
if (bErr) throw new Error(`건물: ${bErr.message}`)
const ids = blds.map(b => b.id)
// ⚠ 실컬럼은 id·building_id·category·facility_code·installed·detail·updated_at 이다
//   (facility_name은 없다 — 첫 판이 그 이름으로 물어 터졌다. select 목록은 실컬럼 확인 후에.)
const { data: fac, error: fErr } = await raw.from('fire_facilities')
  .select('facility_code, category, installed').in('building_id', ids)
if (fErr) throw new Error(`설비: ${fErr.message}`)
console.log('① 설비 대장 (installed=true 만):')
for (const f of fac.filter(f => f.installed)) console.log(`   ${f.facility_code}  [${f.category}]`)
console.log(`   (미설치로 등록된 것 ${fac.filter(f => !f.installed).length}종)`)
// 할론=11-* 계열 코드로 본다(이름 컬럼이 없으므로 코드 축으로)
const halonish = fac.filter(f => String(f.facility_code).startsWith('11-') || /할론|할로겐|불활성/.test(String(f.category)))
console.log('\n   할론·할로겐 계열 대장 상태:')
if (!halonish.length) console.log('     (대장에 해당 계열 행 자체가 없다)')
for (const f of halonish) console.log(`     ${f.facility_code} [${f.category}] installed=${f.installed}`)

// ② 응답이 들어간 점검표가 무엇인가 — 11-* 코드의 소속
const { data: resp, error: rErr } = await raw.from('inspection_sheet_responses')
  .select('item_code').eq('inspection_id', INSP).limit(2000)
if (rErr) throw new Error(`응답: ${rErr.message}`)
const codes11 = [...new Set(resp.filter(r => r.item_code.startsWith('11-')).map(r => r.item_code))]
console.log(`\n② 11-* 응답 ${codes11.length}건`)
const { data: items, error: iErr } = await raw.from('inspection_sheet_items')
  .select('item_code, sheet_id, group_name').in('item_code', codes11)
if (iErr) throw new Error(`항목: ${iErr.message}`)
const groups = [...new Set(items.map(i => i.group_name))]
console.log(`   소속 점검표(group_name): ${groups.join(' / ')}`)
const sheetIds = [...new Set(items.map(i => i.sheet_id))]
const { data: sheets } = await raw.from('inspection_sheets').select('id, title').in('id', sheetIds)
console.log(`   시트 제목: ${(sheets ?? []).map(s => s.title).join(' / ')}`)

// ③ 결론 재료
console.log('\n③ 판단 재료')
const hasHalonLedger = halonish.some(f => f.installed)
console.log(`   대장에 그 계열이 설치로 있는가: ${hasHalonLedger ? '예' : '아니오'}`)
console.log(`   → ${hasHalonLedger
  ? '대장에 있는데 엑셀이 뺐다면 그건 선별 결함이다.'
  : '대장에 없다. 즉 응답과 대장이 서로 다른 설비를 말하고 있다 — 산출물 선택 문제가 아니라 입력 정합 문제다.'}`)
