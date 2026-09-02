/** 급수 근거 줄(#fp-grade-basis) 라이브 검증 — 소방계획서 1.1 일반현황 (읽기 전용 E2E).
 *
 *  이 줄이 존재하는 이유: 종전엔 급수 추천 근거가 [추천값 채우기]를 **눌러야만**, 그것도 title 툴팁으로만
 *  보였다. 그래서 이 스위트의 핵심 단언은 **"버튼을 누르지 않아도 보인다"**이다.
 *  대상 고객은 하드코딩하지 않고 실데이터에서 suggestGrade로 **판정 가능/불가 한 명씩 고른다** —
 *  실측상 95%가 판정 불가라 두 갈래를 모두 봐야 한다.
 *
 *  실행: npx tsx scripts/_probe-grade-basis-line.mts  (dev 서버 필요) */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { suggestGrade } from '../src/lib/fire-plan-suggest'
import { GRADE_BASIS } from '../src/lib/legal-basis'

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000'
const EMAIL = 'grade-basis-e2e@erp-test.com'
const PW = 'Grade902!'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

let browser: Browser | null = null
let userId = ''
try {
  const { data: ex } = await raw.auth.admin.listUsers()
  for (const u of ex?.users ?? []) if (u.email === EMAIL) await raw.auth.admin.deleteUser(u.id)
  const { data: nu, error: uErr } = await raw.auth.admin.createUser({ email: EMAIL, password: PW, email_confirm: true })
  if (uErr || !nu?.user) throw new Error(`계정 생성 실패: ${uErr?.message}`)
  userId = nu.user.id
  await raw.from('profiles').upsert({ id: userId, name: 'TEST급수902', role: 'admin', is_active: true, employee_id: 'E2E-G902', email: EMAIL })

  // ── 대상 고르기 — 실데이터로 판정 가능/불가 한 명씩
  const all = async (t: string, sel: string) => {
    const out: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await raw.from(t).select(sel).range(from, from + 999)
      if (error) throw new Error(`${t}: ${error.message}`)
      out.push(...(data as any[])); if ((data as any[]).length < 1000) break
    }
    return out
  }
  const blds = (await all('buildings', 'id, customer_id, purpose, total_area, floors_above, floors_below, height, is_active'))
    .filter(b => b.is_active !== false)
  const facs = await all('fire_facilities', 'building_id, facility_code, installed')
  const facByBld = new Map<string, string[]>()
  for (const f of facs) if (f.installed) facByBld.set(f.building_id, [...(facByBld.get(f.building_id) ?? []), f.facility_code])
  const custs = await all('customers', 'id, customer_name, is_active')
  const custById = new Map(custs.map((c: any) => [c.id, c]))

  type Target = { custId: string; name: string; g: ReturnType<typeof suggestGrade>; lack: string[] }
  const scored: Target[] = []
  for (const b of blds) {
    const c = custById.get(b.customer_id)
    if (!c || c.is_active === false) continue
    const g = suggestGrade({
      purpose: b.purpose, totalArea: b.total_area, floorsAbove: b.floors_above,
      floorsBelow: b.floors_below, height: b.height, facilityCodes: facByBld.get(b.id) ?? [],
    })
    const lack = ([[!b.purpose, '용도'], [b.floors_above == null, '층수'], [b.height == null, '높이'], [b.total_area == null, '연면적']] as Array<[boolean, string]>)
      .filter(([x]) => x).map(([, n]) => n)
    scored.push({ custId: b.customer_id, name: c.customer_name, g, lack })
  }
  const okTarget = scored.find(s => s.g)
  const noTarget = scored.find(s => !s.g && s.lack.length > 0)
  check(`판정 가능 고객 확보 (${okTarget?.name ?? '없음'})`, !!okTarget)
  check(`판정 불가 고객 확보 (${noTarget?.name ?? '없음'})`, !!noTarget)
  if (!okTarget || !noTarget) throw new Error('대상 확보 실패 — 데이터 상태 확인 필요')

  browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  page.setDefaultTimeout(30_000)
  await page.goto(`${BASE}/login`)
  await page.fill('input[type=email]', EMAIL)
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForURL(x => !x.pathname.includes('/login'))
  check('로그인', true)

  const openPlan = async (custId: string) => {
    await page.goto(`${BASE}/customers/${custId}`)
    await page.click('text=소방계획서')
    await page.waitForSelector('#fp-grade', { timeout: 20_000 })
  }

  // ── ① 판정 가능 — 근거가 **버튼을 누르지 않아도** 보인다
  await openPlan(okTarget.custId)
  const line = page.locator('#fp-grade-basis')
  await line.waitFor({ timeout: 15_000 })
  check('근거 줄이 [추천값 채우기] 없이 보인다 (이 작업의 핵심)', await line.isVisible())
  const txt = (await line.textContent() ?? '').replace(/\s+/g, ' ').trim()
  console.log(`     [${okTarget.name}] "${txt}"`)
  check(`추천 급수(${okTarget.g!.grade})가 줄에 있다`, txt.includes(okTarget.g!.grade), txt)
  check('근거 문구가 함께 있다', txt.includes(okTarget.g!.reason.slice(0, 8)), txt)
  check("'추천'으로 표기한다(확정 아님)", txt.includes('추천'), txt)

  const link = line.locator('a')
  check('법령 원문 링크가 있다', await link.count() === 1)
  check('링크가 legal-basis 단일 원천과 같다', await link.getAttribute('href') === GRADE_BASIS.url,
    `실제: ${await link.getAttribute('href')}`)
  check('링크 라벨 = 조문 이름', (await link.textContent() ?? '').includes(GRADE_BASIS.label))
  check('확인일이 title에 남는다', ((await link.getAttribute('title')) ?? '').includes(GRADE_BASIS.asOf))

  // ── ② 판정 불가 — 무엇이 없는지 말한다
  await openPlan(noTarget.custId)
  const line2 = page.locator('#fp-grade-basis')
  await line2.waitFor({ timeout: 15_000 })
  const txt2 = (await line2.textContent() ?? '').replace(/\s+/g, ' ').trim()
  console.log(`     [${noTarget.name}] "${txt2}"`)
  check('판정 불가를 말한다', txt2.includes('추천 불가'), txt2)
  for (const name of noTarget.lack) {
    check(`없는 값 '${name}'을 이름으로 말한다`, txt2.includes(name), txt2)
  }
  // 문구가 아니라 **안내의 두 축**을 본다 — 어디로(건물현황) 무엇을(대장). 전체 문장을 박아두면
  // 문구를 다듬을 때마다 제품이 멀쩡한데 검사가 빨개진다(2026-09-02 실제로 그렇게 한 번 빨개졌다).
  check('채우는 경로를 안내한다 (어디로+무엇을)', txt2.includes('건물현황') && txt2.includes('대장'), txt2)
  check('판정 불가일 때도 원문 링크는 있다', await line2.locator('a').count() === 1)

  await page.screenshot({ path: 'scripts/_shots/grade-basis-line.png', fullPage: false })
  console.log('     (스크린샷: scripts/_shots/grade-basis-line.png)')
} catch (e) {
  check(`예외: ${e instanceof Error ? e.message : String(e)}`, false)
} finally {
  if (browser) await browser.close()
  if (userId) { await raw.from('profiles').delete().eq('id', userId); await raw.auth.admin.deleteUser(userId) }
}
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
