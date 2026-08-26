/** EXT 명시 등재의 영향 반경 계량 — 변경 전/후 같은 스크립트로 돌려 diff한다. 읽기 전용.
 *
 *  세는 것 (sheet-overview.ts:247·275-276과 같은 함수 sheetMatchesFacilities를 쓴다):
 *    ① 숨겨진 시트  = 회차 범위 안 시트 중 installed=false && responded=0
 *                    ([설치 설비만 보기]를 켜면 사라진다 — 입력할 길이 없어진다)
 *    ② 거짓 공란경고 = 설치 설비인데 범위 안 어느 시트도 안 덮는다고 나오는 것
 *  usage: npx tsx scripts/_probe-ext-map-blast.mts <before|after>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { sheetMatchesFacilities, sheetShownWhenInstalledOnly } from '../src/lib/sheet-facility-map'
import { FIRE_SUB_ITEMS } from '../src/lib/facility-codes'

const tag = process.argv[2] ?? 'run'
const env: Record<string, string> = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const out: string[] = []
const say = (s: string) => out.push(s)
const chk = <T>(l: string, r: { data: T | null; error: unknown }): T => {
  if (r.error) { console.error(l, JSON.stringify(r.error)); process.exit(1) }
  return r.data as T
}

const sheets = chk('sheets', await admin.from('inspection_sheets').select('id, sheet_code, sheet_name'))
const items: Array<{ item_code: string; sheet_id: string }> = []
for (let off = 0; ; off += 1000) {   // 1288행 — 1000행 상한 회피
  const { data, error } = await admin.from('inspection_sheet_items').select('item_code, sheet_id').range(off, off + 999)
  if (error) { console.error(JSON.stringify(error)); process.exit(1) }
  items.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const resp = chk('resp', await admin.from('inspection_sheet_responses').select('inspection_id, item_code'))
const insps = chk('insps', await admin.from('inspections').select('id, customer_id, inspection_type, plan_type'))
const custs = chk('custs', await admin.from('customers').select('id, customer_name'))
const blds = chk('blds', await admin.from('buildings').select('id, customer_id'))
const facs = chk('facs', await admin.from('fire_facilities').select('building_id, facility_code, installed'))

const custName = new Map(custs.map(c => [c.id, c.customer_name]))
const custOfBld = new Map(blds.map(b => [b.id, b.customer_id]))
const facByCust = new Map<string, Set<string>>()
for (const f of facs) {
  if (!f.installed) continue
  const c = custOfBld.get(f.building_id); if (!c) continue
  if (!facByCust.has(c)) facByCust.set(c, new Set())
  facByCust.get(c)!.add(f.facility_code)
}
const sheetOfItem = new Map(items.map(i => [i.item_code, i.sheet_id]))
const respBySheet = new Map<string, Map<string, number>>()   // inspId -> sheetId -> n
for (const r of resp) {
  const sid = sheetOfItem.get(r.item_code); if (!sid) continue
  if (!respBySheet.has(r.inspection_id)) respBySheet.set(r.inspection_id, new Map())
  const m = respBySheet.get(r.inspection_id)!
  m.set(sid, (m.get(sid) ?? 0) + 1)
}
const isSpecial = (p: string | null) => !p || p.startsWith('special')

let hiddenTotal = 0, falseUncoveredTotal = 0
say(`# tag=${tag}`)
say('=== 점검 건별 ===')
for (const insp of insps) {
  const fam = isSpecial(insp.plan_type) ? 'STD' : 'EXT'          // 회차 범위의 시트족(가드와 동일 축)
  const scope = sheets.filter(s => s.sheet_code.startsWith(fam + '-'))
  const codes = [...(facByCust.get(insp.customer_id) ?? [])]
  if (codes.length === 0) continue
  const rs = respBySheet.get(insp.id) ?? new Map()

  // 화면 규칙 **그대로** 써야 한다 — sheetMatchesFacilities만 보면 ALWAYS_SHOWN_SHEET_CODES를
  // 놓쳐 상시 노출 시트(STD-31·EXT-10~14)까지 '숨김'으로 세는 거짓 수치가 나온다.
  const hidden = scope.filter(s => !sheetShownWhenInstalledOnly({
    sheetCode: s.sheet_code,
    installed: sheetMatchesFacilities(s.sheet_name, codes),
    responded: rs.get(s.id) ?? 0,
  }))
  const uncovered = codes.filter(c => !FIRE_SUB_ITEMS.includes(c)
    && !scope.some(s => sheetMatchesFacilities(s.sheet_name, [c])))

  // 숨김은 시트가 많아 늘 다수다 — 의미 있는 건 '설치 설비를 덮는데도 숨는' 시트다.
  // 그건 uncovered 쪽으로 드러나므로 여기선 uncovered와, EXT 회차의 숨김만 센다.
  if (fam === 'EXT') hiddenTotal += hidden.length
  falseUncoveredTotal += uncovered.length
  if (uncovered.length || fam === 'EXT') {
    say(`\n${custName.get(insp.customer_id)} / ${insp.id.slice(0, 8)} type=${insp.inspection_type} plan=${insp.plan_type ?? 'NULL'} scope=${fam}`)
    say(`  설치 ${codes.length}종`)
    if (fam === 'EXT') say(`  숨겨진 EXT 시트 ${hidden.length}개: ${hidden.map(h => h.sheet_code).join(', ') || '-'}`)
    say(`  공란경고(uncovered) ${uncovered.length}종: ${uncovered.join(', ') || '-'}`)
  }
}
say(`\n=== 합계 ===`)
say(`EXT 회차의 숨겨진 시트 = ${hiddenTotal}`)
say(`공란경고 설비 = ${falseUncoveredTotal}`)

writeFileSync(`scripts/_out/ext-map-blast.${tag}.txt`, out.join('\n'), 'utf8')
console.log(out.join('\n').slice(-2000))
