/** 공휴일 수정(R-4)이 기대는 **DB 쪽 가정**을 실측한다 — 소방계획서_25.
 *
 *  액션(`updateHolidayAction`)은 `'use server'` + requirePermission이라 스크립트가 직접 못 부른다.
 *  그래서 액션이 **의존하는 DB 동작**을 같은 순서로 재현해 가른다. 여기가 틀리면 액션은
 *  "성공"을 반환하고도 다음 동기화가 이름을 되돌린다 — 화면상 아무 오류도 안 난다.
 *
 *  검증하는 가정 4개:
 *    ① 자동(api/library) 행을 manual로 **승격할 수 있다** — 139 트리거가 이 방향은 통과시킨다
 *    ② manual → 자동 되돌리기는 **막힌다**(139의 의도) — 승격이 편도임을 확인
 *    ③ 승격된 행은 동기화의 보호 대상이 된다(source='manual' 선조회에 걸린다)
 *    ④ 날짜를 이미 있는 날로 바꾸면 23505 — 액션이 이 코드로 안내 문구를 고른다
 *
 *  ⚠ 쓰기 검사다. 실제 공휴일과 겹치지 않도록 **2099년** 날짜만 쓰고 끝나면 지운다.
 *     실패로 중단돼도 다음 실행이 먼저 정리하므로 잔재가 쌓이지 않는다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-holiday-edit.mts */
import './_env.mjs'
import { createClient } from '@supabase/supabase-js'

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
console.log(`대상 DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

const A = '2099-01-02'   // 승격 대상
const B = '2099-01-03'   // 충돌 상대
const TAG = '__검사용_삭제해도됨__'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? `\n     ${d}` : ''}`) }
}
const cleanup = async () => { await client.from('holidays').delete().in('date', [A, B]) }
const sourceOf = async (date: string) => {
  const { data } = await client.from('holidays').select('source, name').eq('date', date).single()
  return data as { source: string; name: string } | null
}

await cleanup()   // 앞선 실패의 잔재 선정리

try {
  // 준비 — 자동 생성분처럼 심는다
  const { error: seedErr } = await client.from('holidays').insert([
    { date: A, name: `${TAG}승격대상`, is_national: true, source: 'api' },
    { date: B, name: `${TAG}충돌상대`, is_national: true, source: 'api' },
  ] as Record<string, unknown>[])
  if (seedErr) { console.log(`준비 실패: ${seedErr.message}`); process.exit(1) }

  // ① 자동 → manual 승격 (액션이 하는 것과 동일한 update)
  const { error: upErr } = await client.from('holidays')
    .update({ name: `${TAG}고친이름`, source: 'manual' } as Record<string, unknown>).eq('date', A)
  const after1 = await sourceOf(A)
  check('① 자동(api) → manual 승격이 통과한다',
    !upErr && after1?.source === 'manual' && after1?.name === `${TAG}고친이름`,
    `err=${upErr?.message ?? '-'} source=${after1?.source} name=${after1?.name}`)

  // ② manual → 자동 되돌리기는 트리거가 막는다(오류가 아니라 **조용히 무시**된다 — 139 주석)
  const { error: backErr } = await client.from('holidays')
    .update({ source: 'api' } as Record<string, unknown>).eq('date', A)
  const after2 = await sourceOf(A)
  check('② manual → 자동 되돌리기는 막힌다 (승격은 편도)',
    after2?.source === 'manual',
    `되돌아갔다 — source=${after2?.source} (err=${backErr?.message ?? '-'}). 139 트리거가 사라졌을 수 있다`)

  // ③ 승격된 행은 동기화의 보호 선조회(source='manual')에 잡힌다
  const { data: prot } = await client.from('holidays')
    .select('date').eq('source', 'manual').gte('date', '2099-01-01').lte('date', '2099-12-31')
  check('③ 승격분이 동기화 보호 대상에 들어간다',
    ((prot ?? []) as Array<{ date: string }>).some(r => r.date === A),
    '보호 선조회에 안 잡힌다 — 다음 동기화가 이름을 되돌린다')

  // ④ 날짜 충돌은 23505 — 액션이 이 코드로 "이미 등록된 날짜" 안내를 고른다
  const { error: dupErr } = await client.from('holidays')
    .update({ date: B } as Record<string, unknown>).eq('date', A)
  check('④ 날짜를 이미 있는 날로 바꾸면 23505',
    dupErr?.code === '23505',
    `실제 code=${dupErr?.code ?? '(오류 없음 — 유니크 제약이 사라졌다면 두 행이 같은 날짜를 갖게 된다)'}`)
} finally {
  await cleanup()
  const { data: left } = await client.from('holidays').select('date').in('date', [A, B])
  check('정리 완료 (검사 잔재 0건)', ((left ?? []) as unknown[]).length === 0, '검사용 행이 남았다')
}

console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
