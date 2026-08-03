// 소방계획서_6 W-12: 일반관리 event 정리 + 2026 자체점검 소급 생성 (D-3·D-4·D-7)
//
// 정식 절차(실데이터 기준):
//   ⓐ 미시작·진행 중 event 건수·목록 조사 (완료 건은 읽기 전용 보존)
//   ⓑ 로그 남기고 삭제 — 연결 inspection·단계·시트 응답·불량까지 정리 (진행 중 건)
//   ⓒ 일반관리 고객 2026 자체점검(special_*) 소급 생성 (planned, 멱등)
//   ⓓ 완료 event가 같은 (plan, customer, sequence)를 점유해 UNIQUE 충돌하는 달은
//      '이행 간주·1차 생략'으로 명시 로그 (조용한 스킵 금지 — 2026-07-28 검증 발견 버그)
//
// 실행: node scripts/soban6-event-migrate.mjs [envFile] [--apply]
//   기본 dry-run(조사·로그만, 쓰기 없음). --apply 시 실제 삭제·생성.
//   envFile 기본 .env.local(스테이징). 운영: .env.local.prod-backup + 사용자 승인 필수.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envFile = args.find(a => !a.startsWith('--')) || '.env.local'
const TARGET_YEAR = 2026

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) { console.error(`${envFile}에서 URL/SERVICE_ROLE_KEY를 찾지 못했습니다.`); process.exit(1) }
console.log(`대상 DB: ${SUPABASE_URL} (${envFile}) — ${APPLY ? '⚠ APPLY 모드(실제 변경)' : 'dry-run(조사만)'}\n`)

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// ── ⓐ event 계획 항목 전수 조사 ──────────────────────────────
const { data: eventItemsRaw, error: evErr } = await admin
  .from('inspection_plan_items')
  .select('id, customer_id, plan_id, sequence_num, status, inspection_id, planned_date, scheduled_date, customers(customer_name), inspection_plans(year, month)')
  .eq('plan_type', 'event')
if (evErr) { console.error('event 조회 실패:', evErr.message); process.exit(1) }
const eventItems = eventItemsRaw ?? []

// 연결 inspection 상태 조회 (진행 중/완료 판정)
const inspIds = eventItems.map(i => i.inspection_id).filter(Boolean)
const inspById = new Map()
if (inspIds.length > 0) {
  const { data: insps } = await admin.from('inspections').select('id, status').in('id', inspIds)
  for (const i of insps ?? []) inspById.set(i.id, i)
}

const label = i => {
  const p = i.inspection_plans
  return `${i.customers?.customer_name ?? i.customer_id} ${p ? `${p.year}-${String(p.month).padStart(2, '0')}` : '?'} ${i.sequence_num}차 [${i.status}]`
}
// 보존 = 완료(항목 completed 또는 연결 점검 completed). 나머지(미시작·진행 중) = 삭제 대상
const isDone = i => i.status === 'completed'
  || (i.inspection_id && inspById.get(i.inspection_id)?.status === 'completed')
const keep = eventItems.filter(isDone)
const drop = eventItems.filter(i => !isDone(i))
const dropInProgress = drop.filter(i => i.inspection_id)
const dropIds = new Set(drop.map(i => i.id))

console.log(`ⓐ event 계획 항목 총 ${eventItems.length}건 — 보존(완료) ${keep.length} / 삭제 대상 ${drop.length} (그중 진행 중 점검 연결 ${dropInProgress.length})`)
for (const i of keep) console.log(`   보존: ${label(i)}`)
for (const i of drop) console.log(`   삭제: ${label(i)}${i.inspection_id ? ' → 연결 점검·단계·응답·불량 함께 삭제' : ''}`)

// ── ⓑ 삭제 (미시작·진행 중) ──────────────────────────────────
if (APPLY && drop.length > 0) {
  // 진행 중 건의 연결 점검 데이터부터 정리 (FK 순서: 응답·불량·단계 → 점검 → 계획 항목)
  const dropInspIds = dropInProgress.map(i => i.inspection_id)
  if (dropInspIds.length > 0) {
    for (const [table, col] of [
      ['inspection_sheet_responses', 'inspection_id'],
      ['inspection_defects', 'inspection_id'],
      ['inspection_steps', 'inspection_id'],
      ['inspection_status_log', 'inspection_id'],
      ['inspection_participants', 'inspection_id'],
    ]) {
      const { error } = await admin.from(table).delete().in(col, dropInspIds)
      if (error && error.code !== '42P01') console.log(`   (${table} 정리 경고: ${error.message})`)
    }
    // 계획 항목의 FK 해제 후 점검 삭제
    await admin.from('inspection_plan_items').update({ inspection_id: null }).in('inspection_id', dropInspIds)
    const { error: delInspErr } = await admin.from('inspections').delete().in('id', dropInspIds)
    if (delInspErr) { console.error('진행 중 점검 삭제 실패:', delInspErr.message); process.exit(1) }
    console.log(`ⓑ 진행 중 점검 ${dropInspIds.length}건 삭제 완료`)
  }
  const { error: delItemErr } = await admin.from('inspection_plan_items').delete().in('id', drop.map(i => i.id))
  if (delItemErr) { console.error('event 항목 삭제 실패:', delItemErr.message); process.exit(1) }
  console.log(`ⓑ event 계획 항목 ${drop.length}건 삭제 완료`)
} else if (drop.length > 0) {
  console.log(`ⓑ dry-run — 삭제 생략 (${drop.length}건)`)
}

// ── ⓒ 일반관리 고객 2026 자체점검 소급 생성 ──────────────────
const { data: custsRaw } = await admin.from('customers')
  .select('id, customer_name, inspection_sub_type, plan_anchor_date, assigned_employee_id')
  .eq('is_active', true).eq('inspection_category', '일반관리')
const custs = custsRaw ?? []
console.log(`\nⓒ 일반관리 활성 고객 ${custs.length}명 — ${TARGET_YEAR} 자체점검 소급 생성 (planned)`)

// 공휴일 (생성기 calcPlanned와 동일 영업일 보정)
const { data: hdRaw } = await admin.from('holidays').select('date')
  .gte('date', `${TARGET_YEAR}-01-01`).lte('date', `${TARGET_YEAR + 1}-12-31`)
const hdSet = new Set((hdRaw ?? []).map(h => h.date))
const toStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function calcPlanned(year, month, anchorDay) {
  const daysInMo = new Date(year, month, 0).getDate()
  const base = new Date(year, month - 1, Math.min(anchorDay, daysInMo))
  const d = new Date(base)
  while (d.getDay() === 0 || d.getDay() === 6 || hdSet.has(toStr(d))) d.setDate(d.getDate() + 1)
  return toStr(d)
}

// 기준일: 점검계획일(수동) → 최초 점검시작일 (생성기 loadAnchorDates와 동일)
const needAnchor = custs.filter(c => !c.plan_anchor_date).map(c => c.id)
const anchorMap = new Map(custs.filter(c => c.plan_anchor_date).map(c => [c.id, c.plan_anchor_date]))
if (needAnchor.length > 0) {
  const { data: insps } = await admin.from('inspections')
    .select('customer_id, inspection_start_date').in('customer_id', needAnchor)
    .order('inspection_start_date', { ascending: true })
  for (const r of insps ?? []) {
    if (r.inspection_start_date && !anchorMap.has(r.customer_id)) anchorMap.set(r.customer_id, r.inspection_start_date)
  }
}

// 생성자 프로필 (시스템 → 관리자)
let createdBy = null
{
  const { data: sys } = await admin.from('profiles').select('id').eq('is_system', true).limit(1)
  if (sys?.length) createdBy = sys[0].id
  else {
    const { data: adm } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1)
    if (adm?.length) createdBy = adm[0].id
  }
}
if (!createdBy) { console.error('생성자 프로필 없음'); process.exit(1) }

let created = 0, skippedExisting = 0, fulfilledByEvent = 0, noAnchor = 0
for (const c of custs) {
  const anchor = anchorMap.get(c.id)
  if (!anchor) { noAnchor++; console.log(`   기준일 없음 — 생성 없음: ${c.customer_name}`); continue }
  const subType = c.inspection_sub_type === '종합' ? '종합' : '작동'
  const anchorDate = new Date(anchor)
  const anchorMonth = anchorDate.getMonth() + 1
  const anchorDay = anchorDate.getDate()

  const targets = [{ month: anchorMonth, seq: 1 }]
  if (subType === '종합') targets.push({ month: ((anchorMonth - 1 + 6) % 12) + 1, seq: 2 })

  for (const t of targets) {
    const planned = calcPlanned(TARGET_YEAR, t.month, anchorDay)
    if (planned < anchor) continue // 기준일 이전 항목 생성 안 함 (생성기와 동일)

    // 월 계획(plan) 확보
    let planId = null
    const { data: ep } = await admin.from('inspection_plans').select('id')
      .eq('year', TARGET_YEAR).eq('month', t.month).maybeSingle()
    if (ep) planId = ep.id
    else if (APPLY) {
      const { data: np } = await admin.from('inspection_plans')
        .insert({ year: TARGET_YEAR, month: t.month, status: 'draft', auto_generated: true, created_by: createdBy })
        .select('id').single()
      planId = np?.id ?? null
    }
    if (!planId) {
      if (!APPLY) { console.log(`   생성 예정: ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} ${t.seq}차 special_${subType} (${planned}) — 월 계획 신규`); created++ }
      continue
    }

    // ⓓ 선점 항목 검사 — UNIQUE(plan_id, customer_id, sequence_num) 명시 판정 (조용한 스킵 금지)
    const { data: exist } = await admin.from('inspection_plan_items')
      .select('id, plan_type, status')
      .eq('plan_id', planId).eq('customer_id', c.id).eq('sequence_num', t.seq).maybeSingle()
    // dry-run: ⓑ에서 삭제될 event가 아직 남아 점유로 보임 — 삭제 후 기준으로 판정
    if (exist && !APPLY && dropIds.has(exist.id)) {
      created++
      console.log(`   생성 예정(삭제 후): ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} ${t.seq}차 special_${subType} (${planned})`)
      continue
    }
    if (exist) {
      if (exist.plan_type === 'event') {
        fulfilledByEvent++
        console.log(`   ⓓ 이행 간주·${t.seq}차 생략: ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} — 완료 event(${exist.status})가 점유 (UNIQUE 충돌)`)
      } else {
        skippedExisting++
        console.log(`   기존재 스킵(멱등): ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} ${t.seq}차 (${exist.plan_type}/${exist.status})`)
      }
      continue
    }

    if (APPLY) {
      const { error } = await admin.from('inspection_plan_items').insert({
        plan_id: planId, customer_id: c.id,
        inspection_type: '일반관리', inspection_category: '일반관리', inspection_sub_type: subType,
        sequence_num: t.seq, assigned_employee_id: c.assigned_employee_id || null,
        planned_date: planned, scheduled_date: null, status: 'planned',
        plan_type: `special_${subType}`,
      })
      if (error) {
        if (error.code === '23505') { fulfilledByEvent++; console.log(`   ⓓ 이행 간주·${t.seq}차 생략(레이스): ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')}`) }
        else console.error(`   생성 실패: ${c.customer_name} ${t.seq}차 — ${error.message}`)
        continue
      }
      created++
      console.log(`   생성: ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} ${t.seq}차 special_${subType} (${planned})`)
    } else {
      created++
      console.log(`   생성 예정: ${c.customer_name} ${TARGET_YEAR}-${String(t.month).padStart(2, '0')} ${t.seq}차 special_${subType} (${planned})`)
    }
  }
}

console.log(`\n요약 — event 보존 ${keep.length} / 삭제 ${APPLY ? drop.length : `예정 ${drop.length}`} · 소급 생성 ${APPLY ? created : `예정 ${created}`} · 이행 간주 생략 ${fulfilledByEvent} · 기존재 스킵 ${skippedExisting} · 기준일 없음 ${noAnchor}`)
if (!APPLY) console.log('dry-run 완료 — 실제 적용은 --apply 로 재실행하세요.')
