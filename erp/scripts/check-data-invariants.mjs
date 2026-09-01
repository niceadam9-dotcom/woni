// 데이터 계층 불변식 검사 (Tier 1) — UI가 가려도 데이터/액션 계층에 규칙이 없어 새는 버그류를 상시 고정.
// 실행: node scripts/check-data-invariants.mjs [envFile]   (위반 시 exit 1). 읽기 전용(SELECT만).
//   기본 .env.local(스테이징). 운영 진단: node scripts/check-data-invariants.mjs .env.local.prod-backup
//
// INV-D1: 유형 게이트 — 정기(monthly)·레거시 event 점검엔 별지 9/10/11호 생성잡 0건 (자체점검만 대상)
// INV-D2: 재고 정합 — current_stock >= 0 && 이동내역(in/out/adjust) 재구성값 == current_stock (동시출고 레이스 검출)
// INV-D3: 발주 입고 — purchase_order_lines.received_quantity <= quantity (이중 입고 검출)
// INV-D4: 전표 — 음수 금액 라인 0건 && 전표별 차변합 == 대변합
// INV-D5: 점검 단계수 — 정기·레거시 event = 1단계, 자체점검(special_*·null) = 6단계 (트리거 111 정합)
// INV-D6: 소방계획서_6 W-5 — ⓐ 소방안전관리 sub_type null 0건 ⓑ 소방안전관리 event 계획항목 0건
//         ⓒ 일반관리 sub_type null 0건 (110 백필 후)
// INV-D7: 소방계획서_18 — 소방계획서 부속자료 고아 파일 0건
// INV-D8: 소방계획서_23 — inspection_sheet_items.group_code/group_name NULL 0건 (134 적재·seed 재실행 원복 감시)
// INV-D9: 소방계획서_23 — MU-007·MU-010 facility_type='기타' (법정 구분 이탈 재발 차단, 135)
// INV-D10: 소방계획서_25 — holidays.source가 api/library/manual 범위 안 (139)
// INV-D11: 소방계획서_25 — 대체공휴일이 토·일에 앉아 있지 않음 (「관공서의 공휴일에 관한 규정」제3조③)
// INV-D12: 소방계획서_33 — 종합 대상의 2차는 작동점검 (153) ⓐ seq2 special_* 는 전부 special_작동
//          ⓑ 종합 대상이 아닌 고객의 seq2 점검 0건 (트리거 축 이동 후 가드 생존을 결과로 감시)
// INV-D13: 종합 대상은 각 연도에 2차(special_작동 seq=2)가 정확히 1건 — 2차가 사라지는 경로가
//          여럿이라(재계산이 만들지 않고 강등만 함) **결과 축에서** 감시. 기산일이 속한 해는 제외
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// env 파일 선택 (기본 .env.local, 인자로 .env.local.prod-backup 등 지정 가능)
const envFile = process.argv[2] || '.env.local'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error(`${envFile}에서 URL/SERVICE_ROLE_KEY를 찾지 못했습니다.`); process.exit(1) }
console.log(`대상 DB: ${SUPABASE_URL} (${envFile})\n`)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let violations = 0
function report(name, rows, format) {
  if (!rows || rows.length === 0) { console.log(`✅ ${name} — 위반 0건`); return }
  violations += rows.length
  console.log(`❌ ${name} — 위반 ${rows.length}건`)
  for (const r of rows.slice(0, 20)) console.log('   -', format(r))
  if (rows.length > 20) console.log(`   … 외 ${rows.length - 20}건`)
}
// page.tsx isSpecial과 동일 기준 (자체점검 = 별지 9호 대상) — plan_type 축 단독, 관리유형 무관 (소방계획서_6 W-4)
const isSpecial = (_type, planType) => !planType || planType.startsWith('special')

// ── INV-D1: 유형 게이트 — 비-자체점검에 별지 9/10/11호 생성잡 ──
{
  const { data } = await admin.from('fire_plan_gen_jobs')
    .select('id, report_type, inspection_id, inspections(inspection_type, plan_type)')
    .in('report_type', ['report9', 'report10', 'report11'])
  const bad = (data ?? []).filter(j => j.inspections && !isSpecial(j.inspections.inspection_type, j.inspections.plan_type))
  report('INV-D1 비자체점검 별지 9/10/11호 잡', bad,
    j => `insp=${j.inspection_id} type=${j.inspections.inspection_type}/${j.inspections.plan_type ?? 'null'} report=${j.report_type}`)
}

// ── INV-D2: 재고 정합 ──
{
  const { data: items } = await admin.from('inventory_items').select('id, name, current_stock')
  const neg = (items ?? []).filter(i => (i.current_stock ?? 0) < 0)
  report('INV-D2a 재고 음수', neg, i => `${i.name}: ${i.current_stock}`)

  const { data: moves } = await admin.from('stock_movements')
    .select('item_id, movement_type, quantity, after_stock, created_at').order('created_at', { ascending: true })
  const byItem = new Map()
  for (const m of moves ?? []) { if (!byItem.has(m.item_id)) byItem.set(m.item_id, []); byItem.get(m.item_id).push(m) }
  const mism = []
  const stockOf = new Map((items ?? []).map(i => [i.id, i]))
  for (const [itemId, ms] of byItem) {
    let running = 0
    for (const m of ms) {
      if (m.movement_type === 'in') running += m.quantity
      else if (m.movement_type === 'out') running -= m.quantity
      else running = m.quantity   // adjust = 절대값 설정
    }
    const it = stockOf.get(itemId)
    if (it && running !== it.current_stock) mism.push({ name: it.name, running, current: it.current_stock })
  }
  report('INV-D2b 재고 재구성 불일치(동시출고 레이스)', mism,
    m => `${m.name}: 이동재구성=${m.running} ≠ current_stock=${m.current}`)
}

// ── INV-D3: 발주 입고 수량 초과 ──
{
  const { data } = await admin.from('purchase_order_lines').select('id, po_id, item_id, quantity, received_quantity')
  const bad = (data ?? []).filter(l => (l.received_quantity ?? 0) > (l.quantity ?? 0))
  report('INV-D3 입고 초과(received > quantity)', bad, l => `po=${l.po_id} item=${l.item_id} rcv=${l.received_quantity}/${l.quantity}`)
}

// ── INV-D4: 전표 음수·차대 불일치 ──
{
  const { data: lines } = await admin.from('voucher_lines').select('id, voucher_id, debit_amount, credit_amount')
  const neg = (lines ?? []).filter(l => (l.debit_amount ?? 0) < 0 || (l.credit_amount ?? 0) < 0)
  report('INV-D4a 전표 음수 금액 라인', neg, l => `voucher=${l.voucher_id} debit=${l.debit_amount} credit=${l.credit_amount}`)
  const sums = new Map()
  for (const l of lines ?? []) {
    const s = sums.get(l.voucher_id) ?? { d: 0, c: 0 }
    s.d += l.debit_amount ?? 0; s.c += l.credit_amount ?? 0
    sums.set(l.voucher_id, s)
  }
  const unbal = [...sums.entries()].filter(([, s]) => Math.round(s.d) !== Math.round(s.c)).map(([id, s]) => ({ id, ...s }))
  report('INV-D4b 전표 차대 불일치', unbal, v => `voucher=${v.id} 차변=${v.d} 대변=${v.c}`)
}

// ── INV-D5: 점검 단계수 정합 ──
{
  const { data: insps } = await admin.from('inspections').select('id, inspection_type, plan_type')
  const { data: steps } = await admin.from('inspection_steps').select('inspection_id')
  const cnt = new Map()
  for (const s of steps ?? []) cnt.set(s.inspection_id, (cnt.get(s.inspection_id) ?? 0) + 1)
  const bad = []
  for (const i of insps ?? []) {
    const expected = isSpecial(i.inspection_type, i.plan_type) ? 6 : 1
    const actual = cnt.get(i.id) ?? 0
    if (actual !== expected) bad.push({ id: i.id, type: i.inspection_type, plan: i.plan_type, expected, actual })
  }
  report('INV-D5 점검 단계수(정기·event=1, 자체점검=6)', bad,
    b => `insp=${b.id} type=${b.type}/${b.plan ?? 'null'} 기대=${b.expected} 실제=${b.actual}`)
}

// ── INV-D6: 소방계획서_6 W-5 — sub_type·event 정합 ──
{
  // ⓐ 소방안전관리 고객 sub_type null 0건 (030 백필 기존재 보증)
  const { data: d6a } = await admin.from('customers')
    .select('id, customer_name')
    .eq('inspection_category', '소방안전관리').is('inspection_sub_type', null)
  report('INV-D6a 소방안전관리 sub_type null', d6a ?? [], c => `${c.customer_name} (${c.id})`)

  // ⓑ 소방안전관리 event 계획항목 0건 (event 경로는 일반관리 전용이었음 — D-8 무영향 보증)
  const { data: d6b } = await admin.from('inspection_plan_items')
    .select('id, customer_id, inspection_category')
    .eq('plan_type', 'event').eq('inspection_category', '소방안전관리')
  report('INV-D6b 소방안전관리 event 계획항목', d6b ?? [], i => `item=${i.id} customer=${i.customer_id}`)

  // ⓒ 일반관리 고객 sub_type null 0건 (110 백필 후 — 신규 저장은 W-2가 필수화)
  const { data: d6c } = await admin.from('customers')
    .select('id, customer_name')
    .eq('inspection_category', '일반관리').is('inspection_sub_type', null)
  report('INV-D6c 일반관리 sub_type null (110 백필 후)', d6c ?? [], c => `${c.customer_name} (${c.id})`)
}

// ── INV-D7: 소방계획서_18 — 소방계획서 부속자료 고아 파일 ──
// 부속자료 행은 fire_plans 삭제 시 FK CASCADE(086)로 함께 사라진다. 파일을 먼저 지우지 않고
// 행을 지우면 아무도 접근할 수 없는 파일만 스토리지에 남는다(업로드 원본이라 재생성 불가).
// 삭제 경로가 여럿이라(정리 액션·개별 삭제) 코드 리뷰로는 놓치기 쉬워, 결과 자체를 감시한다.
{
  const attFiles = []
  const { data: planDirs } = await admin.storage.from('fire-plans').list('att', { limit: 1000 })
  for (const d of planDirs ?? []) {
    if (d.id !== null) continue   // att/ 아래는 계획서 id 폴더뿐
    const { data: files } = await admin.storage.from('fire-plans').list(`att/${d.name}`, { limit: 1000 })
    for (const f of files ?? []) if (f.id !== null) attFiles.push(`att/${d.name}/${f.name}`)
  }
  let orphans = []
  if (attFiles.length > 0) {
    const { data: rows } = await admin.from('fire_plan_attachments').select('file_path')
    const known = new Set((rows ?? []).map(r => r.file_path))
    orphans = attFiles.filter(p => !known.has(p))
  }
  report('INV-D7 부속자료 고아 파일(참조 행 없음)', orphans, p => p)
}

// ── INV-D8: 소방계획서_23 — 점검표 그룹 축(134) NULL 감시 ──
// 134가 전 행을 백필하고 seed도 같은 값을 채우도록 정정했다(S3A). 여기가 깨지면
// 누군가 그룹 축 없는 경로로 항목을 넣었거나 구판 seed를 재실행한 것이다(R-9 재발).
{
  const { data, error } = await admin.from('inspection_sheet_items')
    .select('item_code, group_code, group_name')
    .or('group_code.is.null,group_name.is.null').limit(50)
  if (error && /column .* does not exist|42703/.test(`${error.message} ${error.code}`)) {
    report('INV-D8 그룹 축 NULL(group_code/group_name)', [{ item_code: '(컬럼 없음 — 마이그레이션 134 미적용)' }], r => r.item_code)
  } else {
    report('INV-D8 그룹 축 NULL(group_code/group_name)', data ?? [], r => `${r.item_code} code=${r.group_code} name=${r.group_name}`)
  }
}

// ── INV-D9: 소방계획서_23 — MU 법정 구분(135) 이탈 감시 ──
// MU-007 피난안내도·MU-010 창 문은 법정 서식상 '기타' 구분이다(P-4·P-5 정정).
// seed 재실행·수동 편집으로 구판 값('피난구조설비')이 되살아나는 것을 결과 축에서 잡는다.
{
  const { data } = await admin.from('inspection_sheet_items')
    .select('item_code, facility_type')
    .in('item_code', ['MU-007', 'MU-010']).neq('facility_type', '기타')
  report("INV-D9 MU-007·MU-010 facility_type≠'기타'", data ?? [], r => `${r.item_code} facility_type=${r.facility_type}`)
}

// ── INV-D10: 소방계획서_25 — 공휴일 출처 축(139) 감시 ──
// source가 범위를 벗어나면 동기화가 그 행을 '자동 생성분'으로도 '수동'으로도 못 다뤄
// 정리 대상에서 조용히 빠지거나 반대로 지워진다. 컬럼이 없으면 139 미적용이다.
{
  const { data, error } = await admin.from('holidays')
    .select('date, source').not('source', 'in', '("api","library","manual")').limit(50)
  if (error && /column .* does not exist|42703/.test(`${error.message} ${error.code}`)) {
    report('INV-D10 공휴일 source 범위', [{ date: '(컬럼 없음 — 마이그레이션 139 미적용)', source: '' }], r => r.date)
  } else {
    report('INV-D10 공휴일 source 범위', data ?? [], r => `${r.date} source=${r.source}`)
  }
}

// ── INV-D11: 소방계획서_25 — 대체공휴일이 주말에 앉아 있지 않은가 ──
// 「관공서의 공휴일에 관한 규정」제3조③에 따라 대체공휴일은 토요일이 될 수 없고,
// 일요일은 그 자체가 공휴일(제2조1호)이라 대체 대상이 아니다. 여기가 걸리면
// 산출 로직이 되돌아갔거나 손으로 잘못 넣은 것이다.
{
  const { data } = await admin.from('holidays').select('date, name').like('name', '대체공휴일%')
  const weekendSubs = (data ?? []).filter(r => {
    const d = new Date(`${r.date}T00:00:00`).getDay()
    return d === 0 || d === 6
  })
  report('INV-D11 대체공휴일이 주말(제3조③ 위반)', weekendSubs, r => `${r.date} ${r.name}`)
}

// ── INV-D12: 소방계획서_33 — 종합 대상의 2차는 작동점검이다 (153) ──
// 종합점검 대상 건물은 사용승인월에 종합(1차), +6개월에 작동(2차)을 한다. 2차를 '종합'으로
// 저장하면 별지 9호 체크박스·표지 제목·갑지 A2·점검표 범위가 전부 2차를 종합으로 인쇄한다.
// 되돌리는 경로가 많아(생성기·수동추가·초과해결·고객동기화·수동등록) **결과 축에서** 감시한다.
{
  // 한글 리터럴은 코드포인트로 만든다 — 소스 인코딩이 깨져도 술어가 조용히 0건이 되지 않게.
  const JONGHAP = String.fromCodePoint(0xC885, 0xD569)
  const JAKDONG = String.fromCodePoint(0xC791, 0xB3D9)
  const SPECIAL_OP = `special_${JAKDONG}`

  // D12a: seq2 + special_* 인데 special_작동이 아닌 행 (plan_items·inspections 양쪽).
  // monthly/event의 seq2는 작동 고객의 정상 데이터라 제외한다.
  const { data: piRows } = await admin.from('inspection_plan_items')
    .select('id, customer_id, plan_type, inspection_sub_type').eq('sequence_num', 2)
  const a1 = (piRows ?? []).filter(r => (r.plan_type ?? '').startsWith('special') && r.plan_type !== SPECIAL_OP)
  report('INV-D12a 2차 계획항목이 작동이 아님', a1,
    r => `item=${r.id} plan_type=${r.plan_type} sub=${r.inspection_sub_type}`)

  const { data: insRows } = await admin.from('inspections')
    .select('id, customer_id, plan_type, inspection_type').eq('sequence_num', 2)
  const a2 = (insRows ?? []).filter(r => (r.plan_type ?? '').startsWith('special') && r.plan_type !== SPECIAL_OP)
  report('INV-D12a 2차 점검이 작동이 아님', a2,
    r => `insp=${r.id} plan_type=${r.plan_type} type=${r.inspection_type}`)

  // D12b: 2차인데 고객이 종합 대상이 아닌 행 — 153 트리거 생존을 **결과 축에서** 감시.
  // 트리거는 inspections에만 걸려 있다(계획 항목엔 작동 고객의 정상 monthly seq2가 있다).
  const { data: allCust } = await admin.from('customers')
    .select('id, inspection_type, inspection_sub_type')
  const compIds = new Set((allCust ?? [])
    .filter(c => c.inspection_sub_type === JONGHAP
      || (c.inspection_sub_type == null && c.inspection_type === JONGHAP))
    .map(c => c.id))
  const b = (insRows ?? []).filter(r => !compIds.has(r.customer_id))
  report('INV-D12b 종합 대상이 아닌 고객의 2차 점검', b,
    r => `insp=${r.id} customer=${r.customer_id} plan_type=${r.plan_type}`)
}

// ── INV-D13: 종합 대상 고객은 각 연도에 2차(special_작동, seq=2)가 정확히 1건 ──
// 왜 결과 축인가: 2차가 사라지는 경로가 여럿이었다 — 재계산이 자리 교체만 하고 생성은 안 했고
// (요청서를 발행하고 아무도 안 읽음), 옛 달의 2차는 강등으로 치워지기까지 했다. 코드가 어떻게
// 바뀌든 어느 경로로 깨지든 **결과에서** 잡는다. 법정으로는 종합 대상의 2차가 연 1회 의무다.
//
// ⚠ **기산일이 속한 해는 제외한다.** 생성기는 `planned < anchorDate`면 만들지 않는다(기준일
//   이전엔 이행 의무가 없다). 기산월이 연중·연말이면 첫 해의 2차는 **정당하게** 없다.
//   이 예외 없이 켰을 때 실측 위반 7건이 **전부 첫 해 오탐**이었다 — 좁히니 3건(진짜)만 남았다.
{
  const JONGHAP = String.fromCodePoint(0xC885, 0xD569)
  const JAKDONG = String.fromCodePoint(0xC791, 0xB3D9)
  const SPECIAL_OP = `special_${JAKDONG}`

  const { data: cRows } = await admin.from('customers')
    .select('id, customer_code, customer_name, is_active, inspection_type, inspection_sub_type, use_approval_date, plan_anchor_date')
  // plan_anchor_manual은 155 미적용 DB엔 없다 — 별도·관용 조회(없으면 레거시로 본다)
  const manualOf = new Map()
  {
    const { data, error } = await admin.from('customers').select('id, plan_anchor_manual')
    if (!error) for (const r of data ?? []) manualOf.set(r.id, r.plan_anchor_manual)
  }
  const comp = (cRows ?? []).filter(c => c.is_active !== false
    && (c.inspection_sub_type === JONGHAP || (c.inspection_sub_type == null && c.inspection_type === JONGHAP)))

  // ⚠ **페이지 순회 필수.** PostgREST는 요청당 1,000행에서 **조용히 자른다**. 전량 조회를
  //   한 번에 던졌더니 뒤쪽 고객이 통째로 '2차 없음'이 되어 위반이 2건 → **57건으로 부풀었다**
  //   (실측). 잘린 줄 모르고 그 수를 믿으면 멀쩡한 데이터를 고치러 간다.
  const piAll = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('inspection_plan_items')
      .select('customer_id, sequence_num, plan_type, plan:inspection_plans(year)')
      .range(from, from + 999)
    if (error) break
    piAll.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const years = new Map(), seq2 = new Map()
  for (const it of piAll ?? []) {
    if (!it.plan) continue
    const ys = years.get(it.customer_id) ?? new Set(); ys.add(it.plan.year); years.set(it.customer_id, ys)
    if (it.sequence_num === 2 && it.plan_type === SPECIAL_OP) {
      const k = `${it.customer_id}|${it.plan.year}`
      seq2.set(k, (seq2.get(k) ?? 0) + 1)
    }
  }
  const bad = []
  for (const c of comp) {
    const anc = manualOf.get(c.id) ? c.plan_anchor_date : (c.use_approval_date ?? c.plan_anchor_date)
    const anchorYear = anc ? Number(String(anc).slice(0, 4)) : null
    for (const y of (years.get(c.id) ?? new Set())) {
      if (anchorYear === y) continue            // 기산일이 속한 해 — 기준일 이전이라 정당하게 없을 수 있다
      const n = seq2.get(`${c.id}|${y}`) ?? 0
      if (n !== 1) bad.push({ c, y, n })
    }
  }
  report('INV-D13 종합 대상의 연도별 2차(작동) 정확히 1건', bad,
    r => `${r.c.customer_code} ${r.c.customer_name} ${r.y}년: ${r.n}건`)
}

console.log(`\n${violations === 0 ? '✅ 전체 불변식 통과' : `❌ 총 위반 ${violations}건`}`)
process.exit(violations > 0 ? 1 : 0)
