/** 실측 프로브 — ④⑥ 「제출일」 라벨 정정(2026-09-15)이 **화면에** 그대로 보이는가.
 *
 *  판정축은 소스가 아니라 DOM 텍스트다 — 라벨은 사용자가 읽는 것이고, 정의를 고쳐도
 *  다른 자리가 옛 문구를 그리고 있으면 아무것도 달라지지 않는다.
 *
 *  🚨 픽스처를 새로 만들지 않고 **이미 있는 회차**를 연다. 손으로 만든 점검은 작업대가
 *     그려지기까지의 전제(계획 항목·단계 행)를 다 갖추지 못해, 처음엔 빈 화면을 재며
 *     음성 단언 넷이 공허 통과했다.
 *
 *  실행: npx tsx scripts/_probe-submit-labels.mts [점검id]   (로컬 dev :3000 + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'submit-label-e2e@erp-test.com'
let userId = '', browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  let inspId = process.argv[2] ?? ''
  if (!inspId) {
    // 불량이 있는 진행 중 회차 — ⑤⑥이 열려 있어야 그 칸이 그려진다
    const { data } = await raw.from('inspection_defects').select('inspection_id').limit(50)
    const ids = [...new Set((data ?? []).map((d: { inspection_id: string }) => d.inspection_id))]
    const { data: ins } = await raw.from('inspections')
      .select('id, status').in('id', ids).eq('status', 'in_progress').limit(1)
    inspId = ins?.[0]?.id ?? ''
  }
  if (!inspId) throw new Error('불량 있는 진행 중 회차를 못 찾았다 — 판정 대상이 없다')
  console.log(`대상 점검: ${inspId}`)

  userId = await mkUser({ email: EMAIL, name: '제출라벨E2E', employeeId: 'E2E-SL' })
  const l = await launch(); browser = l.browser; const page = l.page
  page.setDefaultTimeout(45000)
  await login(page, EMAIL)

  /* 전제·대기는 **내가 안 건드린 형제 칸**에 건다 — 재려는 라벨에 걸면 라벨이 틀렸을 때
     단언이 아니라 타임아웃으로 죽고, 패널 제목에 걸면 **필드가 비동기로 늦게 오는 것**을 못 기다린다
     (⑥에서 실제로 그랬다: 제목은 떴는데 필드가 아직 없어 문서 칸 단언이 빨강). */
  const SIBLING: Record<string, string> = { '4': '총 이행기간', '6': '완료 보고 문구' }
  for (const [step, doc] of [['4', '④'], ['6', '⑥']] as const) {
    await page.goto(`${BASE}/inspections/${inspId}?step=${step}`)
    const sib = SIBLING[step]
    for (let i = 0; i < 80; i++) {
      if ((await page.getByText(sib).count()) > 0) break
      await new Promise(r => setTimeout(r, 300))
    }
    const body = await page.locator('body').innerText()
    // 🚨 전제 — 서식 고유값 칸이 안 그려지면 아래 음성 단언들이 빈 화면에서 공허 통과한다
    check(`${doc} 서식 고유값 칸이 렌더됐다 — 형제 「${sib}」 (이 절의 전제)`, body.includes(sib))
    check(`${doc} 기록 칸이 「소방서 제출 기록」`, body.includes('소방서 제출 기록'))
    check(`${doc} 문서 칸이 「문서에 인쇄할 제출일」`, body.includes('문서에 인쇄할 제출일'))
    // 음성 — 옛 문구가 남아 있으면 두 칸이 다시 헷갈린다
    check(`${doc} 옛 문구 「이행완료 제출일」 없음`, !body.includes('이행완료 제출일'))
    check(`${doc} 옛 문구 「소방서 제출일」 없음`, !body.includes('소방서 제출일'))
  }
} catch (e) {
  console.error('실행 중 오류:', e)
  check('프로브 완주', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
  summary()
}
