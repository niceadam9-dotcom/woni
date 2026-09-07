// 전역 글자 배율 실측 프로브 (2026-09-07) — 개인설정 [화면 글자 크기]가 **앱 전 화면**에 걸리는가.
//
// 왜 이 형태인가: 합성 요소(document.createElement로 심은 span)만 재면 CSS는 증명되지만
//   "그 화면이 실제로 그 클래스를 쓰는가"는 하나도 증명되지 않는다 — 항진명제다. 그래서
//   두 축을 나란히 잰다:
//     ① 합성 축 — .text-xs/.text-sm/.text-base의 computed px (CSS 배선·항등·인쇄 역치환)
//     ② 실화면 축 — 페이지의 **모든 텍스트 노드**를 문서 순서로 훑어 md ↔ xl을 1:1 대조,
//        "몇 개가 실제로 커졌는가"를 센다. 이 비율이 곧 이번 작업의 진척도다.
//
// ⚠ data-fs를 setAttribute로 밀지 않는다 — FontScaleSync가 되돌린다(35 DEF-C1). 개인설정
//   화면에서 **실제로 클릭**해서 바꾼다. 그래야 DB·쿠키·html 3축이 함께 움직인 상태를 잰다.
//
// 실행: npx tsx scripts/_probe-global-fs.mjs
import { launch, login, mkUser, delUser, check, summary, BASE, raw } from './_e2e-helpers.mjs'

const EMAIL = 'e2e-globalfs@test.local'
const near = (a, b, tol = 0.35) => Math.abs(a - b) <= tol

/** ① 합성 축 — 클래스별 computed font-size */
const synth = page => page.evaluate(() => {
  const probe = cls => {
    const el = document.createElement('span')
    el.className = cls; el.textContent = '가나다'
    document.body.appendChild(el)
    const px = parseFloat(getComputedStyle(el).fontSize)
    el.remove()
    return px
  }
  return { xs: probe('text-xs'), sm: probe('text-sm'), base: probe('text-base'), form: probe('text-form-sm') }
})

/** ② 실화면 축 — 자기 텍스트를 가진 요소를 훑어 [키, px] 배열.
 *
 *  ⚠ 키를 **문서 순서 인덱스**로 잡으면 안 된다(처음에 그렇게 했다가 달력에서 깨졌다):
 *    배율을 올리면 칸이 높아져 "+N개 더 보기"에 접혀 있던 일정이 펼쳐지고, 노드 수가
 *    161→167로 **늘어난다**. 인덱스 대조는 그 지점부터 전부 어긋나 "대조 불가"가 되는데,
 *    그건 실패가 아니라 오히려 기능이 작동한 증거였다. 그래서 키를 **자기 텍스트**로 잡고,
 *    한쪽에만 있는 노드는 제외 후 따로 센다(신규 노출 = 배율 효과의 일부라 함께 보고). */
const realSizes = page => page.evaluate(() => {
  const seen = new Map()
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    // 자기 자신의 텍스트가 있는 요소만 — 래퍼를 세면 같은 글자를 여러 번 센다
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!own.length) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const px = parseFloat(cs.fontSize)
    if (!(px > 0)) continue
    const text = own.map(n => n.textContent.trim()).join(' ').slice(0, 40)
    const n = (seen.get(text) ?? 0) + 1
    seen.set(text, n)
    out.push([`${text}#${n}`, px])
  }
  return out
})

/** md ↔ xl 대조 — 같은 텍스트끼리만 잰다 */
function compare(before, after) {
  const b = new Map(before), a = new Map(after)
  let grown = 0, same = 0, matched = 0
  const stuck = []   // 안 커진 텍스트 — 다음에 어디를 고쳐야 하는지 알려주는 목록이다
  for (const [k, bp] of b) {
    if (!a.has(k)) continue
    matched++
    if (a.get(k) > bp + 0.4) grown++
    else { same++; stuck.push(`${k.split('#')[0]}(${bp}px)`) }
  }
  let onlyAfter = 0
  for (const k of a.keys()) if (!b.has(k)) onlyAfter++
  return { matched, grown, same, onlyAfter, onlyBefore: b.size - matched, stuck }
}

async function setScale(page, value) {
  await page.goto(`${BASE}/settings`)
  await page.click(`[data-testid=fs-option-${value}]`)
  await page.waitForSelector('[data-testid=fs-saved]', { timeout: 15000 })
  // 저장 뒤 재진입해야 서버가 내려준 값으로 렌더된 화면을 잰다(낙관 적용분이 아니라)
  await page.goto(`${BASE}/settings`)
  const attr = await page.getAttribute('html', 'data-fs')
  return attr
}

const run = async () => {
  const uid = await mkUser({ email: EMAIL, name: '전역배율프로브', employeeId: 'E2E-GFS', role: 'admin' })
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)

    // ── P-1. 항등 — 손대지 않은 기본(md)에서 종전 px 그대로 ─────────────────────
    await page.goto(`${BASE}/settings`)
    const md = await synth(page)
    check(`P-1 항등 — md에서 text-xs=12 · text-sm=14 · text-base=16 (실측 ${md.xs}/${md.sm}/${md.base})`,
      near(md.xs, 12) && near(md.sm, 14) && near(md.base, 16))
    check(`P-1b 토큰 축 불변 — text-form-sm=14 (실측 ${md.form})`, near(md.form, 14))

    // 실화면 기준선(md)
    const SCREENS = [
      ['개인설정', `${BASE}/settings`],
      ['점검 달력', `${BASE}/inspections/calendar`],
      ['고객 목록', `${BASE}/customers`],
    ]
    const { data: insp } = await raw.from('inspections').select('id').limit(1).maybeSingle()
    if (insp?.id) SCREENS.push(['점검표 입력', `${BASE}/inspections/${insp.id}/sheet`])
    else console.log('  ⚠ inspections 행이 없어 점검표 입력 화면은 건너뜁니다')

    const baseline = {}
    for (const [name, url] of SCREENS) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      baseline[name] = await realSizes(page)
    }

    // ── P-2. 개인설정에서 실제로 바꾼다 ────────────────────────────────────────
    const attrLg = await setScale(page, 'lg')
    check(`P-2 개인설정 클릭 → html[data-fs]=lg (실측 ${attrLg})`, attrLg === 'lg')
    const lg = await synth(page)
    check(`P-2b lg 배율 1.15 — text-xs 12→13.8 (실측 ${lg.xs})`, near(lg.xs, 13.8))

    const attrXl = await setScale(page, 'xl')
    check(`P-3 html[data-fs]=xl (실측 ${attrXl})`, attrXl === 'xl')
    const xl = await synth(page)
    check(`P-3b xl 배율 1.3 — text-xs 12→15.6 · text-sm 14→18.2 (실측 ${xl.xs}/${xl.sm})`,
      near(xl.xs, 15.6) && near(xl.sm, 18.2))

    // ── P-4. 실화면 축 — 화면마다 몇 %가 커졌나 ────────────────────────────────
    console.log('\n  ── 화면별 배율 적용률 (md → xl) ──')
    let anyScreen = false
    const results = {}
    for (const [name, url] of SCREENS) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      const r = compare(baseline[name], await realSizes(page))
      if (r.matched < 10) { console.log(`  ⚠ ${name} — 대조 가능한 노드가 ${r.matched}개뿐. 건너뜀`); continue }
      anyScreen = true
      const pct = Math.round((r.grown / r.matched) * 100)
      const extra = r.onlyAfter ? ` · xl에서 새로 보인 텍스트 ${r.onlyAfter}개` : ''
      console.log(`  ${name.padEnd(8)} ${String(pct).padStart(3)}%  (${r.grown}/${r.matched} 커짐 · ${r.same} 그대로${extra})`)
      if (r.stuck.length) console.log(`      안 커진 것: ${r.stuck.slice(0, 8).join(' · ')}${r.stuck.length > 8 ? ` …외 ${r.stuck.length - 8}` : ''}`)
      results[name] = pct
    }
    check('P-4 실화면 대조가 최소 한 화면에서 성립했다', anyScreen)
    // ⚠ 사용자가 이름을 대서 요청한 화면이라 임계를 건다 — 전역 배선만으론 20%였고,
    //   .rbc-* 스킨·px 리터럴 44곳을 함께 올려서야 넘는다. 이 수가 떨어지면 회귀다.
    check(`P-4b 점검 달력이 배율 축에 올라왔다 — ${results['점검 달력'] ?? '?'}% (기준 90%)`,
      (results['점검 달력'] ?? 0) >= 90)

    // ── P-5. 인쇄 역치환 — xl인 채로 Ctrl+P해도 구 값 ──────────────────────────
    // ⚠ 두 축의 기대값이 **다르다**(처음에 14로 적었다가 틀렸다):
    //   · text-xs   → 12px. 전역 배선은 항등이라 인쇄 = 화면 md = 종전 값.
    //   · text-form-sm → 12px. 35가 화면에서 12→14로 **올린** 축이라, 인쇄는 법정 서식
    //     규격을 지키려고 --fs-4를 구 값 12px으로 되돌린다(globals.css @media print).
    //   숫자가 우연히 같지만 이유가 다르다 — 한쪽이 깨져도 다른 쪽으로 안 새게 따로 단언한다.
    await page.emulateMedia({ media: 'print' })
    const pr = await synth(page)
    check(`P-5 인쇄 — 전역 배선이 xl에서 항등으로 복귀: text-xs 15.6→12 (실측 ${pr.xs})`, near(pr.xs, 12))
    check(`P-5b 인쇄 — 토큰 축은 구 값 복원: text-form-sm 14→12 (실측 ${pr.form})`, near(pr.form, 12))
    await page.emulateMedia({ media: 'screen' })

    // 원상 복구 — 이 계정은 곧 지우지만, 실패로 중단돼도 md로 돌아가 있게 한다
    await setScale(page, 'md')
  } finally {
    await browser.close()
    await delUser(uid)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
