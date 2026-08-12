// [독립 판정] EX-4 항목1 — 마이그레이션 125 스테이징 적용 여부·백필 정확성
// 실행: node scripts/_judge-ex4-schema.mjs
//
// 경로 A(원판정, 2026-08-12 1회차): Supabase 관리 API로 information_schema/pg_constraint 직접 조회.
//   → 관리 토큰을 %TEMP%\sbtok.txt에 두고 실행. 토큰이 없으면(세션 종료 등) 아래 경로 B로 자동 폴백한다.
// 경로 B(3회차 재판정 폴백): 서비스 롤로 **행동 검증** — 스키마 문구 대신 제약이 실제로 작동하는지 본다.
//   month 컬럼 존재·기본값 0 / CHECK 0..12 / UNIQUE(inspection_id,item_code,month) / 백필 상태.
//   (2회차 데이터 소실의 원인이 '월 축 UNIQUE'였으므로 이 셋이 항목1의 실질 내용이다.)
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const TOKEN_PATH = join(process.env.TEMP ?? '.', 'sbtok.txt')
const STAGING = 'nwflnzugwylhpdyodyog'

if (existsSync(TOKEN_PATH)) {
  const token = readFileSync(TOKEN_PATH, 'utf8').trim()
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${STAGING}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    })
    const j = await r.json()
    if (r.status >= 300) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`)
    return j
  }
  const out = {}
  out.column = await q(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name='inspection_sheet_responses' AND column_name='month'`)
  out.constraints = await q(`SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid='inspection_sheet_responses'::regclass ORDER BY conname`)
  out.indexes = await q(`SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename='inspection_sheet_responses' ORDER BY indexname`)
  out.backfill = await q(`SELECT
      count(*) FILTER (WHERE item_code LIKE 'X%') AS x_rows,
      count(*) FILTER (WHERE item_code LIKE 'X%' AND month=0) AS x_month0,
      count(*) FILTER (WHERE item_code NOT LIKE 'X%') AS other_rows,
      count(*) FILTER (WHERE item_code NOT LIKE 'X%' AND month<>0) AS other_month_nonzero
    FROM inspection_sheet_responses`)
  out.backfill_match = await q(`SELECT count(*) AS mismatched FROM inspection_sheet_responses r
    JOIN inspections i ON i.id=r.inspection_id
    WHERE r.item_code LIKE 'X%' AND i.inspection_start_date IS NOT NULL
      AND r.month <> EXTRACT(MONTH FROM i.inspection_start_date)::int`)
  out.x_detail = await q(`SELECT r.inspection_id, r.item_code, r.month, i.inspection_start_date
    FROM inspection_sheet_responses r JOIN inspections i ON i.id=r.inspection_id
    WHERE r.item_code LIKE 'X%' ORDER BY r.inspection_id, r.item_code`)
  out.dup_check = await q(`SELECT count(*) AS dup_groups FROM (
      SELECT inspection_id, item_code, count(*) c FROM inspection_sheet_responses
      GROUP BY 1,2 HAVING count(*)>1) t`)
  for (const [k, v] of Object.entries(out)) console.log(`\n== ${k}\n` + JSON.stringify(v, null, 1))
  process.exit(0)
}

console.log(`[폴백] 관리 토큰 없음(${TOKEN_PATH}) → 서비스 롤 행동 검증으로 판정`)
const { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } = await import('./_e2e-helpers.mjs')

let userId = '', cid = '', iid = ''
try {
  userId = await mkUser({ email: 'judge-ex4sc@erp-test.com', name: '판정EX4스키마', employeeId: 'JUDGE-EX4SC' })
  cid = await mkCustomer({ customer_name: 'JUDGEEX4SC스키마', address: '경기 양평군 판정로 1', created_by: userId })
  const Y = new Date(Date.now() + 9 * 3600_000).getFullYear()
  const { data: i, error: ie } = await raw.from('inspections').insert({
    customer_id: cid, inspection_type: '작동', sequence_num: 1, plan_type: 'monthly',
    inspection_start_date: `${Y}-05-14`, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (ie) throw new Error(`점검 생성 실패: ${ie.message}`)
  iid = i.id

  // 1) month 컬럼 존재 + 기본값 0 (미지정 insert)
  const { data: d0, error: e0 } = await raw.from('inspection_sheet_responses')
    .insert({ inspection_id: iid, item_code: 'X1-01', result: 'O' }).select('month').single()
  check('S-1 month 컬럼 존재 · 미지정 insert 기본값 0', !e0 && d0?.month === 0, `${e0?.message ?? ''} month=${d0?.month}`)

  // 2) UNIQUE(inspection_id, item_code, month) — 같은 달 중복은 거부, 다른 달은 허용
  const { error: eDup } = await raw.from('inspection_sheet_responses')
    .insert({ inspection_id: iid, item_code: 'X1-01', result: 'X', month: 0 })
  check('S-2 같은 (건,항목,월) 중복 insert 거부(23505)', eDup?.code === '23505', `${eDup?.code} ${eDup?.message}`)
  const { error: e7 } = await raw.from('inspection_sheet_responses')
    .insert({ inspection_id: iid, item_code: 'X1-01', result: 'X', month: 7 })
  const { error: e9 } = await raw.from('inspection_sheet_responses')
    .insert({ inspection_id: iid, item_code: 'X1-01', result: 'O', month: 9 })
  check('S-2 같은 항목이라도 다른 달은 별행으로 공존(월 축 분화)', !e7 && !e9, `${e7?.message ?? ''} ${e9?.message ?? ''}`)

  // 3) CHECK 0..12
  const bad = []
  for (const m of [13, -1]) {
    const { error } = await raw.from('inspection_sheet_responses')
      .insert({ inspection_id: iid, item_code: 'X1-02', result: 'O', month: m })
    if (!error) bad.push(m)
    else if (error.code === '23514') continue
    else bad.push(`${m}:${error.code}`)
  }
  check('S-3 month 범위 CHECK 0..12 (13·-1 거부)', bad.length === 0, JSON.stringify(bad))

  // 4) 백필 상태 — 기존 외관 응답(X%)은 점검 시작월로, 비외관은 전부 0
  const { data: all } = await raw.from('inspection_sheet_responses')
    .select('inspection_id, item_code, month').neq('inspection_id', iid)
  const rows = all ?? []
  const xr = rows.filter(r => r.item_code.startsWith('X'))
  const other = rows.filter(r => !r.item_code.startsWith('X'))
  check('S-4 비외관 응답은 전부 month=0', other.every(r => r.month === 0),
    JSON.stringify(other.filter(r => r.month !== 0).slice(0, 5)))
  const ids = [...new Set(xr.map(r => r.inspection_id))]
  const { data: insps } = await raw.from('inspections').select('id, inspection_start_date').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const startM = new Map((insps ?? []).map(x => [x.id, x.inspection_start_date ? Number(x.inspection_start_date.slice(5, 7)) : null]))
  const mism = xr.filter(r => startM.get(r.inspection_id) != null && r.month !== startM.get(r.inspection_id))
  check('S-4 외관 응답 백필 = 점검 시작월 (불일치 0)', mism.length === 0, JSON.stringify(mism.slice(0, 5)))
  console.log(`[백필] 외관 X행 ${xr.length} / 비외관 ${other.length} / 외관 월 분포 ${JSON.stringify([...new Set(xr.map(r => r.month))])}`)

  // 5) (건,항목) 중복 그룹 — 월 축 도입 후에도 실데이터엔 중복 없음(백필이 한 달로 몰림)
  const key = r => `${r.inspection_id}|${r.item_code}`
  const cnt = rows.reduce((a, r) => (a[key(r)] = (a[key(r)] ?? 0) + 1, a), {})
  check('S-5 실데이터 (건,항목) 중복 그룹 0', Object.values(cnt).every(c => c === 1),
    JSON.stringify(Object.entries(cnt).filter(([, c]) => c > 1).slice(0, 5)))
} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 600))
} finally {
  if (iid) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', iid)
    await raw.from('inspections').delete().eq('id', iid)
  }
  if (cid) await cleanupCustomer(cid).catch(e => console.error('고객 정리 실패:', e.message))
  await delUser(userId)
  const { data: lc } = await raw.from('customers').select('id').like('customer_name', 'JUDGEEX4SC%')
  const { data: xr2 } = await raw.from('inspection_sheet_responses').select('id').like('item_code', 'X%')
  const { data: allr } = await raw.from('inspection_sheet_responses').select('id')
  console.log(`[정리 확인] 고객 잔존 ${(lc ?? []).length} / 외관응답 ${(xr2 ?? []).length}행(기준 26) / 전체 ${(allr ?? []).length}행(기준 170)`)
  summary()
}
