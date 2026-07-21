// 일회성: 구 스토리지 큐(_queue/*.json)의 대기 요청을 fire_plan_gen_jobs로 이관 후 구 큐·결과 파일 정리 (2026-07-21)
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: queue } = await sb.storage.from('fire-plans').list('_queue', { limit: 100 })
for (const item of queue ?? []) {
  if (!item.name.endsWith('.json') || item.name === '_heartbeat.json') continue
  const { data: file } = await sb.storage.from('fire-plans').download(`_queue/${item.name}`)
  if (!file) continue
  const req = JSON.parse(await file.text())
  const { error } = await sb.from('fire_plan_gen_jobs').insert({
    customer_id: req.customerId,
    customer_name: req.customerName,
    year: req.year,
    preset_type: req.presetType ?? null,
    requested_by: req.requestedBy ?? null,
    requested_by_name: req.requestedByName ?? null,
    created_at: req.requestedAt ?? undefined,
  })
  console.log(`이관: ${item.name} → ${req.customerName} ${req.year}${req.presetType ? ' · ' + req.presetType : ''}`,
    error ? `실패: ${error.message}` : 'OK')
  if (error && error.code !== '23505') process.exit(1)
}

// 구 큐·결과·하트비트 정리
const targets = (queue ?? []).map(i => `_queue/${i.name}`)
const { data: results } = await sb.storage.from('fire-plans').list('_results', { limit: 100 })
targets.push(...(results ?? []).map(i => `_results/${i.name}`))
if (targets.length) {
  const { error } = await sb.storage.from('fire-plans').remove(targets)
  console.log(`구 파일 ${targets.length}개 삭제`, error ? `실패: ${error.message}` : 'OK')
}

const { data: jobs } = await sb.from('fire_plan_gen_jobs').select('id, customer_name, year, preset_type, status, created_at')
console.log('현재 큐:', JSON.stringify(jobs, null, 2))
