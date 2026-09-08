/** 소방계획서_47 R-1 — 강순기 문서의 입력값이 **ERP에 있는가**를 실측한다.
 *
 *  왜: 미세 격자 양식을 ERP에 붙이려면 토큰이 실제로 채워져야 한다. 강순기는 납품된 완성본이므로
 *  '그 칸에 무엇이 들어가는가'의 정답지다 — ERP가 그 값을 못 주면 양식은 빈 칸으로 나간다.
 *
 *  🚨 읽기 전용. 값은 **가려서** 찍는다(실고객 PII).
 *  실행: npx tsx scripts/_47-erp-vs-hwp.mts [.env.local|.env.production]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import JSZip from 'jszip'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset } from './hwp5-read.mts'

const ENV = process.argv[2] ?? '.env.local'
config({ path: ENV })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
console.log(`env=${ENV} · ${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/https:\/\/([^.]+).*/, '$1')}\n`)

/* ── 1. 강순기 문서에서 서식 1.1 값 뽑기 ── */
const HERE = dirname(fileURLToPath(import.meta.url))
const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const rec = walkRecords(bytes)
const cal = calibrateCellOffset(rec, form.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))!
const fills = extractTables(rec, cal.offset)
const fi = form.findIndex(t => t.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))
const F = form[fi], X = fills[fi]
const at = (r: number, c: number) => X.cells.find(x => x.row === r && x.col === c)?.text.replace(/\s+/g, ' ').trim() ?? ''
const tokenAt = (r: number, c: number) => F.cells.find(x => x.row === r && x.col === c)?.text.match(/\{\{([^}]+)\}\}/)?.[1] ?? null

/* 양식이 토큰을 둔 자리만 대조한다 — 토큰이 없는 칸은 ERP가 채울 자리가 아니다 */
const slots: { token: string; hwp: string; row: number; col: number }[] = []
for (const c of F.cells) {
  const t = c.text.match(/\{\{([^}]+)\}\}/)?.[1]
  if (t) slots.push({ token: t, hwp: at(c.row, c.col), row: c.row, col: c.col })
}
console.log(`서식 1.1의 토큰 자리 ${slots.length}개\n`)

/* ── 2. ERP에서 강순기 찾기 ── */
/* ⚠ select 목록은 실컬럼으로만 짠다 — 없는 컬럼 하나가 조용한 0행이 된다.
 *   대표자·소방안전관리자는 customers가 아니라 **연락처 표**에 있다(owner_id·manager_contact_id). */
const { data: cands, error: cErr } = await db.from('customers')
  .select('id, customer_name, address, is_active, use_approval_date, building_grade, owner_id, manager_contact_id, insurance_company, insurance_period, insurance_amount_person, insurance_amount_property, headcount_max')
  .ilike('customer_name', '%강순%')
if (cErr) { console.log('고객 조회 실패:', cErr.message); process.exit(1) }
console.log(`「강순」 포함 고객 ${cands?.length ?? 0}건`)
if (!cands?.length) {
  console.log('→ 이 환경에는 강순기가 **없다**. (운영 업무데이터는 2026-08-24 전량 삭제됨)')
  process.exit(0)
}
const cust = cands[0] as Record<string, unknown>
console.log(`대상: ${String(cust.customer_name)} (${String(cust.id).slice(0, 8)}…) 활성=${cust.is_active}\n`)

const { data: blds } = await db.from('buildings')
  .select('*').eq('customer_id', cust.id as string).eq('is_active', true).order('created_at')
const b = (blds?.[0] ?? {}) as Record<string, unknown>
console.log(`건물 ${blds?.length ?? 0}동 (대표동 기준으로 대조)\n`)

/* ── 3. 토큰 → ERP 값 (fire-plan-xlsx-values.ts의 매핑을 따른다) ── */
const s = (v: unknown) => (v == null ? '' : String(v)).trim()
/* 연락처 두 사람 — ⚠ ERP의 **실제 규칙**을 따른다(fire-plan-generate.ts:128).
 *   대표자 = customer_contacts에서 role==='대표'인 행 (없으면 첫 행).
 *   소방안전관리자 = manager_contact_id 지목 → 없으면 대표로 폴백.
 *   ⚠ 1차에 `customers.owner_id`를 대표자라고 **추측**했다가 틀렸다 — 그건 다른 표를 가리키는
 *     FK였고(042 패턴), 그 오해로 '대표자 비었음'이라 오보하고 중복 연락처를 넣을 뻔했다.
 *     FK 제약이 막아준 것이지 내가 확인해서 막은 것이 아니다. **매핑은 코드에서 읽을 것.** */
const { data: contacts } = await db.from('customer_contacts')
  .select('id, role, name, phone').eq('customer_id', cust.id as string)
const list = (contacts ?? []) as Record<string, unknown>[]
const owner = list.find(c => String(c.role) === '대표') ?? list[0]
const mgr = list.find(c => String(c.id) === String(cust.manager_contact_id ?? '')) ?? owner
console.log(`연락처 ${list.length}건 · 대표자=${owner ? '있음' : '없음'} · 관리자=${mgr ? '있음' : '없음'}\n`)

const erpOf: Record<string, string> = {
  customer_name: s(cust.customer_name),
  address: s(b.address) || s(cust.address) || s(b.address_jibun),
  owner_name: s(owner?.name),
  owner_phone: s(owner?.mobile) || s(owner?.phone),
  manager_name: s(mgr?.name),
  receiver_location: s(b.receiver_location),
  purpose: s(b.purpose),
  use_approval_date: s(cust.use_approval_date),
  total_area: s(b.total_area),
  floors: s(b.floors_above),
  height: s(b.height_m) || s(b.height),
  main_structure: s(b.structure) || s(b.main_structure),
  roof_structure: s(b.roof) || s(b.roof_structure),
  insurance_company: s(cust.insurance_company),
  insurance_period: s(cust.insurance_period),
  insurance_amount_person: s(cust.insurance_amount_person),
  insurance_amount_property: s(cust.insurance_amount_property),
}

const red = (v: string) => (v ? `${v.slice(0, 2)}…(${v.length}자)` : '(빈값)')
const same = (a: string, bb: string) => a.replace(/[\s,㎡원]/g, '') === bb.replace(/[\s,㎡원]/g, '')

let ok = 0, diff = 0, erpBlank = 0, hwpBlank = 0, noMap = 0
console.log('토큰'.padEnd(26) + 'hwp(강순기)'.padEnd(18) + 'ERP'.padEnd(18) + '판정')
console.log('─'.repeat(72))
for (const sl of slots) {
  const e = erpOf[sl.token]
  let verdict: string
  if (e === undefined) { verdict = '⚠ 매핑 없음'; noMap++ }
  else if (!sl.hwp && !e) { verdict = '· 양쪽 빈값'; hwpBlank++ }
  else if (!e) { verdict = '🚨 ERP 비었음'; erpBlank++ }
  else if (!sl.hwp) { verdict = '· hwp만 빈값'; hwpBlank++ }
  else if (same(sl.hwp, e)) { verdict = '✅ 일치'; ok++ }
  else { verdict = '❌ 다름'; diff++ }
  console.log(sl.token.padEnd(26) + red(sl.hwp).padEnd(18) + red(e ?? '').padEnd(18) + verdict)
}
console.log('─'.repeat(72))
console.log(`일치 ${ok} · 다름 ${diff} · ERP 비었음 ${erpBlank} · 빈값 ${hwpBlank} · 매핑없음 ${noMap}`)
console.log('\n※ 값은 가려서 찍는다(앞 2자+길이) — 실고객 정보라 콘솔·로그로 새면 안 된다')
