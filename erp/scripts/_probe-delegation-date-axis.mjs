/** 위임장 '위임 일자 표기'가 별지 9호 보고일과 같은 축인가 (2026-08-20 사용자 확정)
 *
 *  종전엔 위임장만 점검일 축(종료일 → 시작일)이라 같은 인쇄 번들 안에서 별지 9호 보고일과
 *  날짜가 서로 달랐다. 게다가 inspection_end_date는 실측 2/188만 채워져 있어 의도(종료일)와 달리
 *  '점검 시작일'이 찍히고 있었다. 폴백을 [입력] 수기 → 별지 9호 보고일 → 오늘(KST)로 바꾼다.
 *
 *  실행: $env:NODE_OPTIONS='--conditions=react-server'; node node_modules/tsx/dist/cli.mjs scripts/_probe-delegation-date-axis.mjs
 *  쓰기: 대상 점검의 annex_inputs(report9·delegation)를 잠시 바꿨다가 **원상 복구**한다(finally). */
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY

const { createAdminClient } = await import('../src/lib/supabase/admin')
const { assembleDelegation } = await import('../src/lib/annex-cover-official')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ` — ${extra}`}`)
  ok ? pass++ : fail++
}
const admin = createAdminClient()

// 점검 시작일이 '오늘'과 다른 건을 고른다 — 그래야 '옛 축(시작일)'과 '새 축(오늘)'이 구별된다
const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().split('T')[0]
const kdate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일` }

const { data: insps } = await admin.from('inspections')
  .select('id, plan_type, inspection_start_date, inspection_end_date')
  .not('inspection_start_date', 'is', null)
  .order('inspection_start_date', { ascending: false }).limit(50)
const target = (insps ?? []).find(i =>
  (!i.plan_type || i.plan_type.startsWith('special')) && i.inspection_start_date !== kstToday)
if (!target) { console.error('조건에 맞는 자체점검 건 없음'); process.exit(1) }
console.log(`대상 점검: ${target.id}  시작 ${target.inspection_start_date} / 종료 ${target.inspection_end_date ?? '(없음)'} · 오늘(KST) ${kstToday}\n`)

const readRow = async annexNo => {
  const { data } = await admin.from('annex_inputs').select('id, fields')
    .eq('inspection_id', target.id).eq('annex_no', annexNo).maybeSingle()
  return data ?? null
}
const writeFields = async (annexNo, fields, existing) => {
  if (existing) await admin.from('annex_inputs').update({ fields }).eq('id', existing.id)
  else await admin.from('annex_inputs').insert({ inspection_id: target.id, annex_no: annexNo, fields })
}
const restore = async (annexNo, orig) => {
  const cur = await readRow(annexNo)
  if (orig) { if (cur) await admin.from('annex_inputs').update({ fields: orig.fields }).eq('id', orig.id) }
  else if (cur) await admin.from('annex_inputs').delete().eq('id', cur.id)
}

const orig9 = await readRow('report9')
const origDel = await readRow('delegation')
try {
  // ── ① 별지 9호 보고일이 지정돼 있으면 위임일자가 그걸 그대로 따라간다 ──
  console.log('── ① 보고일 수기 지정 → 위임일자가 따라간다 ──')
  await writeFields('report9', { ...(orig9?.fields ?? {}), reportDate: '2026-03-05' }, orig9)
  await writeFields('delegation', { ...(origDel?.fields ?? {}), submitDate: '' }, origDel)
  let { data } = await assembleDelegation(admin, '', target.id)
  check('보고일 2026-03-05 → 위임일자 2026년 3월 5일', data.submitDate === '2026년 3월 5일', data.submitDate)
  check('옛 축(점검 시작일)을 더 이상 쓰지 않는다',
    data.submitDate !== kdate(target.inspection_start_date),
    `시작일 표기=${kdate(target.inspection_start_date)}`)

  // ── ② 보고일 미지정이면 오늘(KST) — report9 기본 보고일과 같은 식 ──
  console.log('\n── ② 보고일 미지정 → 오늘(KST) ──')
  await writeFields('report9', { ...(orig9?.fields ?? {}), reportDate: '' }, await readRow('report9'))
  ;({ data } = await assembleDelegation(admin, '', target.id))
  check(`위임일자 = 오늘 ${kdate(kstToday)}`, data.submitDate === kdate(kstToday), data.submitDate)

  // 형식이 깨진 보고일은 무시하고 오늘로 — report9-actions의 YYYY-MM-DD 검사와 같은 규약
  await writeFields('report9', { ...(orig9?.fields ?? {}), reportDate: '2026/03/05' }, await readRow('report9'))
  ;({ data } = await assembleDelegation(admin, '', target.id))
  check('형식이 깨진 보고일은 무시(오늘로 폴백)', data.submitDate === kdate(kstToday), data.submitDate)

  // ── ③ 위임장 [입력] 수기값이 최우선 ──
  console.log('\n── ③ [입력] 수기값이 자동값을 이긴다 ──')
  await writeFields('report9', { ...(orig9?.fields ?? {}), reportDate: '2026-03-05' }, await readRow('report9'))
  await writeFields('delegation', { ...(origDel?.fields ?? {}), submitDate: '2026년 1월 1일' }, await readRow('delegation'))
  ;({ data } = await assembleDelegation(admin, '', target.id))
  check('수기 2026년 1월 1일이 보고일보다 우선', data.submitDate === '2026년 1월 1일', data.submitDate)

  // ── ④ 표기 형식 ──
  console.log('\n── ④ 표기 형식 ──')
  await writeFields('delegation', { ...(origDel?.fields ?? {}), submitDate: '' }, await readRow('delegation'))
  ;({ data } = await assembleDelegation(admin, '', target.id))
  check('YYYY년 M월 D일 (0 없는 월/일)', /^\d{4}년 \d{1,2}월 \d{1,2}일$/.test(data.submitDate), data.submitDate)
} finally {
  await restore('report9', orig9)
  await restore('delegation', origDel)
  const back9 = await readRow('report9'), backDel = await readRow('delegation')
  const same = (a, b) => JSON.stringify(a?.fields ?? null) === JSON.stringify(b?.fields ?? null)
  console.log(`\n원상 복구 — report9 ${same(orig9, back9) ? 'OK' : '❌ 불일치'} · delegation ${same(origDel, backDel) ? 'OK' : '❌ 불일치'}`)
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
