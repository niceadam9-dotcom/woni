// 점검달력 ↔ 작업대 왕복 동선 (2026-09-21 2차 — B-2·B-3·B-4)
//
// 왜 생겼나: 들어가는 길만 있고 **돌아오는 길이 없었다**.
//   · 달력 패널 하단 [상세 페이지로 이동]은 작업대 **기본 칸**으로 떨어졌다 —
//     패널에서 「기한초과 ②」를 보고 눌렀는데 스텝바에서 그 칸을 다시 찾아야 했다(B-2).
//   · 작업대의 뒤로가기는 `/inspections` **고정**이라, 달력에서 들어온 사용자가 목록으로
//     떨어졌다(달력으로 돌아가려면 사이드바를 다시 짚는다). 점검표 전용 화면은 이미 `?from=`
//     규약을 쓰고 있었는데 작업대만 빠져 있었다(B-3·B-4).
//
// 이 검사가 지키는 것 — **왕복이 닫히는가**:
//   ① 패널 하단 링크가 지금 급한 단계(기한초과 → 첫 미완)로 착지한다
//   ② 그 링크가 복귀 경로를 싣는다 — 보던 **달까지** 포함해서
//   ③ 단계별 [입력] 링크도 복귀 경로를 싣는다(둘 중 하나만 닫히면 반쪽이다)
//   ④ 작업대 뒤로가기가 그 경로로 돌아간다 · from이 없으면 **달력**으로(목록 아님)
//
// 실행: npx tsx scripts/test-calendar-workbench-roundtrip.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'cal-roundtrip@erp-test.com'
let userId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

try {
  userId = await mkUser({ email: EMAIL, name: '왕복동선', employeeId: 'E2E-RTRIP' })
  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 달력에서 회차 하나를 연다 ────────────────────────────────────────────
  await page.goto(`${BASE}/inspections/calendar`)
  /* 🚨 달력 UI를 구동해 회차 패널을 여는 길은 **표본 의존이 심하다** — 이벤트 클릭은 데이 패널만
     열고(단계 행을 한 번 더 눌러야 회차 패널이 뜬다), 그나마 그 달에 자체점검이 있어야 한다.
     실측에서 이번 달 이벤트 5개가 전부 빈 칩이라 한 번도 열리지 않았다.
     그래서 **계약을 직접 묻는다**: 패널이 만드는 링크의 모양(소스)과, 그 링크를 실제로 걸었을 때
     작업대가 그대로 행동하는가(행위). 화면 구동은 달마다 흔들리지만 이 둘은 흔들리지 않는다. */
  {
    const src = readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n')
    check('★ B-2 패널 링크가 급한 단계를 계산한다(기한초과 → 첫 미완)',
      /const panelEntryStep =/.test(code) && /overdue\.length \? overdue : pending/.test(code))
    check('★ B-2 하단 링크가 그 단계를 실어 보낸다',
      /href=\{`\/inspections\/\$\{selectedInspection\.id\}\$\{panelEntryQuery\}`\}/.test(code))
    check('★ B-3 복귀 경로에 **보던 달**까지 싣는다(pathname+search)',
      /const calendarBackHref = useMemo\(/.test(code)
      && /return `\$\{pathname\}\$\{qs \? `\?\$\{qs\}` : ''\}`/.test(code))
    check('★ B-3 단계별 입력 링크도 복귀 경로를 싣는다',
      /\$\{inputLink\.href\.includes\('\?'\) \? '&' : '\?'\}from=/.test(code))
    /* 🚨 2026-09-21 — **두 링크가 같은 한 곳에서** 복귀 주소를 받는가.
       종전엔 단계 [입력] 링크만 제 자리에서 `insp`를 덮어썼고 패널 하단 링크는 안 해서,
       **하단으로 들어간 사용자만** 돌아왔을 때 우측바가 닫혀 있었다(규약이 갈렸다).
       「어딘가에서 insp를 쓴다」가 아니라 **둘 다 같은 이름을 부르는가**를 묻는다 —
       전자는 한쪽만 고쳐도 초록이라 바로 그 결함을 놓친다. */
    check('🚨 B-3 두 링크가 **같은 한 곳**(calendarBackHref)에서 복귀 주소를 받는다',
      /from=\$\{encodeURIComponent\(calendarBackHref\)\}/.test(code)
      && /q\.set\('from', calendarBackHref\)/.test(code))
    /* 🚨 그 한 곳이 `replaceState`가 소유한 값(`cust`·`insp`)을 **덮어쓰는가**.
       이 둘은 라우터를 안 거쳐 `useSearchParams`에 안 잡힌다 — 보정이 빠지면 복귀 주소가
       필터도 열린 패널도 가리키지 못한다(모양은 멀쩡한데 값만 안 흐르는 부류).

       🚨 **파일 전체에 물으면 안 된다.** 주소를 `replaceState`로 쓰는 effect 두 개가 같은
         `sp.set('cust', custQuery)`를 이미 갖고 있어, 복귀 주소 쪽에서 그 줄을 통째로 빼도
         전체 검색은 **초록으로 남는다**(변이 M4가 실제로 이렇게 뚫었다).
         그래서 `calendarBackHref` **블록만 잘라내** 그 안에 있는지 묻는다. */
    const backBlock = /const calendarBackHref = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/.exec(code)?.[1] ?? ''
    check('🚨 B-3 복귀 주소 블록을 찾는다(단언의 전제)', backBlock.length > 0, `블록 ${backBlock.length}자`)
    check('🚨 B-3 복귀 주소가 replaceState 소유 값(cust·insp)을 덮어쓴다',
      /sp\.set\('insp', selectedInspectionId\)/.test(backBlock)
      && /sp\.set\('cust', custQuery\)/.test(backBlock), `블록 ${backBlock.length}자`)
    // (음성) 하단 링크가 **자기 자리에서** 다시 조립하면 또 갈라진다 — 그 모양이 없어야 한다
    check('🚨 (음성) panelEntryQuery가 searchParams를 직접 다시 조립하지 않는다',
      !/const panelEntryQuery = \(\(\) => \{\s*const qs = searchParams\.toString\(\)/.test(code))
    /* 🚨 복귀 경로를 만드는 **그 자리**가 라우터 훅에서 오는지 본다.
       처음엔 파일 전체에 `window.location` 금지를 걸었다가 빨개졌는데, 412·415줄의 것은
       effect 안에서 히스토리를 고치는 **선재 코드**라 무해했다 — 금지를 파일 전체로 넓히면
       엉뚱한 자리를 문다. 물어야 할 것은 「이 링크의 경로가 어디서 왔는가」다. */
    check('🚨 B-3 복귀 경로는 라우터 훅에서 온다(하이드레이션 어긋남 방지)',
      /const pathname = usePathname\(\)/.test(code) && /const searchParams = useSearchParams\(\)/.test(code))
  }

  /* ── 행위 축 — 패널이 만드는 그 링크를 **실제로 걸어** 작업대가 그대로 행동하는지 본다.
     소스만 보면 「모양은 맞고 값만 안 흐르는」 부류를 놓친다(이 저장소에서 네 번 겪었다). ── */
  {
    /* ⚠ 표본은 **자체점검**이어야 한다 — 정기(monthly)는 활성 단계가 ① 하나뿐이라
       `?step=4`가 딥링크 계약대로 **조용히 무시**되고 ①로 떨어진다. 처음에 아무 진행 중 건이나
       골랐다가 「④가 안 열린다」는 거짓 빨강을 봤다 — 제품이 아니라 표본이 틀렸다. */
    const iq = await raw.from('inspections')
      .select('id, plan_type').eq('status', 'in_progress').neq('plan_type', 'monthly').limit(1)
    const id = (iq.data ?? [])[0]?.id as string | undefined
    check('행위 축 표본 — 진행 중 자체점검 회차', !!id)
    if (id) {
      const backTo = '/inspections/calendar?probe=roundtrip'
      await page.goto(`${BASE}/inspections/${id}?step=4&from=${encodeURIComponent(backTo)}`)
      await page.waitForSelector('[data-testid="workbench-stepbar"]', { timeout: 60000 })
      const active = await page.locator('[data-testid="workbench-stepbar"] button[aria-current="step"]').getAttribute('data-step')
      check('★ ① 지목한 단계(④)가 열린 채로 도착한다', active === 'submit9', `열린 칸=${active}`)
      const back = page.locator('[data-testid="workbench-back"]')
      await back.waitFor({ timeout: 20000 })
      check('★ ② 뒤로가기가 복귀 경로를 가리킨다(B-3)', (await back.getAttribute('href')) === backTo,
        String(await back.getAttribute('href')))
      await back.click()
      await page.waitForURL(u => u.pathname === '/inspections/calendar', { timeout: 30000 })
      check('★ ③ 눌러서 달력으로 돌아온다 — 보던 달(쿼리)까지 유지',
        page.url().includes('probe=roundtrip'), page.url())
      // 🚨 외부 경로는 받지 않는다(open redirect) — 점검표 화면과 같은 판정이어야 한다
      await page.goto(`${BASE}/inspections/${id}?from=${encodeURIComponent('//evil.example.com')}`)
      await page.waitForSelector('[data-testid="workbench-back"]', { timeout: 60000 })
      check('🚨 ④ 외부 경로 복귀는 버린다(open redirect 차단)',
        (await page.locator('[data-testid="workbench-back"]').getAttribute('href')) === '/inspections/calendar',
        String(await page.locator('[data-testid="workbench-back"]').getAttribute('href')))
    }
  }


  // ── ⑤ from이 없으면 목록이 아니라 달력으로(B-4) ────────────────────────
  {
    const iq = await raw.from('inspections').select('id').eq('status', 'in_progress').limit(1)
    const id = (iq.data ?? [])[0]?.id
    check('⑤ 표본 회차', !!id)
    if (id) {
      await page.goto(`${BASE}/inspections/${id}`)
      await page.waitForSelector('[data-testid="workbench-back"]', { timeout: 60000 })
      const h = await page.locator('[data-testid="workbench-back"]').getAttribute('href')
      check('★ ⑤ from 없으면 점검 달력으로(종전 /inspections 고정)', h === '/inspections/calendar', String(h))
    }
  }
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}
summary()
