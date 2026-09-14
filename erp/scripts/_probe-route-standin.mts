/** 실측 프로브 — 스테이징 실데이터에서 「진입 경로도 자리에 무엇이 인쇄되는가」를 센다 (2026-09-14)
 *
 *  검사는 지어낸 표본으로 규칙을 재고, 이 프로브는 **실제 고객들이 어떤 모양인지**를 잰다.
 *  둘은 다른 질문이다 — 규칙이 옳아도 실데이터가 그 갈래에 하나도 없으면 사용자는 아무 변화를 못 본다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-route-standin.mts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { planFirePlanImageRefs } from '../src/lib/fire-plan-image-refs.ts'

config({ path: '.env.local', quiet: true })
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data: forms } = await admin.from('fire_plan_forms').select('customer_id, sections').limit(500)
const { data: custs } = await admin.from('customers').select('id, customer_name')
const nameOf = new Map((custs ?? []).map(c => [c.id, c.customer_name as string]))

let withCover = 0, ownRoute = 0, standIn = 0, neither = 0
const samples: string[] = []

for (const f of forms ?? []) {
  const sections = (f.sections ?? {}) as Record<string, unknown>
  const { data: objs } = await admin.storage.from('fire-plans').list(`${f.customer_id}/assets`, { limit: 100 })
  const slotAssets = (objs ?? [])
    .filter(o => /^cover\.(jpg|jpeg|png|webp)$/i.test(o.name))
    .map(o => ({ slot: 'cover', path: `${f.customer_id}/assets/${o.name}` }))
  if (slotAssets.length) withCover++

  const photos = ((sections.photos as Array<{ path?: string; kind?: string; caption?: string }>) ?? [])
    .filter(p => !!p.path)
    .map(p => ({ path: p.path!, kind: p.kind ?? 'etc', caption: p.caption ?? '' }))
  const refs = planFirePlanImageRefs({ slotAssets, sections: sections as never, photos })
  const route = refs.find(r => r.kind === 'route')
  const cover = refs.find(r => r.kind === 'cover')

  if (!route) { neither++; continue }
  if (cover && route.path === cover.path) {
    standIn++
    if (samples.length < 8) samples.push(`  대역  ${nameOf.get(f.customer_id) ?? f.customer_id}`)
  } else {
    ownRoute++
    if (samples.length < 8) samples.push(`  제그림 ${nameOf.get(f.customer_id) ?? f.customer_id} — ${route.path.split('/').pop()}`)
  }
}

console.log(`서식 있는 고객 ${forms?.length ?? 0}명`)
console.log(`  표지 사진 등록 ........ ${withCover}명`)
console.log(`  진입경로 자리 = 대역(표지) ${standIn}명   ← 이번 변경으로 **새로 채워지는** 자리`)
console.log(`  진입경로 자리 = 제 그림 .. ${ownRoute}명   ← 종전대로(대역이 물러난다)`)
console.log(`  진입경로 자리 비어 있음 .. ${neither}명   ← 표지도 경로도도 없는 고객`)
console.log(samples.join('\n'))
