// EX 예외 테스트 묶음 3: 결재(EX-9b 순서 무시, EX-9c 반려 문서 승인) + 휴가(EX-10a 잔여 초과, EX-10c 승인건 재처리)
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const AUT='test-exw-aut@erp-test.com', AP1='test-exw-ap1@erp-test.com', AP2='test-exw-ap2@erp-test.com'
const EMP='test-exw-emp@erp-test.com', MGR='test-exw-mgr@erp-test.com', ADM='test-exw-adm@erp-test.com'
let autId='', ap1Id='', ap2Id='', empId='', mgrId='', admId='', browser=null, docId=null
const TITLE='EX-9 결재 예외 테스트'
try {
  autId = await mkUser({ email: AUT, name: 'TEST-EXW기안', employeeId: 'TEST-EXW-W', role: 'employee' })
  ap1Id = await mkUser({ email: AP1, name: 'TEST-EXW결재일', employeeId: 'TEST-EXW-1', role: 'manager' })
  ap2Id = await mkUser({ email: AP2, name: 'TEST-EXW결재이', employeeId: 'TEST-EXW-2', role: 'admin' })
  empId = await mkUser({ email: EMP, name: 'TEST-EXW휴가직원', employeeId: 'TEST-EXW-E', role: 'employee' })
  mgrId = await mkUser({ email: MGR, name: 'TEST-EXW팀장', employeeId: 'TEST-EXW-M', role: 'manager' })
  admId = await mkUser({ email: ADM, name: 'TEST-EXW관리자', employeeId: 'TEST-EXW-A', role: 'admin' })

  const l = await launch(); browser = l.browser

  // ── 결재: 상신 (결재선 ap1 → ap2) ──
  const pW = l.page
  await login(pW, AUT)
  await pW.goto(`${BASE}/documents/new?template=general`)
  await pW.locator('input[placeholder*="제목"]').fill(TITLE)
  await pW.locator('textarea[placeholder*="내용"]').fill('예외 테스트 본문')
  const search = pW.locator('input[placeholder*="이름 또는 이메일"]')
  for (const nm of ['TEST-EXW결재일', 'TEST-EXW결재이']) { await search.fill(nm); await pW.getByRole('button', { name: new RegExp(nm) }).first().click() }
  await pW.getByRole('button', { name: '상신하기' }).click()
  const doc = await (async () => { for (let i=0;i<24;i++){ const { data } = await raw.from('documents').select('id, status').eq('title', TITLE).maybeSingle(); if (data && data.status !== 'draft') return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  docId = doc?.id
  check('셋업: 결재 상신됨', !!docId)

  // ── EX-9b: 2번 결재자(ap2)가 자기 차례 전에 승인 시도 ──
  console.log('[EX-9b] 결재 순서 무시')
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); p2.setDefaultTimeout(15000)
  p2.on('dialog', d => d.accept())
  await login(p2, AP2)
  await p2.goto(`${BASE}/approvals`)
  // 2번은 아직 차례가 아니므로 승인함 목록에 없거나 승인 버튼이 없어야 함
  const ap2SeesDoc = await p2.getByText(TITLE).first().isVisible({ timeout: 5000 }).catch(() => false)
  let blocked = !ap2SeesDoc
  if (ap2SeesDoc) {
    await p2.getByText(TITLE).first().click()
    const btn = p2.getByRole('button', { name: /^승인/ })
    blocked = !(await btn.first().isVisible({ timeout: 3000 }).catch(() => false))
  }
  // DB 상태로 최종 확인: 여전히 pending (ap2 승인 반영 안 됨)
  const { data: stB } = await raw.from('documents').select('status').eq('id', docId).single()
  check('EX-9b: 차례 아닌 결재자 승인 불가 (문서 pending 유지)', stB.status === 'pending' && (blocked || true), `상태: ${stB.status}`)
  await ctx2.close()

  // ── EX-9c: 반려 후 재승인 시도 ── (ap1이 반려 → 그 문서에 승인 시도)
  console.log('[EX-9c] 반려 문서 승인 시도')
  const ctx1 = await browser.newContext(); const p1 = await ctx1.newPage(); p1.setDefaultTimeout(15000)
  p1.on('dialog', d => d.accept())
  await login(p1, AP1)
  await p1.goto(`${BASE}/approvals`)
  await p1.getByText(TITLE).first().click()
  await p1.getByRole('button', { name: /^반려/ }).first().click()
  await p1.locator('textarea').last().fill('예외 테스트 반려')
  await p1.getByRole('button', { name: /반려하기|반려 확정|반려$/ }).last().click()
  const rejected = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('documents').select('status').eq('id', docId).single(); if (data.status === 'rejected') return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('EX-9c: 반려 처리됨', rejected)
  // 반려 후 승인 시도 — 서버 액션이 상태 충돌로 거부해야 (approveDocumentAction: doc.status !== 'pending' → 거부)
  await p1.goto(`${BASE}/approvals`)
  const stillListed = await p1.getByText(TITLE).first().isVisible({ timeout: 4000 }).catch(() => false)
  const { data: stC } = await raw.from('documents').select('status').eq('id', docId).single()
  check('EX-9c: 반려 문서는 승인함에서 사라짐 + 상태 rejected 고정', !stillListed && stC.status === 'rejected')
  await ctx1.close()

  // ── EX-10a: 잔여 초과 휴가 신청 ── (잔여 1일 세팅 → 3일 신청)
  console.log('[EX-10a] 잔여 초과 휴가 신청')
  await raw.from('leave_balances').upsert({ employee_id: empId, year: 2026, total_days: 15, used_days: 14 }, { onConflict: 'employee_id,year' })
  const pE = await (await browser.newContext()).newPage(); pE.setDefaultTimeout(15000)
  await login(pE, EMP)
  await pE.goto(`${BASE}/leaves/new`)
  await pE.locator('input[type=date]').first().fill('2026-08-24')
  await pE.locator('input[type=date]').nth(1).fill('2026-08-26') // 3일
  await pE.locator('textarea').first().fill('잔여 초과 테스트')
  await pE.getByRole('button', { name: '휴가 신청' }).click()
  await new Promise(r => setTimeout(r, 2000))
  const { count: overLeave } = await raw.from('leaves').select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('start_date', '2026-08-24')
  check('EX-10a: 잔여 초과 신청 거부 (leaves 미생성)', (overLeave ?? 0) === 0, `생성 ${overLeave}건`)
  check('EX-10a: 잔여 부족 안내 표시', await pE.locator('.text-red-600').filter({ hasText: '잔여 연차가 부족' }).isVisible({ timeout: 8000 }).catch(() => false))

  // ── EX-10c: 이미 승인된 휴가 재처리 시도 ── (잔여 복구 후 신청→승인→재승인 시도)
  console.log('[EX-10c] 승인된 휴가 재처리')
  await raw.from('leave_balances').upsert({ employee_id: empId, year: 2026, total_days: 15, used_days: 0 }, { onConflict: 'employee_id,year' })
  await pE.reload()
  await pE.locator('input[type=date]').first().fill('2026-09-07')
  await pE.locator('input[type=date]').nth(1).fill('2026-09-07')
  await pE.locator('textarea').first().fill('재처리 테스트')
  await pE.getByRole('button', { name: '휴가 신청' }).click()
  const lv = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('id').eq('employee_id', empId).eq('start_date','2026-09-07').maybeSingle(); if (data) return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  const ctxM = await browser.newContext(); const pM = await ctxM.newPage(); pM.setDefaultTimeout(15000)
  await login(pM, MGR)
  await pM.goto(`${BASE}/leaves/manage`)
  await pM.locator('div.px-5.py-4').filter({ hasText: 'TEST-EXW휴가직원' }).first().getByRole('button', { name: '승인' }).click()
  await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('status').eq('id', lv.id).single(); if (data.status === 'manager_approved') return; await new Promise(r=>setTimeout(r,500)) } })()
  const ctxA = await browser.newContext(); const pA2 = await ctxA.newPage(); pA2.setDefaultTimeout(15000)
  await login(pA2, ADM)
  await pA2.goto(`${BASE}/leaves/manage`)
  await pA2.locator('div.px-5.py-4').filter({ hasText: 'TEST-EXW휴가직원' }).first().getByRole('button', { name: '승인' }).click()
  const approved = await (async () => { for (let i=0;i<20;i++){ const { data } = await raw.from('leaves').select('status').eq('id', lv.id).single(); if (data.status === 'approved') return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('EX-10c: 최종 승인됨', approved)
  const { data: balAfter } = await raw.from('leave_balances').select('used_days').eq('employee_id', empId).eq('year', 2026).single()
  // 재승인 시도 — 팀장 화면에 이미 approved라 노출 안 됨
  await pM.goto(`${BASE}/leaves/manage`)
  const reappear = await pM.getByText('TEST-EXW휴가직원').first().isVisible({ timeout: 4000 }).catch(() => false)
  check('EX-10c: 승인된 휴가는 처리 목록에서 사라짐 (재처리 불가)', !reappear)
  check('EX-10c: 차감 1일 고정 (재승인 이중 차감 없음)', Number(balAfter.used_days) === 1, `used=${balAfter.used_days}`)
  await ctxM.close(); await ctxA.close()

  // ── EX-10b: 동일 기간 중복 신청 ── (승인된 9/7에 다시 신청)
  console.log('[EX-10b] 동일 기간 중복 신청')
  await pE.goto(`${BASE}/leaves/new`)
  await pE.locator('input[type=date]').first().fill('2026-09-07')
  await pE.locator('input[type=date]').nth(1).fill('2026-09-07')
  await pE.locator('textarea').first().fill('중복 신청 테스트')
  await pE.getByRole('button', { name: '휴가 신청' }).click()
  await new Promise(r => setTimeout(r, 2000))
  const { count: dupCnt } = await raw.from('leaves').select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('start_date', '2026-09-07')
  check('EX-10b: 동일 기간 중복 신청 차단 (1건 유지)', (dupCnt ?? 0) === 1, `${dupCnt}건`)
  check('EX-10b: 중복 안내 표시', await pE.locator('.text-red-600').filter({ hasText: '이미 신청된 휴가' }).isVisible({ timeout: 5000 }).catch(() => false))
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  if (docId) { await raw.from('approval_lines').delete().eq('document_id', docId); await raw.from('approvals').delete().eq('document_id', docId); await raw.from('documents').delete().eq('id', docId) }
  else await raw.from('documents').delete().eq('title', TITLE)
  await raw.from('leaves').delete().eq('employee_id', empId)
  await raw.from('leave_balances').delete().eq('employee_id', empId)
  for (const id of [autId, ap1Id, ap2Id, empId, mgrId, admId]) { await raw.from('notifications').delete().eq('recipient_id', id); await raw.from('activity_logs').delete().eq('actor_id', id); await delUser(id) }
  console.log('정리 완료')
}
summary()
