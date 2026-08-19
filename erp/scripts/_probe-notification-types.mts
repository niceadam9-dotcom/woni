/** 알림 종류 정합 — 코드 ↔ 유니온 ↔ DB CHECK 3층 대조 (2026-08-19)
 *  실행: npx tsx scripts/_probe-notification-types.mts
 *
 *  왜: `type: 'law_revision'`이 CHECK에 없어 법제처 개정 알림 insert가 **항상 실패**했다.
 *  발신부는 오류를 안 보고 기준일만 올려서 개정 신호가 통째로 사라졌다(마이그레이션 143).
 *  근본 원인은 셋이 서로를 모른다는 것이다 —
 *    ① 발신부 코드의 문자열   ② lib/notification-types.ts의 유니온   ③ DB CHECK
 *  tsc는 ①→②만 본다. 그나마도 크론들은 `as Record<string, unknown>[]` 캐스팅으로 우회한다.
 *  그래서 여기서 ①→② 정적 스캔과 ②↔③ 실조회를 함께 한다.
 *
 *  드리프트가 나면 **런타임에 조용히 실패**한다(insert 오류를 삼키는 호출부가 아직 있다).
 *  늘릴 때 순서: 마이그레이션(CHECK) → notification-types.ts → 발신부.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { config } from 'dotenv'
import { NOTIFICATION_TYPES, NOTIFICATION_REFERENCE_TYPES } from '../src/lib/notification-types.ts'

config({ path: '.env.local', quiet: true })

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── ① 코드 → 유니온 : 발신부가 쓰는 문자열이 전부 유니온 안에 있는가 ──
const SRC = join(process.cwd(), 'src')
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [])
  })
}
const senders = walk(SRC).filter(p => readFileSync(p, 'utf8').includes(`from('notifications')`))
console.log(`— 코드 → 유니온 (알림을 만드는 파일 ${senders.length}개)`)

const allowed = new Set<string>([...NOTIFICATION_TYPES, ...NOTIFICATION_REFERENCE_TYPES])
const offenders: string[] = []
for (const p of senders) {
  const src = readFileSync(p, 'utf8')
  for (const m of src.matchAll(/(?<![a-zA-Z_])(?:reference_)?type:\s*'([a-z][a-z0-9_]*)'/g)) {
    if (!allowed.has(m[1])) offenders.push(`${relative(process.cwd(), p)} → '${m[1]}'`)
  }
}
check('발신부 문자열이 전부 유니온에 있다', offenders.length === 0, offenders.join(' / '))

// 스캔이 실제로 뭔가를 보고 있는지 — 0건이면 정규식이 죽은 것이고 위 단언이 공허해진다
let scanned = 0
for (const p of senders) {
  scanned += [...readFileSync(p, 'utf8').matchAll(/(?<![a-zA-Z_])(?:reference_)?type:\s*'([a-z][a-z0-9_]*)'/g)].length
}
check('스캔이 실제 문자열을 찾았다(정규식 사망 감지)', scanned >= 10, `${scanned}건`)

// ── ② 유니온 ↔ DB CHECK : 양방향 ──
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, key, { auth: { persistSession: false } })

/** CHECK 정의를 직접 못 읽으므로(pg_constraint는 RPC 없이 접근 불가) **실제로 넣어 본다**.
 *  제약 문자열을 읽는 것보다 강한 확인이다 — '정의는 맞는데 안 들어가는' 상태까지 잡는다. */
console.log('\n— 유니온 → DB : 목록의 모든 종류가 실제로 insert되는가')
const { data: who } = await admin.from('profiles').select('id').eq('is_active', true).limit(1)
const recipient = ((who ?? []) as Array<{ id: string }>)[0]?.id
if (!recipient) {
  check('수신자 확보', false, '활성 프로필이 없어 왕복 확인 불가')
} else {
  const rejected: string[] = []
  const madeIds: string[] = []
  for (const t of NOTIFICATION_TYPES) {
    const { data, error } = await admin.from('notifications')
      .insert({ recipient_id: recipient, title: '[타입 프로브] 삭제 예정', message: t, type: t, reference_type: 'document' } as Record<string, unknown>)
      .select('id').single()
    if (error) rejected.push(`${t}(${error.message.slice(0, 60)})`)
    else madeIds.push((data as { id: string }).id)
  }
  check(`유니온 ${NOTIFICATION_TYPES.length}종이 전부 DB에 들어간다`, rejected.length === 0, rejected.join(' / '))

  // 정리 — 프로브 행을 남기면 알림벨에 쓰레기가 뜬다
  if (madeIds.length > 0) await admin.from('notifications').delete().in('id', madeIds)
  const { count } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('title', '[타입 프로브] 삭제 예정')
  check('프로브 행이 남지 않는다', (count ?? 0) === 0, `${count}건 잔존`)

  // ── ③ DB → 유니온 : 목록 밖 값이 통과하면 CHECK가 헐거운 것이다 ──
  console.log('\n— DB → 유니온 : 목록 밖 값은 거부되는가')
  const { error: bogusErr } = await admin.from('notifications')
    .insert({ recipient_id: recipient, title: '[타입 프로브] 거부되어야 함', message: 'x', type: 'definitely_not_a_real_type', reference_type: 'document' } as Record<string, unknown>)
  check('목록 밖 종류는 DB가 거부한다(CHECK가 살아 있다)', !!bogusErr, bogusErr ? '' : '통과해 버렸다 — CHECK가 없거나 헐겁다')
  if (!bogusErr) await admin.from('notifications').delete().eq('title', '[타입 프로브] 거부되어야 함')
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
