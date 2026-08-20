// 위임장 8칸 자동 채움 프로브 (2026-08-20 — 마이그레이션 146)
//   ① 관계인: 직위·생년월일을 고객 상세 관계인 레코드에서 가져온다
//   ② 대리인: 직위·연락처·생년월일을 직원 정보(profiles)에서 가져온다
//   ③ 위임장 [입력]의 수동 값은 항상 자동값을 이긴다 (이 점검 건 한정 덮어쓰기)
//   ④ 원천이 비면 종전처럼 공란 + 안내(missing)
// 실데이터 없이 assembleDelegation을 돌릴 수 없으므로(서버 액션 계열·admin 클라이언트) —
// **스테이징에 임시 고객·직원·점검을 만들어** 실제 함수를 태우고 지운다.
// 실행: npx tsx scripts/_probe-delegation-autofill.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] = env[k]
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { assembleDelegation } = await import('../src/lib/annex-cover-official.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

let custId = '', inspId = '', profId = '', contactId = ''
try {
  // ── 시드 ──────────────────────────────────────────────────────────────────
  // profiles.id = auth 사용자 id — 계정을 먼저 만든다
  const EMAIL = 'probe-delegation@erp-test.com'
  for (let page = 1; page <= 5; page++) {
    const { data: ex } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const hit = (ex?.users ?? []).find(u => u.email === EMAIL)
    if (hit) { await db.from('profiles').delete().eq('id', hit.id); await db.auth.admin.deleteUser(hit.id).catch(() => {}) }
    if ((ex?.users ?? []).length < 1000) break
  }
  const { data: au, error: aErr } = await db.auth.admin.createUser({ email: EMAIL, password: 'E2eTest1!', email_confirm: true })
  if (aErr) throw new Error(`계정 시드 실패: ${aErr.message}`)
  profId = au.user.id
  // 계정 생성 시 트리거가 profiles 행을 이미 만든다 — upsert로 값을 얹는다
  const { error: pErr } = await db.from('profiles').upsert({
    id: profId, email: EMAIL, name: '위임프로브직원', employee_id: 'E2E-DELEG', role: 'employee', is_active: true,
    position: '과장', phone: '010-5555-6666', birth_date: '1987-10-13',
  }, { onConflict: 'id' })
  if (pErr) throw new Error(`직원 시드 실패(146 미적용?): ${pErr.message}`)

  const { data: cust, error: cErr } = await db.from('customers').insert({
    customer_code: `TEST-DLG-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: '위임프로브고객', address: '경기 양평군 테스트로 1',
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true, fire_station: '양평소방서', created_by: profId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 시드 실패: ${cErr.message}`)
  custId = cust.id

  const { data: ct, error: ctErr } = await db.from('customer_contacts').insert({
    customer_id: custId, role: '대표', name: '위임프로브관계인',
    phone: '01011112222', position: '시설과장', birth_date: '1972-12-27',
  }).select('id').single()
  if (ctErr) throw new Error(`관계인 시드 실패: ${ctErr.message}`)
  contactId = ct.id
  await db.from('customers').update({ manager_contact_id: contactId }).eq('id', custId)

  const { data: ins, error: iErr } = await db.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2026-07-16', inspection_end_date: '2026-07-16',
    status: 'in_progress', assigned_employee_id: profId, created_by: profId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 시드 실패: ${iErr.message}`)
  inspId = ins.id

  // ── ①② 자동 채움 ─────────────────────────────────────────────────────────
  console.log('\n── ①② 원천에서 자동으로 가져오는가 ──')
  const r1 = await assembleDelegation(db, custId, inspId)
  const o = r1.data.owner, a = r1.data.agent
  check('관계인 성명', o.name === '위임프로브관계인', o.name)
  check('관계인 직위 ← 관계인에 저장된 직위(소방안전관리자로 단정하지 않는다)', o.position === '시설과장', o.position)
  check('관계인 연락처 ← 관계인 전화(하이픈 표기)', o.phone === '010-1111-2222', o.phone)
  check('관계인 생년월일 ← 관계인 생년월일(YYYY.MM.DD)', o.birth === '1972.12.27', o.birth)
  check('대리인 성명 ← 직원 이름', a.name === '위임프로브직원', a.name)
  check('대리인 직위 ← 직원 직책', a.position === '과장', a.position)
  check('대리인 연락처 ← 직원 연락처', a.phone === '010-5555-6666', a.phone)
  check('대리인 생년월일 ← 직원 생년월일', a.birth === '1987.10.13', a.birth)
  check('생년월일이 다 찼으면 안내(missing)에 뜨지 않는다',
    !r1.missing.some(m => m.includes('생년월일')), r1.missing.join(' | '))

  // ── ③ 수동 우선 ───────────────────────────────────────────────────────────
  console.log('\n── ③ 위임장 [입력]의 수동 값이 자동값을 이긴다 ──')
  await db.from('annex_inputs').insert({
    inspection_id: inspId, annex_no: 'delegation',
    fields: { ownerPosition: '대표이사', ownerBirth: '1960.01.01', agentPhone: '010-9999-8888' },
  })
  const r2 = await assembleDelegation(db, custId, inspId)
  check('관계인 직위 수동 우선', r2.data.owner.position === '대표이사', r2.data.owner.position)
  check('관계인 생년월일 수동 우선', r2.data.owner.birth === '1960.01.01', r2.data.owner.birth)
  check('대리인 연락처 수동 우선(표기는 정규화)', r2.data.agent.phone === '010-9999-8888', r2.data.agent.phone)
  check('수동으로 안 건드린 칸은 자동값 유지', r2.data.agent.position === '과장' && r2.data.agent.birth === '1987.10.13',
    `${r2.data.agent.position} / ${r2.data.agent.birth}`)

  // ── ④ 원천이 비면 공란 + 안내 ─────────────────────────────────────────────
  console.log('\n── ④ 원천이 비면 종전처럼 공란 + 안내 ──')
  await db.from('annex_inputs').delete().eq('inspection_id', inspId)
  await db.from('customer_contacts').update({ position: null, birth_date: null }).eq('id', contactId)
  await db.from('profiles').update({ position: null, phone: null, birth_date: null }).eq('id', profId)
  const r3 = await assembleDelegation(db, custId, inspId)
  check('관계인 직위는 저장값이 없으면 선임 여부로 추정', r3.data.owner.position === '소방안전관리자', r3.data.owner.position)
  check('관계인 생년월일 공란', r3.data.owner.birth === '', `"${r3.data.owner.birth}"`)
  check('대리인 직위·연락처·생년월일 공란',
    r3.data.agent.position === '' && r3.data.agent.phone === '' && r3.data.agent.birth === '',
    `${r3.data.agent.position}/${r3.data.agent.phone}/${r3.data.agent.birth}`)
  check('빈 칸은 안내(missing)로 알린다 — 어디서 채우는지까지',
    r3.missing.some(m => m.includes('관계인 생년월일') && m.includes('관계인 카드'))
    && r3.missing.some(m => m.includes('대리인 생년월일') && m.includes('직원')),
    r3.missing.join(' | '))
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (inspId) {
    await db.from('annex_inputs').delete().eq('inspection_id', inspId)
    await db.from('inspection_participants').delete().eq('inspection_id', inspId)
    await db.from('inspection_steps').delete().eq('inspection_id', inspId)
    await db.from('inspections').delete().eq('id', inspId)
  }
  if (custId) {
    await db.from('customer_contacts').delete().eq('customer_id', custId)
    await db.from('fire_plan_forms').delete().eq('customer_id', custId)
    await db.from('customers').delete().eq('id', custId)
  }
  if (profId) {
    await db.from('profiles').delete().eq('id', profId)
    await db.auth.admin.deleteUser(profId).catch(() => {})
  }
  console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
  process.exit(fail ? 1 : 0)
}
