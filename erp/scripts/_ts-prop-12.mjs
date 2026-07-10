// TS-PROP-12: 휴가 신청 → 승인(2단계: 팀장→관리자) → 연차 차감·달력 반영 + 프로브(반려 시 차감 없음)
import { raw, BASE, PW, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMP = 'test-ts12-emp@erp-test.com', MGR = 'test-ts12-mgr@erp-test.com', ADM = 'test-ts12-adm@erp-test.com'
let empId = '', mgrId = '', admId = '', browser = null
try {
  empId = await mkUser({ email: EMP, name: 'TEST-휴가직원', employeeId: 'TEST-12E', role: 'employee' })
  mgrId = await mkUser({ email: MGR, name: 'TEST-휴가팀장', employeeId: 'TEST-12M', role: 'manager' })
  admId = await mkUser({ email: ADM, name: 'TEST-휴가관리자', employeeId: 'TEST-12A', role: 'admin' })
  await raw.from('leave_balances').insert({ employee_id: empId, year: 2026, total_days: 15, used_days: 0 })

  const l = await launch(); browser = l.browser
  // ① 직원: 휴가 신청 (연차 2일, 8/24~25)
  const pE = l.page
  await login(pE, EMP)
  await pE.goto(`${BASE}/leaves/new`)
  await pE.locator('input[type=date]').first().fill('2026-08-24')
  await pE.locator('input[type=date]').nth(1).fill('2026-08-25')
  await pE.locator('textarea').first().fill('TS-PROP-12 테스트')
  await pE.getByRole('button', { name: '휴가 신청' }).click()
  const leave = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('id, status, days_count').eq('employee_id', empId).maybeSingle(); if (data) return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('신청: leaves 생성 (pending, 2일)', leave?.status === 'pending' && Number(leave?.days_count) === 2, JSON.stringify(leave))
  check('신청 알림: 팀장에게 발송(필수)', await (async () => {
    for (let i = 0; i < 20; i++) {
      const { count } = await raw.from('notifications').select('id', { count: 'exact', head: true }).eq('type', 'leave_request').eq('recipient_id', mgrId)
      if ((count ?? 0) > 0) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })())

  // ② 팀장 승인 → manager_approved
  const ctxM = await browser.newContext(); const pM = await ctxM.newPage(); pM.setDefaultTimeout(15000)
  await login(pM, MGR)
  await pM.goto(`${BASE}/leaves/manage`)
  const rowM = pM.locator('div.px-5.py-4').filter({ hasText: 'TEST-휴가직원' }).first()
  await rowM.waitFor()
  await rowM.getByRole('button', { name: '승인' }).click()
  const st1 = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('status').eq('id', leave.id).single(); if (data.status !== 'pending') return data.status; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('팀장 승인 → manager_approved', st1 === 'manager_approved', `실제: ${st1}`)
  await ctxM.close()

  // ③ 관리자 최종 승인 → approved + 연차 차감
  const ctxA = await browser.newContext(); const pA = await ctxA.newPage(); pA.setDefaultTimeout(15000)
  await login(pA, ADM)
  await pA.goto(`${BASE}/leaves/manage`)
  const rowA = pA.locator('div.px-5.py-4').filter({ hasText: 'TEST-휴가직원' }).first()
  await rowA.waitFor()
  await rowA.getByRole('button', { name: '승인' }).click()
  const st2 = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('status').eq('id', leave.id).single(); if (data.status === 'approved') return data.status; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('관리자 최종 승인 → approved', st2 === 'approved')
  const { data: bal } = await raw.from('leave_balances').select('used_days').eq('employee_id', empId).eq('year', 2026).single()
  check('연차 차감: used_days 0 → 2', Number(bal.used_days) === 2, `실제: ${bal.used_days}`)
  check('결과 알림: 신청자 수신', await (async () => {
    const { count } = await raw.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', empId).eq('type', 'leave_approved')
    return (count ?? 0) === 1
  })())

  // ④ 휴가 달력 반영
  await pA.goto(`${BASE}/leaves/calendar`)
  await pA.getByText(/2026년/).first().waitFor()
  // 8월로 이동 (기본 7월 → next)
  await pA.getByRole('button', { name: '›' }).click().catch(() => {})
  check('휴가 달력: 승인 휴가 표시', await pA.getByText('TEST-휴가직원').first().isVisible({ timeout: 10000 }).catch(() => false))

  // 🔍 ⑤ 프로브: 두 번째 신청 반려 → 차감 없음
  await pE.goto(`${BASE}/leaves/new`)
  await pE.locator('input[type=date]').first().fill('2026-09-07')
  await pE.locator('input[type=date]').nth(1).fill('2026-09-07')
  await pE.locator('textarea').first().fill('반려 테스트')
  await pE.getByRole('button', { name: '휴가 신청' }).click()
  const leave2 = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('id').eq('employee_id', empId).eq('start_date', '2026-09-07').maybeSingle(); if (data) return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  // pending 상태 반려는 팀장 화면에서 (관리자 목록은 manager_approved만 표시)
  const ctxM2 = await browser.newContext(); const pM2 = await ctxM2.newPage(); pM2.setDefaultTimeout(15000)
  await login(pM2, MGR)
  await pM2.goto(`${BASE}/leaves/manage`)
  const rowR = pM2.locator('div.px-5.py-4').filter({ hasText: 'TEST-휴가직원' }).first()
  await rowR.waitFor()
  await rowR.getByRole('button', { name: '반려' }).click()
  await pM2.locator('textarea').last().fill('테스트 반려 사유')
  await pM2.getByRole('button', { name: '반려하기' }).click()
  const st3 = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('status').eq('id', leave2.id).single(); if (data.status === 'rejected') return data.status; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('🔍 반려 처리', st3 === 'rejected', `실제: ${st3}`)
  const { data: bal2 } = await raw.from('leave_balances').select('used_days').eq('employee_id', empId).eq('year', 2026).single()
  check('🔍 반려 시 연차 차감 없음 (2 유지)', Number(bal2.used_days) === 2, `실제: ${bal2.used_days}`)
  await ctxM2.close()
  await ctxA.close()
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  await raw.from('leaves').delete().eq('employee_id', empId)
  await raw.from('leave_balances').delete().eq('employee_id', empId)
  for (const id of [empId, mgrId, admId]) {
    await raw.from('notifications').delete().eq('recipient_id', id)
    await delUser(id)
  }
  console.log('정리 완료')
}
summary()
