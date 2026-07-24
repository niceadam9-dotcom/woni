// 데이터 계층 불변식 검사 (Tier 1) — UI가 가려도 데이터/액션 계층에 규칙이 없어 새는 버그류를 상시 고정.
// 실행: node scripts/check-data-invariants.mjs   (위반 시 exit 1). 읽기 전용 — .env.local의 스테이징/운영 DB 대상.
//
// INV-D1: 유형 게이트 — 일반관리·정기(monthly/event) 점검엔 별지 9/10/11호 생성잡 0건 (자체점검만 대상)
// INV-D2: 재고 정합 — current_stock >= 0 && 이동내역(in/out/adjust) 재구성값 == current_stock (동시출고 레이스 검출)
// INV-D3: 발주 입고 — purchase_order_lines.received_quantity <= quantity (이중 입고 검출)
// INV-D4: 전표 — 음수 금액 라인 0건 && 전표별 차변합 == 대변합
// INV-D5: 점검 단계수 — 일반관리·정기 = 1단계, 특별점검 = 6단계 (트리거 088 정합)
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let violations = 0
function report(name, rows, format) {
  if (!rows || rows.length === 0) { console.log(`✅ ${name} — 위반 0건`); return }
  violations += rows.length
  console.log(`❌ ${name} — 위반 ${rows.length}건`)
  for (const r of rows.slice(0, 20)) console.log('   -', format(r))
  if (rows.length > 20) console.log(`   … 외 ${rows.length - 20}건`)
}
// page.tsx isSpecial과 동일 기준 (자체점검 = 별지 9호 대상)
const isSpecial = (type, planType) => type !== '일반관리' && (!planType || planType.startsWith('special'))

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
  report('INV-D5 점검 단계수(일반/정기=1, 특별=6)', bad,
    b => `insp=${b.id} type=${b.type}/${b.plan ?? 'null'} 기대=${b.expected} 실제=${b.actual}`)
}

console.log(`\n${violations === 0 ? '✅ 전체 불변식 통과' : `❌ 총 위반 ${violations}건`}`)
process.exit(violations > 0 ? 1 : 0)
