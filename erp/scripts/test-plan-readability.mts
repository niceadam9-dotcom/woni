/** 소방계획서_35 — 서식 화면 가독성 검사 (기준선 채취 + 회귀 판정).
 *
 *  모드
 *    --baseline   기준선을 scripts/_fixtures/35-baseline.json 에 **기록**한다(S0).
 *    (기본)       기준선과 대조한다.
 *    --identity   computed font-size 다중집합이 기준선과 **완전히 같은가** = 크기 잠금.
 *
 *      ⚠ 이 모드의 **의미가 한 번 바뀌었다**. 처음엔 S2(코드모드) 전용이었다 —
 *        토큰 초기값을 구 값 그대로 두고 471곳을 치환한 뒤, 2,157노드의 다중집합이
 *        기준선과 **완전히 같음**(16통과/0실패)을 보여 '항등 치환'을 증명했다.
 *        그 직후 S3로 값을 올리자 같은 검사가 정확히 빨개졌고(11px:54→11 · 13px:12→55),
 *        그게 S2의 초록이 항진명제가 아니었다는 증거다.
 *
 *      그 증명은 끝났고 **기준선은 S3 적용 상태로 재기준화했다**. 지금부터 이 모드는
 *      '앞으로 크기가 실수로 바뀌지 않는가'를 지키는 회귀 잠금이다.
 *      → **지금의 초록은 과거의 항등 치환을 다시 증명하지 않는다.** 그 증거는
 *        위 실행 기록과 소방계획서_35.json S2-7에 있다.
 *      (재기준화하지 않고 등재했다면 S3 이후 영구 빨강이 됐을 것이다.)
 *    --overflow   S6 전용 — 표 넘침(배율별 기대치 분리).
 *
 *  ⚠ 기준선을 'HEAD:'나 '지금 화면'으로 잡지 않는다. 커밋되는 순간 원문이 사라져
 *    영구히 깨지거나(feedback_probe_baseline_pin), 무엇을 해도 통과하는 항진명제가 된다.
 *    **파일로 고정해 커밋한다.**
 *
 *  ⚠ 표 넘침 검사가 항진명제가 되는 길 셋 — 전부 막았다.
 *    ① 접힌 패널이라 0개를 검사하고 통과 → **검사한 표 개수를 단언**한다.
 *    ② clientWidth===0(display:none)이라 비교가 무의미 → 폭 50px 초과만 세고 거른 수를 보고.
 *    ③ overflow-x-auto가 넘침을 삼킴 → 배율별 기대치를 나누고 documentElement는 전 배율 금지.
 *
 *  실행: npx tsx scripts/test-plan-readability.mts [--baseline|--identity|--overflow]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { raw, BASE, check, summary, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const argv = process.argv.slice(2)
const MODE_BASELINE = argv.includes('--baseline')
const MODE_IDENTITY = argv.includes('--identity')
const MODE_OVERFLOW = argv.includes('--overflow')
const MODE_PRINT = argv.includes('--print')
const MUTATE = argv.includes('--mutate')
const FIXTURE = 'scripts/_fixtures/35-baseline.json'
const SRC_DIR = 'src/components/customers'

/** 소방계획서 탭의 서식 노드 — 16파일이 실제로 그려지는 화면들. */
const FORMS = ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.10', '1.11', '1.12'] as const
const SECTIONS = ['ch2', 'ch3', 'cover'] as const

/** 한 화면에서 computed font-size 히스토그램과 표 기하를 걷는다. */
const COLLECT = `(() => {
  const hist = {};
  let counted = 0;
  for (const el of document.querySelectorAll('body *')) {
    // 텍스트를 **직접** 가진 노드만 센다 — 래퍼까지 세면 같은 글자가 조상 수만큼 중복된다.
    let hasOwnText = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { hasOwnText = true; break }
    if (!hasOwnText) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // 안 그려진 것 제외
    const fs = getComputedStyle(el).fontSize;
    hist[fs] = (hist[fs] ?? 0) + 1;
    counted++;
  }
  // 표 기하 — overflow-x-auto 래퍼와 table 양쪽
  const tables = [];
  let skippedNarrow = 0;
  for (const t of document.querySelectorAll('table, .overflow-x-auto')) {
    const cw = t.clientWidth;
    if (cw <= 50) { skippedNarrow++; continue }          // display:none·접힘 — 비교 무의미
    tables.push({ tag: t.tagName.toLowerCase(), testid: t.getAttribute('data-testid') || '', sw: t.scrollWidth, cw });
  }
  return {
    hist, counted, tables, skippedNarrow,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
})()`

/** 측정 대상 고객 고르기.
 *
 *  ⚠ '계획서를 가진 아무 고객'을 쓰면 안 된다 — 첫 시도가 그랬고, **1.4 세부제원 패널이
 *  열렸는데도 rowtable이 한 개도 안 그려졌다**(패널은 열렸지만 체크된 설비가 없어 섹션이 빈다).
 *  그러면 가장 위험한 위젯(44px 숫자열·9px 헤더, W-1)이 기준선에서 통째로 빠지고,
 *  이후 항등·넘침 검사가 **그걸 한 번도 안 보면서 초록**이 된다.
 *  → 설치된 설비가 가장 많은 건물의 고객을 고르고, 아래에서 실제로 그려졌는지 단언한다. */
const { data: facRows } = await raw.from('fire_facilities')
  .select('building_id, installed').eq('installed', true).limit(5000)
const byBld = new Map<string, number>()
for (const r of facRows ?? []) byBld.set(r.building_id, (byBld.get(r.building_id) ?? 0) + 1)
const { data: blds } = await raw.from('buildings').select('id, customer_id')
  .in('id', [...byBld.keys()].slice(0, 200))
const { data: plans } = await raw.from('fire_plans').select('customer_id')
const planSet = new Set((plans ?? []).map(p => p.customer_id))
const ranked = (blds ?? [])
  .map(b => ({ cust: b.customer_id, n: byBld.get(b.id) ?? 0 }))
  .filter(x => planSet.has(x.cust))
  .sort((a, b) => b.n - a.n)
const custId = ranked[0]?.cust
const custFacCount = ranked[0]?.n ?? 0
if (!custId) { console.log('❌ 설비가 설치된 + 계획서를 가진 고객이 없어 측정 불가'); process.exit(1) }
console.log(`대상 고객 ${custId} (설치 설비 ${custFacCount}개)`)

/** 인쇄 축 전용 수집 — **토큰이 실제로 붙은 요소만** 본다.
 *
 *  전체 body를 세면 사이드바·헤더가 print:hidden으로 사라져 화면 히스토그램과 애초에
 *  비교가 안 된다. text-form-… 클래스를 가진 요소는 정확히 우리가 건드린 16파일의
 *  텍스트이고 전부 소방계획서 영역 안이라, 두 미디어에서 같은 모집단이 된다. */
const COLLECT_TOKENS = `(() => {
  const hist = {}; let n = 0;
  for (const el of document.querySelectorAll('[class*="text-form-"]')) {
    const fs = getComputedStyle(el).fontSize;
    hist[fs] = (hist[fs] ?? 0) + 1; n++;
  }
  return { hist, n };
})()`

/** S3 이전(구 값) 상태를 화면 미디어에서 재현하는 오버라이드.
 *  @media print 블록이 복원해야 하는 값과 **같은 목록**이다. */
/** ⚠ [data-fs-boost](세부제원 패널 확대, 소방계획서_37)를 **따로** 눌러야 한다.
 *  `:root{--fs-scale:1!important}` 만으로는 패널이 안 돌아온다 — !important는 그 선언이
 *  이긴 요소(<html>)에서만 힘을 쓰고, 자식은 그 값을 **상속**할 뿐이다. 상속값은 그 자식에
 *  직접 매칭되는 [data-fs-boost] 선언에 진다(중요도와 무관하게 상속이 먼저 탈락한다). */
const BOOST_OFF = `[data-fs-boost]{--fs-scale:1!important}`
const OLD_VALUES = `:root{--fs-scale:1!important;--fs-1:9px!important;--fs-2:10px!important;--fs-3:11px!important;--fs-4:12px!important;--fs-5:14px!important;--fs-6:16px!important;--fs-h6:24px!important;--fs-h7:28px!important;--fs-h8:32px!important;--fs-col-num:44px!important}${BOOST_OFF}`

const email = `s35read_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S35 가독성', employeeId: `S35R${Date.now() % 100000}` })
const { browser, page } = await launch()

const collected: Record<string, any> = {}
/** 인쇄 축 (S3-5~7) — 별도 경로. 화면 15개를 돌 필요가 없다(토큰이 붙은 요소만 보므로). */
if (MODE_PRINT) {
  const printResult: any = {}
  try {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await login(page, email)
    const url = `${BASE}/customers/${custId}?tab=plan&form=1.4`

    // ① 지금 화면(S3 적용 상태)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.evaluate('document.fonts.ready'); await page.waitForTimeout(600)
    printResult.screenNow = await page.evaluate(COLLECT_TOKENS)

    // ⚠ 변이 모드(--mutate): 인쇄 역치환이 **깨진 상태**를 흉내 내 이 검사가 빨개지는지 본다.
    //   소스의 @media print 블록을 지우는 변이가 더 충실하지만, dev가 CSS를 옛 것으로
    //   서빙하면(risk_dev_css_cache_stale) 변이가 안 든 채 초록이 나와 **항진명제로 오판**한다
    //   — 실제로 2026-08-29에 그 오판 직전까지 갔다(서빙 CSS를 fetch해 grep하고서야 알았다).
    //   런타임 주입은 그 축을 우회한다: 반영 여부를 의심할 필요가 없다.
    if (MUTATE) {
      await page.addStyleTag({ content: '@media print { :root, html[data-fs] { --fs-3: 13px !important } }' })
      console.log('⚠ 변이 모드 — 인쇄 역치환 중 --fs-3만 새 값으로 남긴다. 아래 E-2는 FAIL해야 정상이다.\n')
    }

    // ② 인쇄 미디어 — @media print 역치환이 걸려야 한다
    await page.emulateMedia({ media: 'print' })
    await page.waitForTimeout(400)
    printResult.print = await page.evaluate(COLLECT_TOKENS)
    await page.emulateMedia({ media: 'screen' })

    // ③ 구 값을 화면에서 재현 — ②의 기대값. 두 상태를 **독립으로 만들어** 대조한다.
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: OLD_VALUES })
    await page.evaluate('document.fonts.ready'); await page.waitForTimeout(600)
    printResult.screenOld = await page.evaluate(COLLECT_TOKENS)

    // 배율을 켠 상태에서도 인쇄는 불변이어야 한다 (E-1의 핵심 — 배율이 인쇄로 새지 않는다)
    for (const fs of ['lg', 'xl']) {
      await page.evaluate(`document.documentElement.setAttribute('data-fs','${fs}')`)
      await page.evaluate(`document.querySelectorAll('style').forEach(s=>{ if(s.textContent.includes('--fs-scale:1!important')) s.remove() })`)
      await page.waitForTimeout(300)
      await page.emulateMedia({ media: 'print' })
      await page.waitForTimeout(300)
      printResult[`print_${fs}`] = await page.evaluate(COLLECT_TOKENS)
      await page.emulateMedia({ media: 'screen' })
    }
  } catch (e: any) {
    check('인쇄 축 수집', false, e?.message ?? String(e))
  } finally {
    await browser.close(); await delUser(u)
  }

  const eq = (a: any, b: any) => JSON.stringify(Object.entries(a.hist).sort()) === JSON.stringify(Object.entries(b.hist).sort())
  const show = (x: any) => Object.entries(x?.hist ?? {}).sort().map(([k, v]) => `${k}×${v}`).join(' ')

  // ⚠ 항진 차단 — 요소가 0개면 무엇이든 '같다'가 된다.
  check('토큰이 붙은 요소가 실제로 있다',
    (printResult.screenNow?.n ?? 0) > 30, `요소 ${printResult.screenNow?.n ?? 0}개`)
  // 판별자 유효성: 지금 화면과 구 값이 애초에 달라야 이 대조가 의미를 갖는다.
  check('판별자 유효 — S3 적용 화면과 구 값 화면이 다르다',
    !eq(printResult.screenNow ?? { hist: {} }, printResult.screenOld ?? { hist: {} }),
    `지금 ${show(printResult.screenNow)} / 구값 ${show(printResult.screenOld)}`)
  const e2Holds = eq(printResult.print ?? { hist: {} }, printResult.screenOld ?? { hist: {} })
  if (MUTATE) {
    // 변이 모드에서는 **깨져야** 통과다 — 초록은 "이 검사가 빨개질 수 있다"는 뜻이다.
    check('변이 — 인쇄 역치환을 깨면 E-2가 무너진다',
      !e2Holds,
      e2Holds ? '⚠ 역치환을 깨뜨렸는데도 통과했다 — E-2가 항진명제다'
              : `정상: 인쇄 ${show(printResult.print)} ≠ 기대 ${show(printResult.screenOld)}`)
  } else {
    check('E-2 인쇄 미디어가 구 값으로 복원된다', e2Holds,
      `인쇄 ${show(printResult.print)} / 기대(구값) ${show(printResult.screenOld)}`)
  }
  for (const fs of ['lg', 'xl']) {
    check(`E-1 배율 ${fs}에서도 인쇄는 구 값 그대로 (배율이 인쇄로 새지 않는다)`,
      eq(printResult[`print_${fs}`] ?? { hist: {} }, printResult.screenOld ?? { hist: {} }),
      `인쇄(${fs}) ${show(printResult[`print_${fs}`])}`)
  }

  // E-3 — 서식 16파일에 print: 변형이 0건이라는 **격리 가정의 전제**를 상시 고정한다.
  //   누가 print:text-xs 같은 걸 끼워 넣으면 인쇄가 화면 축에 묶여 위 대조가 무의미해진다.
  const printVariants = readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.tsx'))
    .flatMap(f => (readFileSync(join(SRC_DIR, f), 'utf8').match(/(?<![\w-])print:/g) ?? []).map(() => f))
  check(`E-3 서식 컴포넌트에 print: 변형 0건 (실측 ${printVariants.length})`,
    printVariants.length === 0,
    [...new Set(printVariants)].join(', '))

  // PDF 경로 정적 축 — 화면 토큰이 PDF 템플릿으로 새면 즉시 드러난다.
  for (const f of ['src/lib/fire-plan-template.ts', 'src/lib/doc-templates/base.ts']) {
    const src = existsSync(f) ? readFileSync(f, 'utf8') : ''
    check(`E-1 정적: ${f}가 화면 토큰(--fs-*/text-form-*)을 참조하지 않는다`,
      src.length > 0 && !/--fs-\d|--fs-scale|text-form-/.test(src),
      src.length === 0 ? '파일 없음' : '참조가 생겼다 — 인쇄물이 화면 배율을 따라가게 된다')
  }

  summary()
  process.exit(0)
}

try {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await login(page, email)

  for (const key of [...FORMS, ...SECTIONS]) {
    const url = FORMS.includes(key as any)
      ? `${BASE}/customers/${custId}?tab=plan&form=${key}`
      : `${BASE}/customers/${custId}?tab=plan&form=${key}`
    await page.goto(url, { waitUntil: 'networkidle' })
    // 소방계획서_37 — **항등·기준선 축에서만** 세부제원 패널 부스트를 되돌린다.
    //   패널은 늘 마운트돼 있어(plan-form14.tsx) 1.4·1.4-specs 히스토그램에 섞인다.
    //   여기서 누르지 않으면 두 화면이 영원히 빨갛다. 눌러도 어긋난다면 그건 부스트가 아니라
    //   **다른 것**이 변한 것이고, 그게 이 축이 지켜야 할 바로 그것이다.
    //   ⚠ 기록(--baseline)과 대조(--identity) 양쪽에 걸어야 한다 — 한쪽만 걸면
    //     기준선을 다시 뜨는 순간 항등 축이 통째로 빨개진다.
    if (MODE_IDENTITY || MODE_BASELINE) await page.addStyleTag({ content: BOOST_OFF })
    await page.evaluate('document.fonts.ready')
    await page.waitForTimeout(500)
    collected[key] = await page.evaluate(COLLECT)
  }

  // 1.4 세부제원 패널 — 열어야 rowtable이 생긴다(닫힌 채 재면 0개를 세고 통과한다)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
  if (MODE_IDENTITY || MODE_BASELINE) await page.addStyleTag({ content: BOOST_OFF })   // 위와 같은 이유
  await page.evaluate('document.fonts.ready')
  // ⚠ 패널을 여는 것은 **설비명 클릭**이다(plan-form14.tsx ledgerLabel → data-testid="form14-ledger-…").
  //   '대장'이라는 글자를 가진 버튼을 찾는 휴리스틱은 아무거나 눌러 놓고 panelOpened=true를 돌려줬고,
  //   rowtable은 0개인 채 기준선이 채취됐다 — 위험 위젯이 통째로 빠진 초록이었다.
  const opened = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (!els.length) return false;
    els[0].click();
    return true;
  })()`)
  await page.waitForTimeout(1800)
  // ⚠ '패널이 열렸다'만으로는 부족하다 — 열려도 체크된 설비가 없으면 rowtable이 0개다.
  //   실제로 그 위젯이 그려졌는지를 별도 축으로 센다.
  const rowtables = await page.evaluate(`document.querySelectorAll('[data-testid^="rowtable-"]').length`)
  collected['1.4-specs'] = { ...(await page.evaluate(COLLECT)), panelOpened: opened, rowtables }
} catch (e: any) {
  check('수집', false, e?.message ?? String(e))
} finally {
  await browser.close()
  await delUser(u)
}

// ── 기준선 기록 ───────────────────────────────────────────────────────────────
if (MODE_BASELINE) {
  mkdirSync('scripts/_fixtures', { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify({ note: '소방계획서_35 S0 기준선 — 손으로 고치지 말 것', screens: collected }, null, 2), 'utf8')
  const totals = Object.entries(collected).map(([k, v]: any) => `${k}:${v.counted}`).join(' ')
  console.log(`✅ 기준선 기록: ${FIXTURE}`)
  console.log(`   화면 ${Object.keys(collected).length}개 / 텍스트 노드 ${totals}`)
  const rt = (collected['1.4-specs'] as any)?.rowtables ?? 0
  if (rt === 0) console.log(`   ⚠ rowtable 0개 — 세부제원 표(44px 숫자열·9px 헤더)가 기준선에 없다. 대상 고객을 바꿀 것`)
  else console.log(`   1.4 세부제원 rowtable ${rt}개 포함 (W-1 위험 위젯 커버)`)
  const allSizes = new Set<string>()
  for (const v of Object.values(collected) as any[]) for (const k of Object.keys(v.hist)) allSizes.add(k)
  console.log(`   등장 font-size: ${[...allSizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(', ')}`)
  process.exitCode = 0
} else {
  if (!existsSync(FIXTURE)) { console.log(`❌ 기준선 없음 — 먼저 --baseline으로 채취할 것`); process.exit(1) }
  const base = JSON.parse(readFileSync(FIXTURE, 'utf8')).screens

  // 화면 수가 줄면 "검사한 게 없어서 통과"가 된다 — 개수부터 단언한다.
  check('수집한 화면 수가 기준선과 같다',
    Object.keys(collected).length === Object.keys(base).length,
    `실측 ${Object.keys(collected).length} vs 기준 ${Object.keys(base).length}`)

  if (MODE_IDENTITY) {
    for (const [screen, b] of Object.entries(base) as any) {
      const c = collected[screen]
      if (!c) { check(`[${screen}] 수집됨`, false, '화면이 없다'); continue }
      const bk = Object.keys(b.hist).sort(), ck = Object.keys(c.hist).sort()
      const same = bk.length === ck.length && bk.every(k => k === ck[k as any] || b.hist[k] === c.hist[k])
        && JSON.stringify(bk) === JSON.stringify(ck)
      const diff = [...new Set([...bk, ...ck])]
        .filter(k => (b.hist[k] ?? 0) !== (c.hist[k] ?? 0))
        .map(k => `${k}: ${b.hist[k] ?? 0}→${c.hist[k] ?? 0}`)
      check(`[${screen}] font-size 다중집합 불변 (노드 ${c.counted})`,
        same && diff.length === 0,
        diff.length ? diff.join(' · ') : '')
    }
  }

  if (MODE_OVERFLOW) {
    let tablesSeen = 0
    for (const [screen, c] of Object.entries(collected) as any) {
      tablesSeen += c.tables.length
      const over = c.tables.filter((t: any) => t.sw > t.cw + 1)
      check(`[${screen}] 표 ${c.tables.length}개 넘침 없음 (걸러진 좁은 요소 ${c.skippedNarrow})`,
        over.length === 0,
        over.map((t: any) => `${t.tag}${t.testid ? '#' + t.testid : ''} ${t.sw}>${t.cw}`).join(' · '))
      check(`[${screen}] 페이지 전체 가로 스크롤 없음`,
        c.docScrollW <= c.docClientW,
        `${c.docScrollW} > ${c.docClientW}`)
    }
    // ⚠ 항진 차단 — 접힌 패널이면 0개를 보고 전부 초록이 된다.
    //   임계를 손으로 박지 않는다(처음에 20으로 추측했다가 실측 8에 걸렸다).
    //   **기준선이 실제로 본 표 수**와 대조한다 — 화면이 덜 그려지면 즉시 드러난다.
    const baseTables = Object.values(base).reduce((s: number, v: any) => s + v.tables.length, 0)
    check(`검사한 표 수가 기준선과 같다 (${tablesSeen} vs 기준 ${baseTables})`,
      tablesSeen === baseTables,
      '표가 줄었으면 화면이 안 그려진 것이다 — 초록이 무의미하다')
    check('1.4 세부제원 패널이 실제로 열렸다',
      collected['1.4-specs']?.panelOpened === true,
      '닫힌 패널을 재면 rowtable을 한 개도 안 본다')
  }

  summary()
}
