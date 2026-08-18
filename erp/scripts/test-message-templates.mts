// 소방계획서_21 R7-11 — 발송 문구 관리 E2E
// 실행: node scripts/test-message-templates.mts      (dev :3000 + 스테이징 DB)
//
// 이 기능의 약속은 셋이다.
//   ① 문구가 없어도 발송은 종전대로 나간다  — DEFAULT_TEMPLATES 폴백 (130 미적용에서도)
//   ② 상호가 company_profile 한 곳으로 수렴  — {회사명} 치환
//   ③ 미치환 변수가 고객에게 나가지 않는다   — 저장 단계에서 거부
// 권한(매니저 이상)도 함께 확인한다.
//
// 마이그레이션 130 미적용이면 저장 왕복만 SKIP한다 — **SKIP은 통과로 세지 않는다**(Json_Rule.md).
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
// @ts-expect-error mjs 헬퍼
import { findActionId, collectScripts, callAction } from './_judge19-action.mjs'

const MGR = 'msgtpl-mgr-e2e@erp-test.com'
const EMP = 'msgtpl-emp-e2e@erp-test.com'
let mgrId = '', empId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const skips: string[] = []
const skip = (name: string, why: string) => { skips.push(`${name} — ${why}`); console.log(`  ⏭  SKIP ${name} — ${why}`) }

/** 액션 응답 본문에서 특정 키 존재/값 확인 (flight 응답은 텍스트라 정규식으로 본다) */
const has = (text: string, re: RegExp) => re.test(text)

try {
  mgrId = await mkUser({ email: MGR, name: '문구매니저', employeeId: 'E2E-MTM', role: 'manager' })
  empId = await mkUser({ email: EMP, name: '문구직원', employeeId: 'E2E-MTE', role: 'employee' })

  const { data: comp } = await raw.from('company_profile').select('company_name').limit(1).maybeSingle()
  const companyName = (comp as { company_name: string } | null)?.company_name ?? ''
  console.log(`[환경] company_profile.company_name = ${JSON.stringify(companyName)}`)

  const probe = await raw.from('message_templates').select('key').limit(1)
  const storageReady = !probe.error
  console.log(`[환경] message_templates = ${storageReady ? '있음' : '없음(마이그레이션 130 미적용)'}`)

  // 시드 문구 백업 — 저장 왕복 테스트가 실데이터를 덮어쓰므로 끝나면 되돌린다
  let sigBackup: { subject: string | null; body: string; attachment_name: string | null } | null = null
  if (storageReady) {
    const { data } = await raw.from('message_templates')
      .select('subject, body, attachment_name').eq('key', 'mail_signature').maybeSingle()
    sigBackup = (data as typeof sigBackup) ?? null
    console.log(`[백업] mail_signature 시드 = ${sigBackup ? '보관함' : '행 없음'}`)
  }

  const l = await launch()
  browser = l.browser
  const page = l.page
  page.setDefaultTimeout(60000)
  const urls = collectScripts(page)

  // ── 매니저 세션 ────────────────────────────────────────────────────────────
  await login(page, MGR)
  await page.goto(`${BASE}/mail/compose`)
  await page.waitForLoadState('networkidle')

  // 액션 청크는 **모달을 열어야** 로드된다 — UI로 먼저 열고(그 자체가 R7-3 배선 검증) id를 뽑는다
  const editBtn = page.locator('button', { hasText: '문구 편집' })
  check('R7-3 메일 작성 화면에 [문구 편집] 노출', await editBtn.count() > 0, `${await editBtn.count()}개`)
  await editBtn.first().click()
  await page.waitForSelector('text=미리보기 (실제 값 적용)', { timeout: 30000 })
  check('모달이 열리고 미리보기가 렌더된다', true)

  // 모달 안에서 눈으로 보이는 것부터 확인 (사용자가 실제 보는 화면)
  const modalText = await page.evaluate(() => document.body.innerText)
  check('R7-5 서명 기본 문구가 표시된다', modalText.includes('회사 공용 계정에서 발송'), '')
  check(`R7-4 미리보기에 상호가 채워진다 (${companyName})`, modalText.includes(companyName), '')
  check('R7-4 미리보기에 작성자가 채워진다', modalText.includes('문구매니저'), '')
  check('R7-6 130 미적용 안내가 화면에 뜬다',
    storageReady ? !modalText.includes('마이그레이션 130 미적용') : modalText.includes('마이그레이션 130 미적용'),
    `storageReady=${storageReady}`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('button', { hasText: '닫기' }).first().click().catch(() => {})

  const getId = await findActionId(page, 'getMessageTemplateAction', urls)
  const saveId = await findActionId(page, 'saveMessageTemplateAction', urls)
  check('액션 id 확보 — getMessageTemplateAction', !!getId, String(getId))
  check('액션 id 확보 — saveMessageTemplateAction', !!saveId, String(saveId))

  // ── ① 폴백: 행/테이블이 없어도 현행 문구가 나온다 ──────────────────────────
  console.log('\n— ① 폴백 (130 미적용에서도 발송 문구가 있다)')
  const g1 = (await callAction(page, getId, ['owner_report', { 고객명: '폴백테스트고객' }])).text
  check('관계인 보고 문구 조회 성공', !has(g1, /"error"/), g1.slice(-200))
  check('본문에 현행 문구가 담긴다(별지 제9호서식 문장)', has(g1, /별지 제9호서식/), '')
  check('제목 템플릿이 {회사명}·{고객명} 변수를 쓴다', has(g1, /\{회사명\}/) && has(g1, /\{고객명\}/), '')
  check('storageReady가 실제 테이블 유무와 일치', has(g1, new RegExp(`"storageReady":${storageReady}`)),
    `기대=${storageReady}`)

  // ── ② 치환: 상호가 company_profile에서 온다 ────────────────────────────────
  console.log('\n— ② {회사명} 치환 (상호가 한 곳으로 수렴)')
  if (!companyName) {
    skip('② {회사명} 치환 결과 확인', 'company_profile.company_name이 비어 있어 치환값을 구별할 수 없음')
  } else {
    check('미리보기 제목에 상호가 실제로 채워진다', has(g1, new RegExp(`\\[${companyName}\\]`)),
      `기대 '[${companyName}]'`)
    check('미리보기에 샘플 고객명이 채워진다', has(g1, /폴백테스트고객/), '')
    check('미리보기에 미치환 잔여가 없다', has(g1, /"unresolved":\[\]/), g1.slice(-200))
  }

  // ── ③ 미치환 변수 저장 거부 ────────────────────────────────────────────────
  console.log('\n— ③ 알 수 없는 변수는 저장을 거부한다')
  const badSave = (await callAction(page, saveId, ['owner_report', {
    subject: '[{회사명}] {고객 명} 결과 보고',   // '고객 명' — 공백 오타
    body: '{고객명} 관계인님께', attachmentName: '{고객명}_보고서',
  }])).text
  check('★ 오타 변수({고객 명})가 있으면 저장 거부', has(badSave, /알 수 없는 변수/), badSave.slice(-220))
  check('거부 사유에 문제 변수를 알려준다', has(badSave, /고객 명/), '')

  // ── 저장 왕복 ──────────────────────────────────────────────────────────────
  console.log('\n— 저장 왕복')
  if (!storageReady) {
    skip('저장 → 재조회 왕복', '마이그레이션 130 미적용 (message_templates 없음)')
    const failSave = (await callAction(page, saveId, ['mail_signature', {
      subject: null, body: '{회사명} {작성자} 드림', attachmentName: null,
    }])).text
    check('130 미적용이면 저장이 명확한 사유로 실패한다', has(failSave, /준비되지 않았습니다|저장 실패/), failSave.slice(-200))
  } else {
    await callAction(page, saveId, ['mail_signature', {
      subject: null, body: 'E2E서명 {회사명} {작성자} 드림', attachmentName: null,
    }])
    // 성공 판정은 **DB를 직접 본다** — flight 응답 텍스트에는 재렌더된 페이지 페이로드가 섞여 있어
    // /"error"/ 같은 문자열 매칭이 오탐한다(1차 실행에서 실제로 오탐)
    const { data: saved } = await raw.from('message_templates').select('body, updated_by').eq('key', 'mail_signature').maybeSingle()
    check('정상 저장 — DB 행에 반영', (saved as { body?: string } | null)?.body === 'E2E서명 {회사명} {작성자} 드림',
      JSON.stringify(saved))
    check('저장자(updated_by)가 기록된다', !!(saved as { updated_by?: string } | null)?.updated_by, '')
    const g2 = (await callAction(page, getId, ['mail_signature', { 작성자: '문구매니저' }])).text
    check('재조회에 저장분이 반영', has(g2, /E2E서명/), g2.slice(-200))
    check('미리보기에 {작성자}가 채워진다', has(g2, /문구매니저/), '')
    // 원복 — **삭제하면 안 된다.** 130이 넣은 시드 행이므로 지우면 운영 문구가 사라진다(폴백으로 동작은 하지만
    // '테스트가 실데이터를 지웠다'가 된다). 시작 시 백업해 둔 원문으로 되돌린다
    if (sigBackup) {
      await raw.from('message_templates').update({
        subject: sigBackup.subject, body: sigBackup.body, attachment_name: sigBackup.attachment_name,
      }).eq('key', 'mail_signature')
      const { data: restored } = await raw.from('message_templates').select('body').eq('key', 'mail_signature').maybeSingle()
      check('★ 시드 문구 원복 확인 (테스트가 실데이터를 남기지 않는다)',
        (restored as { body?: string } | null)?.body === sigBackup.body, '')
    } else {
      await raw.from('message_templates').delete().eq('key', 'mail_signature')
    }
  }

  // ── 권한: 일반 직원은 편집 불가 ────────────────────────────────────────────
  console.log('\n— 권한 (매니저 이상만 편집)')
  check('매니저는 canEdit=true', has(g1, /"canEdit":true/), '')

  await page.context().clearCookies()
  await login(page, EMP)
  await page.goto(`${BASE}/mail/compose`)
  await page.waitForLoadState('networkidle')
  const gEmp = (await callAction(page, getId, ['owner_report', {}])).text
  check('★ 일반 직원은 조회는 되지만 canEdit=false', has(gEmp, /"canEdit":false/), gEmp.slice(-200))
  // 저장은 requirePermission이 리다이렉트로 막는다 — 거부의 근거는 "저장 성공 신호가 없다"로 본다
  const saveEmp = await callAction(page, saveId, ['owner_report', {
    subject: '[{회사명}] 무단수정E2E', body: '무단', attachmentName: null,
  }])
  const blocked = /redirect|login/i.test(saveEmp.text) || saveEmp.status >= 300
  check('★ 일반 직원 저장은 차단된다', blocked, `HTTP ${saveEmp.status} · ${saveEmp.text.slice(-160)}`)
  if (storageReady) {
    const { data: after } = await raw.from('message_templates').select('subject').eq('key', 'owner_report').maybeSingle()
    check('★ 차단 후 문구가 실제로 바뀌지 않았다',
      !((after as { subject?: string } | null)?.subject ?? '').includes('무단수정E2E'), JSON.stringify(after))
  }
  // 모달 자체가 일반 직원에게 보기 전용인지
  await page.locator('button', { hasText: '문구 편집' }).first().click().catch(() => {})
  await page.waitForSelector('text=미리보기 (실제 값 적용)', { timeout: 30000 }).catch(() => {})
  const empModal = await page.evaluate(() => document.body.innerText)
  check('일반 직원 모달은 보기 전용 안내를 띄운다', empModal.includes('보기 전용'), '')

} catch (e) {
  console.error('예외:', e)
  check('예외 없음', false, String(e).slice(0, 600))
} finally {
  if (browser) await browser.close().catch(() => {})
  await delUser(mgrId)
  await delUser(empId)
  if (skips.length) {
    console.log(`\n⏭  건너뛴 절 ${skips.length}건 (통과로 세지 않음):`)
    for (const s of skips) console.log(`   · ${s}`)
  }
  summary()
}
