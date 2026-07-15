'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 소방계획서 HWP 생성 요청 큐 (doc02 §8 확장, 2026-07-15)
 *  큐 = fire-plans 버킷 _queue/*.json — Windows 워커(scripts/fireplan-worker.py)가 폴링·처리.
 *  마이그레이션 없이 스토리지로 상태 관리. 하트비트로 워커 온라인 표시. */

const BUCKET = 'fire-plans'

export async function searchCustomersForPlanAction(q: string): Promise<{
  customers: Array<{ id: string; name: string; type: string }>
}> {
  await requirePermission('customer_manage')
  if (!q.trim()) return { customers: [] }
  const admin = createAdminClient()
  const { data } = await admin.from('customers')
    .select('id, customer_name, inspection_type')
    .eq('is_active', true)
    .ilike('customer_name', `%${q.trim()}%`)
    .order('customer_name')
    .limit(10)
  return {
    customers: ((data ?? []) as Array<{ id: string; customer_name: string; inspection_type: string }>)
      .map(c => ({ id: c.id, name: c.customer_name, type: c.inspection_type })),
  }
}

export async function requestFirePlanHwpAction(customerId: string, year: number): Promise<{ error?: string }> {
  const profile = await requirePermission('customer_manage')
  const admin = createAdminClient()

  const { data: cust } = await admin.from('customers')
    .select('customer_name').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  if (!year || year < 2000 || year > 2100) return { error: '연도를 확인해주세요.' }

  const payload = {
    customerId,
    customerName: (cust as { customer_name: string }).customer_name,
    year,
    requestedBy: profile.id,
    requestedByName: profile.name,
    requestedAt: new Date().toISOString(),
  }
  const { error } = await admin.storage.from(BUCKET).upload(
    `_queue/${Date.now()}_${customerId}.json`,
    Buffer.from(JSON.stringify(payload), 'utf8'),
    { contentType: 'application/json', upsert: false })
  if (error) return { error: `요청 등록 실패: ${error.message}` }
  return {}
}

export type GenStatus = {
  workerOnline: boolean
  pending: Array<{ name: string; customerName: string; year: number; requestedByName: string; requestedAt: string }>
  results: Array<{ name: string; ok: boolean; error?: string; customerName?: string; year?: number; customerId?: string; finishedAt?: string }>
}

export async function getFirePlanGenStatusAction(): Promise<GenStatus> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  // 하트비트 (30초 내 = 온라인)
  let workerOnline = false
  const { data: hb } = await admin.storage.from(BUCKET).download('_queue/_heartbeat.json')
  if (hb) {
    try {
      const { at } = JSON.parse(await hb.text()) as { at: string }
      workerOnline = Date.now() - new Date(at).getTime() < 30_000
    } catch { /* 무시 */ }
  }

  // 대기 중 요청
  const pending: GenStatus['pending'] = []
  const { data: queue } = await admin.storage.from(BUCKET)
    .list('_queue', { limit: 50, sortBy: { column: 'name', order: 'asc' } })
  for (const item of (queue ?? []) as Array<{ name: string }>) {
    if (!item.name.endsWith('.json') || item.name === '_heartbeat.json') continue
    const { data: file } = await admin.storage.from(BUCKET).download(`_queue/${item.name}`)
    if (!file) continue
    try {
      const p = JSON.parse(await file.text()) as { customerName: string; year: number; requestedByName: string; requestedAt: string }
      pending.push({ name: item.name, ...p })
    } catch { /* 무시 */ }
  }

  // 최근 결과 (최신 10)
  const results: GenStatus['results'] = []
  const { data: done } = await admin.storage.from(BUCKET)
    .list('_results', { limit: 10, sortBy: { column: 'name', order: 'desc' } })
  for (const item of (done ?? []) as Array<{ name: string }>) {
    if (!item.name.endsWith('.json')) continue
    const { data: file } = await admin.storage.from(BUCKET).download(`_results/${item.name}`)
    if (!file) continue
    try {
      const r = JSON.parse(await file.text()) as { ok: boolean; error?: string; customerName?: string; year?: number; finishedAt?: string }
      // 요청 파일명 규약 {ts}_{customerId}.json → 고객 상세 링크용
      const customerId = item.name.replace(/^\d+_/, '').replace(/\.json$/, '')
      results.push({ name: item.name, customerId, ...r })
    } catch { /* 무시 */ }
  }

  return { workerOnline, pending, results }
}
