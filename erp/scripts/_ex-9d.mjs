// EX-9d: 결재선에 퇴사(비활성) 직원 포함 시 상신 차단 (활성 직원만 허용)
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const AUT='test-9d-aut@erp-test.com', AP1='test-9d-ap1@erp-test.com', AP2='test-9d-ap2@erp-test.com'
let autId='', ap1Id='', ap2Id='', browser=null
const TITLE_OK='EX-9d 활성 결재선', TITLE_NG='EX-9d 퇴사 결재선'
let docOk=null, docNg=null
try {
  autId = await mkUser({ email: AUT, name: 'TEST-9D기안', employeeId: 'TEST-9D-W', role: 'employee' })
  ap1Id = await mkUser({ email: AP1, name: 'TEST-9D결재일', employeeId: 'TEST-9D-1', role: 'manager' })
  ap2Id = await mkUser({ email: AP2, name: 'TEST-9D결재이', employeeId: 'TEST-9D-2', role: 'admin' })

  const l = await launch(); browser = l.browser; const pW = l.page
  await login(pW, AUT)

  // ── ① 활성 결재선 상신 성공 ──
  console.log('[EX-9d] ① 활성 결재선 정상 상신')
  await pW.goto(`${BASE}/documents/new?template=general`)
  await pW.locator('input[placeholder*="제목"]').fill(TITLE_OK)
  await pW.locator('textarea[placeholder*="내용"]').fill('본문')
  const search = pW.locator('input[placeholder*="이름 또는 이메일"]')
  await search.fill('TEST-9D결재일'); await pW.getByRole('button', { name: /TEST-9D결재일/ }).first().click()
  await pW.getByRole('button', { name: '상신하기' }).click()
  docOk = await (async () => { for (let i=0;i<24;i++){ const { data } = await raw.from('documents').select('id, status').eq('title', TITLE_OK).maybeSingle(); if (data && data.status !== 'draft') return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('활성 결재자만 있으면 상신 성공 (pending)', docOk?.status === 'pending', JSON.stringify(docOk))

  // ── ② 결재자 지정 후 그 결재자가 퇴사 → 상신 차단 (작성 폼에서 saveDraft→submit 흐름) ──
  console.log('[EX-9d] ② 결재자 퇴사 후 상신 차단')
  await pW.goto(`${BASE}/documents/new?template=general`)
  await pW.locator('input[placeholder*="제목"]').fill(TITLE_NG)
  await pW.locator('textarea[placeholder*="내용"]').fill('본문')
  await search.fill('TEST-9D결재이'); await pW.getByRole('button', { name: /TEST-9D결재이/ }).first().click()
  // 결재자로 지정한 ap2를 상신 직전 퇴사 처리 (재직 중 퇴사 상황 재현)
  await raw.from('profiles').update({ is_active: false }).eq('id', ap2Id)
  await pW.getByRole('button', { name: '상신하기' }).click()
  await new Promise(r => setTimeout(r, 2500))
  // saveDraft로 문서는 생성되지만 submit은 거부되어 draft로 남아야
  docNg = await (async () => { for (let i=0;i<10;i++){ const { data } = await raw.from('documents').select('id, status').eq('title', TITLE_NG).maybeSingle(); if (data) return data; await new Promise(r=>setTimeout(r,500)) } return null })()
  check('퇴사 결재자 포함 → 상신 차단 (draft 유지)', docNg?.status === 'draft', `상태: ${docNg?.status}`)
  check('차단 안내 표시', await pW.locator('.text-red-500, .text-red-600').filter({ hasText: /퇴사|결재자를 변경/ }).isVisible({ timeout: 5000 }).catch(() => false))
} catch (e) { check('중단 없음', false, e.message) }
finally {
  if (browser) await browser.close()
  for (const t of [TITLE_OK, TITLE_NG]) {
    const { data: d } = await raw.from('documents').select('id').eq('title', t).maybeSingle()
    if (d) { await raw.from('document_approvers').delete().eq('document_id', d.id); await raw.from('documents').delete().eq('id', d.id) }
  }
  for (const id of [autId, ap1Id, ap2Id]) { await raw.from('notifications').delete().eq('recipient_id', id); await raw.from('activity_logs').delete().eq('actor_id', id); await delUser(id) }
  console.log('정리 완료')
}
summary()
