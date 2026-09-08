/** 강순기 건물_2에 소방계획서 서식 1.1이 요구하는 빈 칸을 채운다 (스테이징).
 *
 *  값의 출처는 **납품된 강순기 문서**다 — 지어내지 않는다. 문서에 없는 칸(높이)은 비워 둔다.
 *  🚨 이미 값이 있는 칸은 **건드리지 않는다**(덮어쓰기 금지). 무엇을 바꿨는지 전부 찍는다.
 *  실행: npx tsx scripts/_47-fill-gs2.mts [--apply]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'
config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const APPLY = process.argv.includes('--apply')
console.log(APPLY ? '=== 실제 적용 ===' : '=== 미리보기(적용 안 함) — 실제로 넣으려면 --apply ===')

/* 서식 1.1 값은 **문서에서 그때그때 읽는다** — 손으로 박으면 ①실고객 PII를 저장소에 남기고
 * ②문서가 바뀌어도 옛 값을 쓴다. 자리는 양식이 정하므로 라벨로 찾는다(인덱스로 세지 않는다). */
const HERE0 = dirname(fileURLToPath(import.meta.url))
const zf0 = await JSZip.loadAsync(readFileSync(resolve(HERE0, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form0 = parseTables(await zf0.file('Contents/section0.xml')!.async('string'))
const { bytes: b0 } = readSectionStream(readFileSync(resolve(HERE0, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const rec0 = walkRecords(b0)
const cal0 = calibrateCellOffset(rec0, form0.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))
if (!cal0 || cal0.hitRate < 0.95) throw new Error('좌표 보정 실패')
const t11i = form0.findIndex(t => t.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))
const X11 = extractTables(rec0, cal0.offset)[t11i]
/** 양식이 **토큰을 둔 자리**에서 집는다.
 *  ⚠ 라벨 옆 칸으로 집었더니 `연락처`가 같은 행의 첫 라벨(「대표자(책임자)」)을 집었다 —
 *    같은 라벨이 한 행에 두 번 나오는 서식이라 「옆 칸」 규칙이 통하지 않는다.
 *    토큰은 자리마다 유일하므로 어긋날 수 없다. */
function byToken(token: string): string {
  const slot = form0[t11i].cells.find(c => c.text.includes(`{{${token}}}`))
  if (!slot) return ''
  const v = X11.cells.find(c => c.row === slot.row && c.col === slot.col)
  return (v?.text ?? '').replace(/\s+/g, ' ').trim()
}
const DOC = {
  ownerName: byToken('owner_name'), ownerPhone: byToken('owner_phone'),
  managerName: byToken('manager_name'), managerPhone: byToken('owner_phone'),
  receiverLocation: byToken('receiver_location'),
  structure: byToken('main_structure'), roof: byToken('roof_structure'),
  // 높이: 문서에도 값이 없다(단위 「m」만) → 채우지 않는다
}
const red = (s: string) => (s ? `${s.slice(0, 2)}…(${s.length}자)` : '(빈)')
console.log('문서에서 읽은 값:', Object.entries(DOC).map(([k, v]) => `${k}=${red(v)}`).join(' · '), '\n')

const { data: cust, error: cErr } = await db.from('customers')
  .select('id, customer_name, owner_id, manager_contact_id').eq('customer_name', '강순기 건물_2').single()
if (cErr || !cust) { console.log('고객을 못 찾음:', cErr?.message); process.exit(1) }
const cid = cust.id as string
console.log(`고객 ${cust.customer_name} (${cid.slice(0, 8)}…)\n`)

const { data: contacts } = await db.from('customer_contacts')
  .select('id, role, name, phone').eq('customer_id', cid)
console.log(`기존 연락처 ${contacts?.length ?? 0}건: ${(contacts ?? []).map(c => `${(c as Record<string, unknown>).role}/${(c as Record<string, unknown>).name}`).join(', ') || '(없음)'}`)

const changes: string[] = []
async function ensureContact(role: string, name: string, phone: string): Promise<string | null> {
  const hit = (contacts ?? []).find(c => String((c as Record<string, unknown>).name).replace(/\s/g, '') === name.replace(/\s/g, ''))
  if (hit) { console.log(`  연락처 재사용: ${role} ← 기존 «${(hit as Record<string, unknown>).name}»`); return String((hit as Record<string, unknown>).id) }
  changes.push(`연락처 신규: role=${role} name=${name}`)
  if (!APPLY) return null
  const { data, error } = await db.from('customer_contacts')
    .insert({ customer_id: cid, role, name, phone }).select('id').single()
  if (error) { console.log(`  ❌ 연락처 insert 실패: ${error.message}`); return null }
  return String((data as Record<string, unknown>).id)
}

const ownerId = cust.owner_id ?? await ensureContact('대표자', DOC.ownerName, DOC.ownerPhone)
const mgrId = cust.manager_contact_id ?? await ensureContact('소방안전관리자', DOC.managerName, DOC.managerPhone)

const custPatch: Record<string, unknown> = {}
if (!cust.owner_id && ownerId) custPatch.owner_id = ownerId
if (!cust.manager_contact_id && mgrId) custPatch.manager_contact_id = mgrId
if (Object.keys(custPatch).length) {
  changes.push(`customers: ${Object.keys(custPatch).join(', ')}`)
  if (APPLY) {
    const { error } = await db.from('customers').update(custPatch).eq('id', cid)
    console.log(error ? `  ❌ customers 갱신 실패: ${error.message}` : `  ✅ customers 갱신`)
  }
}

const { data: blds } = await db.from('buildings')
  .select('id, building_name, receiver_location, structure, roof').eq('customer_id', cid)
for (const b of (blds ?? []) as Record<string, unknown>[]) {
  const patch: Record<string, unknown> = {}
  if (!String(b.receiver_location ?? '').trim()) patch.receiver_location = DOC.receiverLocation
  if (!String(b.structure ?? '').trim()) patch.structure = DOC.structure
  if (!String(b.roof ?? '').trim()) patch.roof = DOC.roof
  if (!Object.keys(patch).length) { console.log(`  건물 ${String(b.id).slice(0, 8)}… 채울 것 없음`); continue }
  changes.push(`buildings ${String(b.id).slice(0, 8)}…: ${Object.keys(patch).join(', ')}`)
  if (APPLY) {
    const { error } = await db.from('buildings').update(patch).eq('id', b.id as string)
    console.log(error ? `  ❌ 건물 갱신 실패: ${error.message}` : `  ✅ 건물 ${String(b.id).slice(0, 8)}… 갱신 (${Object.keys(patch).join(', ')})`)
  }
}

console.log(`\n바꿀(바꾼) 것 ${changes.length}건:`)
for (const c of changes) console.log('  · ' + c)
console.log('\n※ 높이는 강순기 문서에도 값이 없어(단위 m만) 채우지 않았다 — 없는 값을 지어내지 않는다')
