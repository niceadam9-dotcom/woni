/** 「기타」 7종 분할 라이브 검증 (2026-09-03 신설 → 2026-09-20 분할 재작성) — 체크 → 저장 → 점검표 딥링크.
 *
 *  이 축의 계약: **체크는 '해당한다'는 사실이고, 결과(○/×/／)는 점검표에서 받는다.**
 *  체크가 STD-31·EXT-10~14의 설치 축이 되는 배선(sheet-facility-map)은 분할 전과 동일하다.
 *
 *  2026-09-20 사용자 확정으로 입력 UI가 갈라졌다 — 종전 「1.4 하단 한 블록」 단언은 구계약이라 갈아끼웠다:
 *   · [소방시설] 탭(구 1.4)에는 기타 블록이 **없다** (showEtc=false — 음성 단언)
 *   · 보고서 탭 「기타 점검대상」 = 방화문·방화셔터 / 비상구·피난통로 / 방염 (자체 [저장])
 *   · 소방계획서 1.6 「기타」 = 위험물 저장·취급 / 화기 / 가연성 가스 / 전기 (1.6 통합 [저장])
 *   · 🚨 race — [소방시설] 탭 저장(scope 'standard')이 다른 카드가 저장한 기타 행을 되살리면 안 된다
 *
 *  대상: 별그리다(추모공원) — 진행 중 자체점검 회차가 있어 링크(canInputResult)가 그려진다.
 *  ⚠ 쓰기 검사다(fire_facilities). 원상 복구를 finally에서 **DB로 직접** 되돌린다 —
 *     화면 조작으로 되돌리면 그 조작이 실패했을 때 잔재가 남는다.
 *
 *  실행: npx tsx scripts/_probe-form14-etc.mts  (dev 서버 필요) */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'form14-etc-e2e@erp-test.com'
const PW = 'EtcAxis39!'
const ETC7 = ['방화문 및 방화셔터', '비상구 및 피난통로', '방염',
  '위험물 저장·취급시설', '화기시설', '가연성 가스시설', '전기시설']
const REPORT3 = ETC7.slice(0, 3)
const PLAN4 = ETC7.slice(3)
const TARGET = '방염'      // 보고서 탭 갈래 — 짧은 어휘 = 퍼지 폴백에 가장 취약했던 코드를 일부러 고른다
const TARGET_PLAN = '화기시설' // 1.6 갈래

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

let browser: Browser | null = null
let userId = ''
let buildingId = ''
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST기타39', role: 'admin', is_active: true, employee_id: 'E2E-ETC', email: EMAIL })

  const { data: custs, error: cErr } = await raw.from('customers').select('id').eq('customer_name', '별그리다(추모공원)')
  if (cErr || (custs ?? []).length !== 1) throw new Error(`대상 고객 조회 실패: ${cErr?.message}`)
  const custId = (custs as Array<{ id: string }>)[0].id

  // 기준선 — 이 건물의 기타 행이 원래 없어야 한다(있으면 이 검사가 무의미하고 복구도 위험)
  const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', custId).eq('is_active', true)
  buildingId = ((blds ?? []) as Array<{ id: string }>)[0]?.id ?? ''
  const { data: pre } = await raw.from('fire_facilities').select('facility_code').eq('building_id', buildingId).in('facility_code', ETC7)
  check('기준선 — 기타 행 0건(체크 전)', (pre ?? []).length === 0, `${(pre ?? []).length}건`)

  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(30_000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(x => !x.pathname.includes('/login'))

  // ── ⓪ 음성 — [공통] 탭 1.4 노드(구 1.4)에는 기타 블록이 없다 ────────────────
  await page.goto(`${BASE}/customers/${custId}?tab=facilities&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  check('[공통] 탭 1.4에 종전 기타 블록(form14-etc)이 없다',
    await page.locator('[data-testid="form14-etc"]').count() === 0)
  check('[공통] 탭 1.4에 분할 카드(etc-items-panel)도 없다(42종·대장·다중이용업소만)',
    await page.locator('[data-testid="etc-items-panel"]').count() === 0)

  // ── ① 보고서 탭 「기타 점검대상」 — 3종 실재·안내 (2026-09-20 3분리: reports 탭 트리 etc 노드) ──
  await page.goto(`${BASE}/customers/${custId}?tab=reports&form=etc`)
  const block = page.locator('[data-testid="etc-items-panel"]')
  await block.waitFor({ timeout: 15_000 })
  check('보고서 탭에 「기타 점검대상」 카드가 있다', await block.isVisible())
  for (const code of REPORT3) {
    check(`체크박스 '${code}'`, await block.locator(`[data-testid="etc-check-${code}"]`).count() === 1)
  }
  for (const code of PLAN4) {
    check(`소방계획서 갈래 '${code}'는 보고서 카드에 없다`, await block.locator(`[data-testid="etc-check-${code}"]`).count() === 0)
  }
  const txt = (await block.textContent()) ?? ''
  check('안내가 "결과는 점검표에서"를 말한다', txt.includes('점검 결과') && txt.includes('점검표에서'))

  // ── ② 음성 대조 — 미체크면 입력 링크가 없다 ──────────────────────────────
  check(`미체크 상태에선 '${TARGET}' 링크 없음`,
    await page.locator(`[data-testid="etc-link-${TARGET}"]`).count() === 0)

  // ── ③ 체크 → 링크 등장 → 딥링크 계약 ────────────────────────────────────
  await block.locator(`[data-testid="etc-check-${TARGET}"]`).click()
  const link = page.locator(`[data-testid="etc-link-${TARGET}"]`)
  await link.waitFor({ timeout: 15_000 })
  const href = await link.getAttribute('href')
  check('체크하면 점검표 링크가 생긴다', !!href, href ?? '(없음)')
  check('딥링크 계약 — /sheet?facility=&from=',
    !!href && /\/inspections\/[0-9a-f-]+\/sheet\?facility=/.test(href) && href.includes('from='), href ?? '')
  check('복귀(from)가 보고서 탭 기타 노드를 가리킨다', !!href && decodeURIComponent(href).includes('tab=reports'), href ?? '')

  // ── ④ 저장 → DB 영속 ───────────────────────────────────────────────────
  await page.locator('[data-testid="etc-items-save"]').click()
  await page.waitForSelector('text=✅ 저장됨', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const { data: post } = await raw.from('fire_facilities')
    .select('facility_code, category, installed').eq('building_id', buildingId).in('facility_code', ETC7)
  const row = ((post ?? []) as Array<{ facility_code: string; category: string; installed: boolean }>)
    .find(r => r.facility_code === TARGET)
  check('저장 후 DB에 기타 행이 있다', !!row, JSON.stringify(post ?? []))
  check("category='기타'로 저장된다", row?.category === '기타', row?.category ?? '(없음)')
  check('installed=true', row?.installed === true)
  check('체크 안 한 6종은 저장되지 않는다(미설치는 행을 만들지 않는 종전 규약)',
    (post ?? []).length === 1, `${(post ?? []).length}건`)

  // ── ⑤ 🚨 race — [소방시설] 탭 저장이 방금 저장한 기타 행을 되살리거나 지우지 않는다 ──
  // scope 'standard'의 존재 이유. 42종 상태는 화면 로드값 그대로 두고(켰다 끄면 원상), dirty만 만든다.
  await page.goto(`${BASE}/customers/${custId}?tab=facilities&form=1.4`)
  await page.waitForSelector('text=서식 1.4 소방시설 현황')
  const probe = page.locator('[data-testid="form14-check-이산화탄소소화설비"]')
  const before = await probe.getAttribute('aria-pressed')
  await probe.click()
  await page.keyboard.press('Escape')   // 체크 순간 열리는 설비 대장 패널을 닫는다(저장 버튼 가림 방지)
  await probe.click()                    // 원상 — 상태는 그대로, dirty만 남는다
  await page.keyboard.press('Escape')
  check('42종 상태가 원상(켰다 끔)', (await probe.getAttribute('aria-pressed')) === before)
  await page.locator('[data-testid="form14-save"]').click()
  await page.waitForTimeout(1500)
  const { data: afterStd } = await raw.from('fire_facilities')
    .select('facility_code').eq('building_id', buildingId).in('facility_code', ETC7)
  check('🚨 [소방시설] 저장 후에도 기타 행이 그대로 1건(scope standard)', (afterStd ?? []).length === 1,
    JSON.stringify(afterStd ?? []))

  // ── ⑥ 1.6 「기타 — 점검 대상 여부」 4종 + 통합 저장 ─────────────────────────
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.6`)
  const planBlock = page.locator('[data-testid="etc-items-panel"]')
  await planBlock.waitFor({ timeout: 15_000 })
  for (const code of PLAN4) {
    check(`1.6 체크박스 '${code}'`, await planBlock.locator(`[data-testid="etc-check-${code}"]`).count() === 1)
  }
  for (const code of REPORT3) {
    check(`보고서 갈래 '${code}'는 1.6 카드에 없다`, await planBlock.locator(`[data-testid="etc-check-${code}"]`).count() === 0)
  }
  await planBlock.locator(`[data-testid="etc-check-${TARGET_PLAN}"]`).click()
  await page.locator('button:has-text("서식 1.6 저장")').click()
  await page.waitForSelector('text=기타(해당 여부) 저장됨', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const { data: post16 } = await raw.from('fire_facilities')
    .select('facility_code, installed').eq('building_id', buildingId).in('facility_code', ETC7)
  const rows16 = (post16 ?? []) as Array<{ facility_code: string; installed: boolean }>
  check(`1.6 통합 저장 → '${TARGET_PLAN}' 행이 DB에 있다`, rows16.some(r => r.facility_code === TARGET_PLAN && r.installed),
    JSON.stringify(post16 ?? []))
  check(`보고서 갈래 '${TARGET}' 행도 그대로다(부분 저장이 남의 갈래를 안 지운다)`,
    rows16.some(r => r.facility_code === TARGET), JSON.stringify(post16 ?? []))

  // ── ⑦ 링크 이동 — 지목한 점검표가 열린 채 도착하는가 ─────────────────────
  await page.goto(`${BASE}${href!}`)
  await page.waitForURL(/\/inspections\/[0-9a-f-]+\/sheet/, { timeout: 20_000 })
  await page.waitForSelector('text=점검표 입력 —', { timeout: 20_000 })
  const body = (await page.locator('body').textContent()) ?? ''
  check('「기타사항」 점검표가 열린 채 도착한다', body.includes('기타사항'),
    body.slice(0, 160).replace(/\s+/g, ' '))
  // 항목은 지연 로드다 — body를 즉시 읽으면 시트 제목만 있고 항목이 없다(공허 실패)
  const flame = page.locator('text=방염대상물품').first()
  const shown = await flame.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
  check('방염 항목(31-B-*)이 열린 시트에 있다', shown,
    shown ? '' : ((await page.locator('body').textContent()) ?? '').slice(0, 200).replace(/\s+/g, ' '))
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
} finally {
  // 원상 복구 — 화면이 아니라 DB로 되돌린다(조작 실패 시 잔재가 남지 않게)
  if (buildingId) {
    const { error } = await raw.from('fire_facilities').delete().eq('building_id', buildingId).in('facility_code', ETC7)
    const { data: left } = await raw.from('fire_facilities').select('facility_code').eq('building_id', buildingId).in('facility_code', ETC7)
    check('정리 — 기타 행 0건 복구', !error && (left ?? []).length === 0, `${(left ?? []).length}건 ${error?.message ?? ''}`)
  }
  if (userId) await raw.auth.admin.deleteUser(userId).catch(() => {})
  await browser?.close()
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
