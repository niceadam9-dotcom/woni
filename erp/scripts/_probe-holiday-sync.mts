/** 공휴일 동기화 검증 (소방계획서_25 S-5) — manual 보존 · stale 정리 · 폴백 표면화
 *  실행: npx tsx scripts/_probe-holiday-sync.mts   (스테이징 DB. 서버 불필요)
 *
 *  ⚠ 이 프로브는 스테이징 holidays 테이블을 **실제로 바꾼다**(동기화가 그 동작이다).
 *     심어 둔 테스트용 manual 행은 끝에 지운다.
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { syncHolidaysForYear } from '../src/lib/holiday-sync'

config({ path: '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
}) as unknown as Parameters<typeof syncHolidaysForYear>[0]

const raw = admin as unknown as ReturnType<typeof createClient>

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

const TEST_MANUAL = '2026-11-11'   // 실제 공휴일이 아닌 날 — 자동 결과에 절대 없다

// ── 준비: 수동 등록 1건 + 과다 생성분(가짜 자동 행) 1건을 심는다
await raw.from('holidays').delete().eq('date', TEST_MANUAL)
await raw.from('holidays').insert({ date: TEST_MANUAL, name: '프로브 자체휴무', is_national: false, source: 'manual' } as never)
const STALE_FAKE = '2026-11-12'    // library 출처인데 새 결과엔 없는 날 → 정리 대상이어야 한다
await raw.from('holidays').delete().eq('date', STALE_FAKE)
await raw.from('holidays').insert({ date: STALE_FAKE, name: '프로브 과다분', is_national: true, source: 'library' } as never)

console.log('=== 2026년 동기화 ===')
const res = await syncHolidaysForYear(admin, 2026)
console.log(JSON.stringify({ ...res, skippedManual: res.skippedManual, removedStale: res.removedStale }, null, 1))

check('오류 없음', !res.error, res.error ?? '')
check('원천이 공공API', res.source === 'api', `source=${res.source}`)
check('폴백 note 없음(API 정상)', !res.note, res.note ?? '')

// ── 검증 1: manual 보존
const { data: manualAfter } = await raw.from('holidays').select('name, source').eq('date', TEST_MANUAL).maybeSingle()
check('수동 등록 행이 살아 있다', !!manualAfter, '삭제됨')
check('수동 등록 source가 manual 유지', (manualAfter as { source?: string } | null)?.source === 'manual',
  String((manualAfter as { source?: string } | null)?.source))
check('수동 등록 이름이 안 바뀐다', (manualAfter as { name?: string } | null)?.name === '프로브 자체휴무',
  String((manualAfter as { name?: string } | null)?.name))

// ── 검증 2: stale 정리
const { data: staleAfter } = await raw.from('holidays').select('date').eq('date', STALE_FAKE).maybeSingle()
check('새 결과에 없는 자동 생성분은 정리된다', !staleAfter, '남아 있음')
check('removedStale에 기록된다', res.removedStale.includes(STALE_FAKE), JSON.stringify(res.removedStale))

// ── 검증 2b: **진짜 충돌 경로** — manual 행이 실제 공휴일 날짜에 있을 때.
//    관리자가 이름을 고쳐 둔 날을 자동 동기화가 되돌리면 안 된다(P-8의 핵심)
const CLASH = '2026-08-15'   // 광복절 — API가 반드시 주는 날
const { data: origin } = await raw.from('holidays').select('name, source, is_national').eq('date', CLASH).maybeSingle()
const before = origin as { name: string; source: string; is_national: boolean } | null
await raw.from('holidays').update({ name: '광복절(관리자 수정)', source: 'manual' } as never).eq('date', CLASH)

const res2 = await syncHolidaysForYear(admin, 2026)
const { data: clashAfter } = await raw.from('holidays').select('name, source').eq('date', CLASH).maybeSingle()
const after = clashAfter as { name: string; source: string } | null
check('공휴일 날짜의 수동 수정이 동기화에 덮이지 않는다', after?.name === '광복절(관리자 수정)', String(after?.name))
check('그 날짜가 skippedManual에 보고된다', res2.skippedManual.includes(CLASH), JSON.stringify(res2.skippedManual))
check('수동 전환된 행은 정리 대상이 아니다', !res2.removedStale.includes(CLASH), JSON.stringify(res2.removedStale))
// 원상복구 — ⚠ UPDATE로는 안 된다. 보호 트리거가 manual→자동 전환을 막기 때문이다.
// 되돌리는 유일한 경로는 **삭제 후 재동기화**이고, 이건 관리자에게도 똑같이 적용된다(§탈출구).
await raw.from('holidays').delete().eq('date', CLASH)
await syncHolidaysForYear(admin, 2026)
const { data: restored } = await raw.from('holidays').select('name, source').eq('date', CLASH).maybeSingle()
check('삭제 후 재동기화로 자동본 복구 가능(탈출구)',
  (restored as { source?: string } | null)?.source === 'api'
  && (restored as { name?: string } | null)?.name === before?.name,
  JSON.stringify(restored))

// ── 검증 3: 실제 교정 결과 (이번 차수가 고치려던 것)
const { data: y2026 } = await raw.from('holidays').select('date, name, source')
  .gte('date', '2026-01-01').lte('date', '2026-12-31').order('date')
const rows = (y2026 ?? []) as Array<{ date: string; name: string; source: string }>
const dates = new Set(rows.map(r => r.date))
check('2026-06-03 지방선거일 반영(종전 누락)', dates.has('2026-06-03'), '없음')
check('2026-05-01 노동절 반영(종전 누락)', dates.has('2026-05-01'), '없음')
check('2026-06-08 현충일 대체 제거(종전 과다)', !dates.has('2026-06-08'), '남아 있음')
check('2026-09-28 추석 대체 제거(종전 과다)', !dates.has('2026-09-28'), '남아 있음')

console.log('\n2026년 최종 목록:')
for (const r of rows) console.log(`  ${r.date}  ${r.name}  [${r.source}]`)

// ── 정리
await raw.from('holidays').delete().eq('date', TEST_MANUAL)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
