// 공문 자동값 조회 프로브 (2026-08-20)
//   ① 수신 = 고객명, 발신일자·참조·문서번호도 자동으로 계산된다
//   ② 자동값은 **저장되지 않는다** — 조회만으로 annex_inputs 행이 생기면 안 된다
//      (저장되면 그 순간 수동값이 되어 고객명을 고쳐도 공문 수신이 옛 값으로 굳는다)
//   ③ 수정한 값은 그대로 나간다 (수동 우선)
//   ④ 화면이 자동값을 '채워 넣지' 않고 placeholder로만 비추는가 (정적 가드)
// 실행: npx tsx --require ./scripts/_stub-server-only.cjs scripts/_probe-official-autofill.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) process.env[k] = env[k]
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { assembleOfficial } = await import('../src/lib/annex-cover-official.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

let custId = '', inspId = '', profId = ''
try {
  const EMAIL = 'probe-official@erp-test.com'
  for (let page = 1; page <= 5; page++) {
    const { data: ex } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const hit = (ex?.users ?? []).find(u => u.email === EMAIL)
    if (hit) { await db.from('profiles').delete().eq('id', hit.id); await db.auth.admin.deleteUser(hit.id).catch(() => {}) }
    if ((ex?.users ?? []).length < 1000) break
  }
  const { data: au } = await db.auth.admin.createUser({ email: EMAIL, password: 'E2eTest1!', email_confirm: true })
  profId = au.user.id
  await db.from('profiles').upsert({
    id: profId, email: EMAIL, name: '공문프로브직원', employee_id: 'E2E-OFFI', role: 'employee', is_active: true,
  }, { onConflict: 'id' })

  const CUST_NAME = '공문수신테스트빌딩'
  const { data: cust, error: cErr } = await db.from('customers').insert({
    customer_code: `TEST-OFF-${Math.random().toString(36).slice(2, 7)}`,
    customer_name: CUST_NAME, address: '경기 양평군 테스트로 7',
    inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
    contract_date: '2026-01-05', is_active: true, created_by: profId,
  }).select('id').single()
  if (cErr) throw new Error(`고객 시드 실패: ${cErr.message}`)
  custId = cust.id

  const { data: ins, error: iErr } = await db.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2026-07-01', inspection_end_date: '2026-07-16',
    status: 'in_progress', assigned_employee_id: profId, created_by: profId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 시드 실패: ${iErr.message}`)
  inspId = ins.id

  console.log('\n── ① 자동값 ──')
  const r1 = await assembleOfficial(db, custId, inspId)
  check('수신 = 고객명', r1.data.recipient === CUST_NAME, r1.data.recipient)
  check('발신일자 = 점검 종료월', r1.data.sendDate === '2026년 7월', r1.data.sendDate)
  check('참조 = 기본 문구', r1.data.reference === '소방안전관리자 및 관계인', r1.data.reference)
  check('문서번호 자동 제안 — "{약칭} {YYMM}-{일련}" 꼴',
    /\d{4}-\d+$/.test(r1.data.docNo ?? ''), r1.data.docNo)

  console.log('\n── ② 조회만으로 저장되지 않는다 ──')
  const { data: rowAfterView } = await db.from('annex_inputs')
    .select('id').eq('inspection_id', inspId).eq('annex_no', 'official').maybeSingle()
  check('자동값을 계산해도 annex_inputs 행이 생기지 않는다', rowAfterView == null,
    '행이 생겼다 — 원천이 바뀌어도 옛 값이 굳는다')
  // 원천(고객명)을 바꾸면 자동값이 따라온다 — 저장하지 않았다는 증거
  await db.from('customers').update({ customer_name: '이름바꾼빌딩' }).eq('id', custId)
  const r2 = await assembleOfficial(db, custId, inspId)
  check('고객명을 고치면 수신도 따라 바뀐다', r2.data.recipient === '이름바꾼빌딩', r2.data.recipient)
  await db.from('customers').update({ customer_name: CUST_NAME }).eq('id', custId)

  console.log('\n── ③ 수정한 값이 이긴다 ──')
  await db.from('annex_inputs').insert({
    inspection_id: inspId, annex_no: 'official',
    fields: { recipient: '손으로 고친 수신처', docNo: '승 진 9999-1' },
  })
  const r3 = await assembleOfficial(db, custId, inspId)
  check('수신 수동 우선', r3.data.recipient === '손으로 고친 수신처', r3.data.recipient)
  check('문서번호 수동 우선(자동 제안을 덮는다)', r3.data.docNo === '승 진 9999-1', r3.data.docNo)
  check('손대지 않은 칸은 자동값 유지', r3.data.sendDate === '2026년 7월' && r3.data.reference === '소방안전관리자 및 관계인',
    `${r3.data.sendDate} / ${r3.data.reference}`)
  // 고객명을 다시 바꿔도 수동값은 흔들리지 않는다
  await db.from('customers').update({ customer_name: '또바꾼빌딩' }).eq('id', custId)
  const r4 = await assembleOfficial(db, custId, inspId)
  check('수동값은 원천이 바뀌어도 그대로', r4.data.recipient === '손으로 고친 수신처', r4.data.recipient)

  console.log('\n── ④ 화면은 채워 넣지 않고 비추기만 한다 (정적 가드) ──')
  const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  for (const [label, p] of [
    ['점검 작업대 공문 입력', 'src/components/inspections/inspection-workbench.tsx'],
    ['별지 서식 작성 패널', 'src/components/inspections/annex-compose-panel.tsx'],
  ]) {
    const s = src(p)
    check(`${label} — 자동값을 조회한다`, s.includes('getAnnexAutoDefaultsAction'))
    check(`${label} — placeholder로만 쓴다`, /placeholder:\s*a\b/.test(s))
    // 자동값을 입력 상태에 밀어 넣으면 저장 대상이 된다 — 그런 코드가 없어야 한다
    check(`${label} — 자동값을 입력값(state)에 넣지 않는다`,
      !/setFields\((?:[^)]*\bauto\b|prev\s*=>\s*\(\{[^}]*\bauto\b)/.test(s))
  }
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (inspId) {
    await db.from('annex_inputs').delete().eq('inspection_id', inspId)
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
