/** Q-10 검증 — 인쇄 대화상자가 닫히면 print-bundle 탭이 닫혀 원래 화면으로 복귀하는가.
 *
 *  실제 인쇄 대화상자는 헤드리스에서 못 띄우므로 **대화상자 닫힘 신호(afterprint)를 주입**해
 *  그 뒤의 우리 코드(탭 닫기)를 검증한다 — print() 자체는 브라우저 몫이라 검사 대상이 아니다.
 *
 *  세 축:
 *   ① 스크립트로 연 탭(opener 있음): afterprint → 탭이 닫힌다
 *   ② 주소 직접 진입(opener 없음): afterprint → 탭이 남는다 (window.close 가드)
 *   ③ 원래 탭은 그동안 이동·재렌더가 없다 (URL 그대로)
 *
 *  실행: npx tsx scripts/_47-q10-e2e.mts
 */
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

// ── 별지 PDF가 실제로 있는 점검 하나 찾기 — bundle 라우트와 같은 축(storage 목록) ──
async function findInspectionWithPdf(): Promise<string | null> {
  const { data: insp } = await raw.from('inspections')
    .select('id, customer_id').order('created_at', { ascending: false }).limit(1000)
  console.log(`점검 ${insp?.length ?? 0}건 훑는다`)
  for (const r of (insp ?? []) as { id: string; customer_id: string }[]) {
    const { data: files } = await raw.storage.from('fire-plans')
      .list(`${r.customer_id}/inspections/${r.id}`, { limit: 10 })
    if ((files ?? []).some(f => f.name.toLowerCase().endsWith('.pdf'))) return r.id
  }
  return null
}

const inspId = await findInspectionWithPdf()
if (!inspId) { console.log('⚠ 별지 PDF 있는 점검이 스테이징에 없음 — 검증 불가(실패로 처리)'); process.exit(1) }
console.log(`대상 점검: ${inspId.slice(0, 8)}…`)

const uid = await mkUser({ email: 'q10-print@test.local', name: 'Q10인쇄', employeeId: 'E2E-Q10' })
const { browser, page } = await launch()
try {
  await login(page, 'q10-print@test.local')

  // ── ① 스크립트로 연 탭: afterprint → 닫힘 ──
  const url = `${BASE}/inspections/${inspId}/print-bundle`
  const beforeUrl = page.url()
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(u => { window.open(u, '_blank') }, url),
  ])
  await popup.waitForLoadState('domcontentloaded')
  // 뷰어 iframe(blob PDF)이 서기까지 대기 — 리스너는 iframe onLoad에서 달린다
  await popup.waitForSelector('iframe', { timeout: 30000 })
  await popup.waitForTimeout(1200) // blob 로드·onLoad 여유
  await popup.evaluate(() => {
    // 헤드리스엔 PDF 뷰어가 없어 iframe 창 load가 안 선다 — 바깥 창 리스너로 배선을 검증한다.
    // (실사용의 iframe 창 발화는 자동 인쇄가 이미 서는 것으로 증명돼 있고, 배선 규칙은 동일하다)
    window.dispatchEvent(new Event('afterprint'))
    const fr = document.querySelector('iframe') as HTMLIFrameElement | null
    fr?.contentWindow?.dispatchEvent(new Event('afterprint'))
  })
  await popup.waitForEvent('close', { timeout: 5000 }).catch(() => {})
  check('① 인쇄 대화상자 닫힘 → 탭이 닫힌다', popup.isClosed())

  // ── ③ 원래 탭 무사 ──
  check('③ 원래 탭은 그대로 (이동·리로드 없음)', page.url() === beforeUrl, `now=${page.url()}`)

  // ── ② 직접 진입(opener 없음): afterprint에도 남는다 ──
  const direct = await browser.newPage()
  await login(direct, 'q10-print@test.local')
  await direct.goto(url, { waitUntil: 'domcontentloaded' })
  await direct.waitForSelector('iframe', { timeout: 30000 })
  await direct.waitForTimeout(1200)
  await direct.evaluate(() => {
    window.dispatchEvent(new Event('afterprint'))
    const fr = document.querySelector('iframe') as HTMLIFrameElement | null
    fr?.contentWindow?.dispatchEvent(new Event('afterprint'))
  })
  await direct.waitForTimeout(800)
  check('② 직접 진입 탭은 닫히지 않는다 (opener 가드)', !direct.isClosed())
  await direct.close()
} finally {
  await browser.close()
  if (uid) await delUser(uid).catch(() => {})
}
summary()
