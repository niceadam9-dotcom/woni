/** 인계 3건 중 3번 — 「`fire_plan_gen_jobs`는 큐라 재생성마다 쌓인다」의 실측.
 *
 *  소방계획서_45 §S12. 이 표는 문서 생성 잡의 큐인데, 같은 회차·같은 서식을 다시 생성할 때마다
 *  행이 하나씩 더 쌓인다(갱신이 아니다). 그런데 **판정에도 쓰인다** — 고객 목록 문서 스트립이
 *  `status='done'` 행의 존재로 ④⑨⑩⑪ 셀을 칠한다(customer-list.ts). 큐가 자라면
 *  ① 그 조회가 1000행 상한·URL 한계에 먼저 닿고 ② 오래된 done 행이 「지금도 파일이 있다」로 읽힌다.
 *
 *  이 프로브는 **고치지 않고 잰다** — 정리 정책(보관 기간·중복 접기)은 사용자 결정 사항이다.
 *  읽기 전용.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-45-jobqueue.mts */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('환경변수 없음'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

const { count: total } = await db.from('fire_plan_gen_jobs')
  .select('id', { count: 'exact', head: true })
const { count: done } = await db.from('fire_plan_gen_jobs')
  .select('id', { count: 'exact', head: true }).eq('status', 'done')

// 같은 (inspection_id, report_type)에 done 행이 몇 개까지 쌓였는가 = 중복 배수
const { data: rows, error } = await db.from('fire_plan_gen_jobs')
  .select('inspection_id, report_type, created_at').eq('status', 'done')
  .order('created_at', { ascending: false }).limit(1000)
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const byKey = new Map<string, number>()
for (const r of (rows ?? []) as Array<{ inspection_id: string; report_type: string }>) {
  const k = `${r.inspection_id}:${r.report_type}`
  byKey.set(k, (byKey.get(k) ?? 0) + 1)
}
const dups = [...byKey.values()]
const maxDup = dups.length ? Math.max(...dups) : 0
const overOne = dups.filter(n => n > 1).length

console.log(`전체 잡 행: ${total ?? 0}`)
console.log(`그중 status='done': ${done ?? 0}`)
console.log(`표본(최신 done ${rows?.length ?? 0}행) 안의 고유 (회차×서식) 키: ${byKey.size}`)
console.log(`  같은 키에 2행 이상 쌓인 키: ${overOne} · 최대 중복: ${maxDup}행`)
console.log('')
console.log('판정 축(고객 목록 문서 스트립)이 이 표를 읽는다 — 상한 근접도:')
const capPct = Math.round(((done ?? 0) / 1000) * 100)
console.log(`  done 행 ${done ?? 0} / 1000행 상한 = ${capPct}%`)
if ((done ?? 0) >= 1000) console.log('  🚨 이미 상한을 넘었다 — 포장 없이는 조용히 잘린다')
else console.log('  (현재는 상한 아래다. §S11에서 fetchAllRowsByIds로 감쌌으므로 넘어도 안전하다)')
console.log('')
console.log('⚠ 이 수치는 **스테이징** 기준이다. 운영은 재생성 횟수가 달라 따로 재야 한다.')
console.log('⚠ 정리 정책(보관 기간·중복 접기)은 착수하지 않았다 — 사용자 결정 대기(§S12).')
