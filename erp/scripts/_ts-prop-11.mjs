// TS-PROP-11: 결재 상신(결재선 2단) → 순차 승인 → 문서 상태·결재함·알림 전파 + 프로브(알림 꺼도 데이터 전파)
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const AUT = 'test-ts11-author@erp-test.com', AP1 = 'test-ts11-ap1@erp-test.com', AP2 = 'test-ts11-ap2@erp-test.com'
let autId = '', ap1Id = '', ap2Id = '', browser = null, docId = null
const TITLE = 'TS-PROP-11 결재 전파 테스트'
try {
  autId = await mkUser({ email: AUT, name: 'TEST-기안자', employeeId: 'TEST-11W', role: 'employee' })
  ap1Id = await mkUser({ email: AP1, name: 'TEST-결재자일', employeeId: 'TEST-11X', role: 'manager' })
  ap2Id = await mkUser({ email: AP2, name: 'TEST-결재자이', employeeId: 'TEST-11Y', role: 'admin' })
  // 🔍 프로브 준비: 기안자가 결재 결과 알림을 끔 — 데이터 전파는 유지되어야
  await raw.from('profiles').update({ notification_prefs: { approval_result: false } }).eq('id', autId)

  const l = await launch(); browser = l.browser
  const pW = l.page
  await login(pW, AUT)

  // ① 기안서 작성 + 결재선 2명 지정 + 상신
  await pW.goto(`${BASE}/documents/new?template=general`)
  await pW.locator('input[placeholder*="제목"]').fill(TITLE)
  await pW.locator('textarea[placeholder*="내용"]').fill('전파 테스트 본문')
  const search = pW.locator('input[placeholder*="이름 또는 이메일"]')
  for (const nm of ['TEST-결재자일', 'TEST-결재자이']) {
    await search.fill(nm)
    await pW.getByRole('button', { name: new RegExp(nm) }).first().click()
  }
  await pW.getByRole('button', { name: '상신하기' }).click()
  const doc = await (async () => { for (let i=0;i<24;i++){ const { data } = await raw.from('documents').select('id, status').eq('title', TITLE).maybeSingle(); if (data && data.status !== 'draft') return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  docId = doc?.id
  check('상신: 문서 생성 + 진행 상태', !!doc, JSON.stringify(doc))
  check('알림: 1번 결재자에게 결재 요청(필수)', await (async () => {
    for (let i=0;i<20;i++){ const { count } = await raw.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id', ap1Id).eq('type','approval_request'); if ((count??0)>0) return true; await new Promise(r=>setTimeout(r,500)) } return false })())

  // ② 1번 결재자 승인 → 2번에게 요청
  const ctx1 = await browser.newContext(); const p1 = await ctx1.newPage(); p1.setDefaultTimeout(15000)
  await login(p1, AP1)
  await p1.goto(`${BASE}/approvals`)
  await p1.getByText(TITLE).first().click()
  await p1.getByRole('button', { name: /^승인/ }).first().click()
  // 승인 의견 모달 가능성 — 승인 확정 버튼 재시도
  await p1.getByRole('button', { name: /승인/ }).last().click().catch(() => {})
  const toAp2 = await (async () => { for (let i=0;i<24;i++){ const { count } = await raw.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id', ap2Id).eq('type','approval_request'); if ((count??0)>0) return true; await new Promise(r=>setTimeout(r,500)) } return false })()
  check('1번 승인 → 2번 결재자에게 순차 요청 알림', toAp2)
  await ctx1.close()

  // ③ 2번(최종) 승인 → 문서 approved
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage(); p2.setDefaultTimeout(15000)
  await login(p2, AP2)
  await p2.goto(`${BASE}/approvals`)
  await p2.getByText(TITLE).first().click()
  await p2.getByRole('button', { name: /^승인/ }).first().click()
  await p2.getByRole('button', { name: /승인/ }).last().click().catch(() => {})
  const finalSt = await (async () => { for (let i=0;i<24;i++){ const { data } = await raw.from('documents').select('status').eq('id', docId).single(); if (data.status === 'approved') return data.status; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('최종 승인 → 문서 approved', finalSt === 'approved', `실제: ${finalSt}`)
  await ctx2.close()

  // ④ 기안자 문서함 상태 반영 + 🔍 결과 알림은 미수신(꺼둠)
  await pW.goto(`${BASE}/documents`)
  const rowW = pW.locator('tr, div').filter({ hasText: TITLE }).first()
  await rowW.waitFor()
  check('문서함: 승인 상태 표시', ((await rowW.textContent()) ?? '').includes('승인'))
  const { count: resultNoti } = await raw.from('notifications').select('id',{count:'exact',head:true}).eq('recipient_id', autId).eq('type','approved')
  check('🔍 결과 알림 꺼짐 → 미수신 (데이터 전파는 정상)', (resultNoti ?? 0) === 0, `수신 ${resultNoti}건`)
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  if (docId) {
    await raw.from('approval_lines').delete().eq('document_id', docId)
    await raw.from('approvals').delete().eq('document_id', docId)
    await raw.from('documents').delete().eq('id', docId)
  } else {
    await raw.from('documents').delete().eq('title', TITLE)
  }
  for (const id of [autId, ap1Id, ap2Id].filter(Boolean)) {
    await raw.from('notifications').delete().eq('recipient_id', id)
    await raw.from('activity_logs').delete().eq('actor_id', id)
    await delUser(id)
  }
  console.log('정리 완료')
}
summary()
