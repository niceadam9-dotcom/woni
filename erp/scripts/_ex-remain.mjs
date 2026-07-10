// EX 예외 나머지: EX-8b(초과 이중 해결 멱등), EX-13d(마감 알림 전원 수신거부 시 발송 0건)
import { readFileSync } from 'fs'
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const ADM = 'test-exr-adm@erp-test.com'
let admId = '', custId = '', browser = null
const NAME = 'TEST-예외나머지-빌딩'
const createdPlanIds = []
try {
  admId = await mkUser({ email: ADM, name: 'TEST-EXR관리자', employeeId: 'TEST-EXR' })
  // deadline 알림 끔
  await raw.from('profiles').update({ notification_prefs: { deadline: false } }).eq('id', admId)
  custId = await mkCustomer({ customer_name: NAME, created_by: admId, use_approval_date: '2021-04-12', assigned_employee_id: admId })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, ADM)

  // ── EX-8b: 미점검 초과 이중 해결 (멱등) ──
  console.log('[EX-8b] 초과 이중 해결 멱등')
  const { data: p04b } = await raw.from('inspection_plans').select('id').eq('year', 2026).eq('month', 4).maybeSingle()
  const resolveOnce = async () => {
    await page.goto(`${BASE}/inspection-plans?year=2026&month=7&view=list`)
    const banner = await page.getByText(/미점검 초과 \d+건/).isVisible({ timeout: 10000 }).catch(() => false)
    if (!banner) return false
    await page.getByRole('button', { name: '자동 해결' }).click()
    await page.getByText('미점검 초과 자동 해결').waitFor()
    const modal = page.locator('div.fixed').filter({ hasText: '미점검 초과 자동 해결' })
    const btn = modal.getByRole('button', { name: /승인 — \d+건/ })
    if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) { await page.keyboard.press('Escape'); return false }
    await btn.click()
    await modal.getByRole('button', { name: /완료/ }).click()
    await new Promise(r => setTimeout(r, 1500))
    return true
  }
  const first = await resolveOnce()
  const cnt1 = ((await raw.from('inspection_plan_items').select('id', { count: 'exact', head: true }).eq('customer_id', custId)).count) ?? 0
  check('EX-8b: 1차 해결로 항목 생성', first && cnt1 > 0, `생성 ${cnt1}건`)
  // 2차 시도 — 경보에서 이미 빠졌으면 재생성 없음
  const second = await resolveOnce()
  const cnt2 = ((await raw.from('inspection_plan_items').select('id', { count: 'exact', head: true }).eq('customer_id', custId)).count) ?? 0
  check('EX-8b: 이중 해결 시 중복 생성 없음 (경보 소멸로 재해결 대상 아님)', cnt2 === cnt1, `1차 ${cnt1} → 2차 ${cnt2}`)
  if (!p04b) { const { data: p04 } = await raw.from('inspection_plans').select('id').eq('year',2026).eq('month',4).maybeSingle(); if (p04) createdPlanIds.push(p04.id) }

  // ── EX-13d: 마감 임박 알림 — 전원 deadline 수신거부 시 발송 0건 ──
  console.log('[EX-13d] 마감 알림 전원 수신거부')
  // 모든 활성 manager/admin의 deadline을 임시로 끔 (원복 위해 이전 값 저장)
  const { data: mgrs } = await raw.from('profiles').select('id, notification_prefs').in('role', ['manager','admin']).eq('is_active', true).eq('is_system', false)
  const prev = new Map((mgrs ?? []).map(p => [p.id, p.notification_prefs]))
  for (const m of mgrs ?? []) await raw.from('profiles').update({ notification_prefs: { ...(m.notification_prefs ?? {}), deadline: false } }).eq('id', m.id)
  // 오늘(KST) 마감인 단계를 가진 점검 준비 (관리자 담당, deadline 오늘)
  const kstToday = new Date(Date.now() + 9*60*60*1000).toISOString().split('T')[0]
  const { data: insp } = await raw.from('inspections').insert({ customer_id: custId, inspection_type:'작동', sequence_num:1, inspection_start_date: kstToday, status:'in_progress', assigned_employee_id: admId, created_by: admId }).select('id').single()
  // DB 트리거가 6단계 생성했을 것 — step 하나의 due_date를 오늘로
  const { data: st } = await raw.from('inspection_steps').select('id').eq('inspection_id', insp.id).order('step_num').limit(1)
  if (st?.[0]) await raw.from('inspection_steps').update({ due_date: kstToday, status: 'pending' }).eq('id', st[0].id)
  const before = ((await raw.from('notifications').select('id', { count:'exact', head:true }).eq('recipient_id', admId).eq('type','inspection_step_due')).count) ?? 0
  const res = await fetch(`${BASE}/api/cron/inspection-deadline-notify`, { headers: env.CRON_SECRET ? { authorization: `Bearer ${env.CRON_SECRET}` } : {} }).then(r => r.json())
  const after = ((await raw.from('notifications').select('id', { count:'exact', head:true }).eq('recipient_id', admId).eq('type','inspection_step_due')).count) ?? 0
  check('EX-13d: 크론 정상 응답 (오류 없음)', res.ok === true, JSON.stringify(res))
  check('EX-13d: deadline 끈 관리자에게 마감 알림 미발송', after === before, `before ${before} → after ${after}`)
  // 원복
  for (const [id, val] of prev) await raw.from('profiles').update({ notification_prefs: val ?? {} }).eq('id', id)
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  for (const pid of createdPlanIds) { const { count } = await raw.from('inspection_plan_items').select('id',{count:'exact',head:true}).eq('plan_id', pid); if ((count??0)===0) await raw.from('inspection_plans').delete().eq('id', pid) }
  await delUser(admId)
  console.log('정리 완료')
}
summary()
