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
const MODE_CLS = argv.includes('--cls')
const MUTATE = argv.includes('--mutate')
const FIXTURE = 'scripts/_fixtures/35-baseline.json'
const PRINT_FIXTURE = 'scripts/_fixtures/35-print-baseline.json'
const CLS_FIXTURE = 'scripts/_fixtures/35-cls-baseline.json'
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

/** 배율 축 (S6-2·3·4).
 *
 *  ⚠ 화면을 배율마다 다시 열지 않는다. 배율은 <html data-fs>가 정하는 CSS 변수 하나라
 *    속성만 갈아끼우면 같은 DOM이 그 자리에서 다시 흐른다 — 이동 45회가 15회로 준다.
 *    (이동을 3배로 늘리면 dev wedge에 걸릴 확률도 3배가 된다. 실제로 탐침 단계에서 걸렸다.) */
const SCALES = ['md', 'lg', 'xl'] as const
const SCALE_GEOM = `(() => {
  const probe = document.querySelector('[class*="text-form-"]');
  return {
    fs: probe ? parseFloat(getComputedStyle(probe).fontSize) : 0,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    tablesOver: [...document.querySelectorAll('table, .overflow-x-auto')]
      .filter(t => t.clientWidth > 50 && t.scrollWidth > t.clientWidth + 1).length,
  };
})()`

/** rowtable 입력칸의 가로 잘림(S6-3)·세로 잘림(S6-4).
 *
 *  ⚠ nonEmpty를 **함께** 돌려주는 게 핵심이다. 빈 칸은 어떤 크기에서도 안 넘치므로
 *    값이 안 들어간 채 잰 '잘림 0'은 항진명제다(설계서 §6 검사3 항진경로 ③).
 *    게다가 값이 조용히 되돌아갈 수 있다 — 동기 루프로 한꺼번에 채우면 setCell이
 *    클로저의 낡은 `shown`을 읽어 마지막 한 칸만 살아남는다. 그래서 한 칸씩 채우고,
 *    잰 시점에 실제로 값이 남아 있었는지를 매 배율마다 단언한다. */
const MEASURE_INPUTS = `(() => {
  const inputs = [...document.querySelectorAll('[data-testid^="rowtable-"] input')].filter(i => !i.disabled);
  const cut = inputs.filter(i => i.scrollWidth > i.clientWidth + 1);
  const clipped = inputs.filter(i => {
    const cs = getComputedStyle(i);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    return i.clientHeight < lh - 0.5;
  });
  return {
    n: inputs.length, nonEmpty: inputs.filter(i => i.value.trim()).length,
    cut: cut.length,
    cutSample: cut.slice(0, 3).map(i => i.getAttribute('aria-label') + ' ' + i.scrollWidth + '>' + i.clientWidth),
    clipped: clipped.length,
    clipSample: clipped.slice(0, 3).map(i => i.getAttribute('aria-label') + ' h' + i.clientHeight + ' < lh' + getComputedStyle(i).lineHeight),
    fs: inputs[0] ? parseFloat(getComputedStyle(inputs[0]).fontSize) : 0,
  };
})()`

/** 채움 수준을 나눈다 — '실무에서 쓰일 값'과 '스트레스 값'은 서로 다른 질문이고,
 *  둘을 섞으면 답도 섞인다(실측: 3자리는 전 배율 0, 5자리는 md에서만 8). */
const FILL_LEVELS = [
  { id: '실무 3자리', num: '123', wide: '가동' },
  { id: '스트레스 5자리', num: '12345', wide: '지하주차장동' },
]

/** ── S0-6 FOUT/CLS ────────────────────────────────────────────────────────
 *  맑은 고딕으로 먼저 그린 뒤 Pretendard로 갈아끼울 때 레이아웃이 얼마나 밀리는가(W-7).
 *
 *  ⚠ **측정 화면을 잘못 고르면 0이 나온다.** /customers에서 재면 CLS가 0.007~0.017로
 *    노이즈에 묻히고 대조군도 0이 아니다(비동기 데이터 로드가 자체 이동을 만든다).
 *    FOUT가 실제로 아픈 곳은 **행이 촘촘한 서식 화면**이다 — 1.4에서 재면 0.27이 나온다.
 *    "쟀는데 0이었다"는 '문제가 없다'가 아니라 '아픈 데를 안 봤다'일 수 있다.
 *
 *  ⚠ 매 실행 **새 컨텍스트**여야 한다. 캐시에 폰트가 남아 있으면 FOUT 자체가 안 난다. */
const CLS_INIT = `
  window.__cls = 0; window.__shifts = [];
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__cls += e.value;
      if (e.value > 0.001) window.__shifts.push({ v: +e.value.toFixed(5), t: Math.round(e.startTime) });
    }
  }).observe({ type: 'layout-shift', buffered: true });`

/** 인쇄 축 전용 수집 — **토큰이 실제로 붙은 요소만** 본다.
 *
 *  전체 body를 세면 사이드바·헤더가 print:hidden으로 사라져 화면 히스토그램과 애초에
 *  비교가 안 된다. text-form-… 클래스를 가진 요소는 정확히 우리가 건드린 16파일의
 *  텍스트이고 전부 소방계획서 영역 안이라, 두 미디어에서 같은 모집단이 된다. */
/*  ⚠ **fontSize만 재면 "인쇄가 구 값으로 복원된다"가 좁은 참이 된다.** 실제로 그랬다:
 *    유틸리티가 letter-spacing:normal을 무조건 걸어 인쇄에서 자간이 안 돌아왔는데,
 *    이 검사가 fontSize만 봐서 초록이었다(독립 판정 DEF-B1 — 법정 서식 471곳 영향).
 *    그래서 히스토그램 키를 `fontSize|letterSpacing` 복합으로 넓혔다. */
const COLLECT_TOKENS = `(() => {
  const hist = {}; let n = 0;
  for (const el of document.querySelectorAll('[class*="text-form-"]')) {
    const cs = getComputedStyle(el);
    const k = cs.fontSize + '|' + cs.letterSpacing;
    hist[k] = (hist[k] ?? 0) + 1; n++;
  }
  return { hist, n };
})()`

/** S3 이전(구 값) 상태를 화면 미디어에서 재현하는 오버라이드.
 *  @media print 블록이 복원해야 하는 값과 **같은 목록**이다.
 *
 *  ⚠ [data-fs-boost]를 **따로** 눌러야 한다 (2026-08-30 세부제원 패널 확대).
 *    `:root{--fs-scale:1!important}` 만으로는 패널이 안 돌아온다 — !important는 그 선언이
 *    이긴 요소(<html>)에서만 힘을 쓰고, 자식은 그 값을 **상속**할 뿐이다. 상속값은 그 자식에
 *    직접 매칭되는 [data-fs-boost] 선언에 진다(중요도와 무관하게 상속이 먼저 탈락한다).
 *    이걸 빼면 1.4·1.4-specs 두 화면이 기준선과 어긋나 항등이 깨진다 — 실제로 깨졌다.
 *
 *    ⭐ 이렇게 눌러 두면 항등 주장이 **더 강해진다**: "패널이 변한 이유는 배율 변수 한 개뿐이고,
 *    그 한 개를 되돌리면 옛 픽셀과 완전히 같다". 패널 안 text-form-* 클래스를 실수로 바꾸면
 *    (예: text-form-xs → text-form-sm) 부스트를 눌러도 히스토그램이 어긋나 여전히 잡힌다. */
const BOOST_OFF = `[data-fs-boost]{--fs-scale:1!important}`
/*  ⚠ 이 상수는 @media print 목록의 **사본**이다. 사본은 조용히 어긋난다 — 실제로 어긋나 있었다:
 *    fbe8e95가 CSS에만 --fs-col-cat을 넣고 여기는 안 고쳤는데, 위 주석은 계속 "같은 목록"이라
 *    단언하고 있었다(판정 DEF-B2). 그래서 아래 assertTokenListsMatch()가 두 목록과 이 상수를
 *    **셋 다** 대조한다 — 주석의 약속을 검사로 바꾼 것이다. */
const OLD_VALUES = `:root{--fs-scale:1!important;--fs-step:1!important;--fs-1:9px!important;--fs-2:10px!important;--fs-3:11px!important;--fs-4:12px!important;--fs-5:14px!important;--fs-6:16px!important;--fs-h6:24px!important;--fs-h7:28px!important;--fs-h8:32px!important;--fs-col-num:44px!important;--fs-col-cat:48px!important;--fs-tracking:-0.01em!important}${BOOST_OFF}`

/** :root 정의 · @media print 복원 · OLD_VALUES 사본 — 세 목록이 같은가.
 *  하나라도 빠지면 그 토큰만 인쇄에서 확대된 채 나가는데, 히스토그램 대조로는 안 잡힐 수 있다
 *  (폭 토큰은 font-size가 아니라서). 그래서 값이 아니라 **이름 집합**을 정적으로 대조한다. */
function assertTokenListsMatch() {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const names = (block: string) => new Set((block.match(/--fs-[a-z0-9-]+(?=\s*:)/g) ?? []))
  // :root { … } 첫 블록 안의 --fs-*
  const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('html[data-fs="lg"]'))
  const printStart = css.indexOf('@media print')
  const printBlock = css.slice(printStart, css.indexOf('\n}', css.indexOf('[data-fs-boost]', printStart)))
  const rootSet = names(rootBlock), printSet = names(printBlock), oldSet = names(OLD_VALUES)

  check(`가드: :root 폰트 토큰이 실제로 걷혔다 (${rootSet.size}개)`, rootSet.size >= 10,
    [...rootSet].join(' '))
  const missingInPrint = [...rootSet].filter(t => !printSet.has(t))
  check('가드: @media print가 :root의 --fs-* 토큰을 **전부** 되돌린다',
    missingInPrint.length === 0, `인쇄에서 누락: ${missingInPrint.join(', ')}`)
  const missingInOld = [...rootSet].filter(t => !oldSet.has(t))
  check('가드: OLD_VALUES 사본이 :root 목록과 일치한다 (주석의 "같은 목록"을 검사로)',
    missingInOld.length === 0, `사본에서 누락: ${missingInOld.join(', ')}`)

  // 자간 복원값이 body 하나인 전제 — 서식 파일이 제목 태그에 토큰을 쓰기 시작하면 틀린다.
  const headingWithToken = readdirSync(SRC_DIR).filter(f => f.endsWith('.tsx')).flatMap(f => {
    const s = readFileSync(join(SRC_DIR, f), 'utf8')
    return (s.match(/<h[1-6]\b[^>]*>/g) ?? []).filter(t => /text-form-|h-form-/.test(t)).map(() => f)
  })
  check('가드: 서식 파일의 h1~h6가 토큰을 쓰지 않는다 (--fs-tracking 복원값이 body 하나인 전제)',
    headingWithToken.length === 0,
    `${[...new Set(headingWithToken)].join(', ')} — 제목은 -0.02em이라 단일 복원값이 틀리게 된다`)
}

const email = `s35read_${Date.now()}@example.com`
const u = await mkUser({ email, name: 'S35 가독성', employeeId: `S35R${Date.now() % 100000}` })
const { browser, page } = await launch()

const collected: Record<string, any> = {}
/** 화면 → 배율 → 기하 (S6-2). */
const scaleGeom: Record<string, any> = {}
/** 채움수준 → 배율 → 입력칸 측정 (S6-3·S6-4). */
const inputGeom: Record<string, any> = {}
if (MODE_CLS) {
  const measured: Record<string, any> = {}
  try {
    for (const mode of ['normal', 'blocked'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
      ctx.setDefaultTimeout(20000)
      const p = await ctx.newPage()
      await p.addInitScript(CLS_INIT)
      await p.route('**/fonts/pretendard/**', async (r: any) => {
        if (mode === 'blocked') return r.abort()
        await new Promise(res => setTimeout(res, 150))   // 느린 회선 흉내 — 캐시 없는 첫 방문
        return r.continue()
      })
      await login(p, email)
      await p.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'load' })
      await p.evaluate('document.fonts.ready').catch(() => {})
      await p.waitForTimeout(2500)
      measured[mode] = await p.evaluate(`({ cls: window.__cls, shifts: window.__shifts,
        loaded: [...document.fonts].filter(f => f.family.includes('Pretendard') && f.status === 'loaded').length })`)
      await ctx.close()
    }
  } catch (e: any) {
    check('S0-6 수집', false, e?.message ?? String(e))
  } finally {
    await browser.close(); await delUser(u)
  }

  const norm = measured.normal, blk = measured.blocked
  console.log(`   정상    CLS=${norm?.cls?.toFixed(5)}  Pretendard 로드 ${norm?.loaded}조각  이동 ${norm?.shifts?.length ?? 0}회`)
  for (const s of norm?.shifts?.slice(0, 5) ?? []) console.log(`             +${s.v} @${s.t}ms`)
  console.log(`   대조군  CLS=${blk?.cls?.toFixed(5)}  Pretendard 로드 ${blk?.loaded}조각  (폰트 차단)\n`)

  if (MODE_BASELINE) {
    mkdirSync('scripts/_fixtures', { recursive: true })
    writeFileSync(CLS_FIXTURE, JSON.stringify({
      note: '소방계획서_35 S0-6 — FOUT 리플로우(CLS) 고정 기준선. 1.4 서식, 폰트 150ms 지연. 손으로 고치지 말 것',
      normalCls: +(norm?.cls ?? 0).toFixed(5), blockedCls: +(blk?.cls ?? 0).toFixed(5),
    }, null, 2), 'utf8')
    console.log(`✅ CLS 기준선 기록: ${CLS_FIXTURE}`)
  } else {
    // 귀속 축 — 정상과 대조군의 **차이**가 폰트 교체 몫이다.
    //   대조군의 절대값을 0으로 요구하면 안 된다(화면 자체의 비동기 이동이 섞인다).
    check('S0-6 귀속 — 레이아웃 이동이 폰트 교체에서 온다 (정상 − 대조군)',
      (norm?.cls ?? 0) - (blk?.cls ?? 0) > 0.05,
      `정상 ${norm?.cls?.toFixed(5)} − 대조군 ${blk?.cls?.toFixed(5)} = ${((norm?.cls ?? 0) - (blk?.cls ?? 0)).toFixed(5)}`)
    check('S0-6 판별자 — 정상 실행에서 Pretendard가 실제로 로드됐다',
      (norm?.loaded ?? 0) > 0, `로드 ${norm?.loaded}조각`)
    if (!existsSync(CLS_FIXTURE)) {
      check('S0-6 CLS 고정 기준선 파일이 있다', false, `${CLS_FIXTURE} 없음 — --cls --baseline으로 채취할 것`)
    } else {
      const pinned = JSON.parse(readFileSync(CLS_FIXTURE, 'utf8'))
      // ⚠ 이 단언은 '좋다'가 아니라 '**나빠지지 않았다**'이다.
      //   현재 값 자체가 개선 대상이다(실측 ≈0.27 — Google '양호' 기준 0.1을 넘는다).
      //   원인은 Pretendard의 줄상자가 맑은 고딕보다 낮아 행이 **줄어드는** 것이다(행마다 22px 위로).
      //   근본 수리는 폴백에 metric override(ascent/descent/size-adjust)를 다는 것 — W-7에 남겼다.
      check(`S0-6 FOUT 리플로우가 기준선보다 악화되지 않았다 (실측 ${norm?.cls?.toFixed(5)} / 기준 ${pinned.normalCls})`,
        (norm?.cls ?? 99) <= pinned.normalCls + 0.05,
        '폰트 스택·preload·서식 행높이를 건드리면 여기서 드러난다')
    }
  }
  summary()
  process.exit(0)
}

/** 토큰 요소 수가 **안정될 때까지** 기다린다(2회 연속 같은 값).
 *
 *  ⚠ 고정 대기 600ms는 결정적이지 않았다. 1.4 화면에는 비동기로 뒤늦게 붙는 10px 안내문
 *    ("점검결과 입력 불가 — 진행 중인 자체점검 회차가 …")이 있는데, 그게 **정확히 600ms
 *    경계**에서 들어왔다 나갔다 해 인쇄 축이 10px 31↔32로 진동했다. 실측: 600ms에서 31,
 *    1400ms 이후로는 항상 32.
 *
 *  ⚠ 이 진동은 기준선으로 못 막는다 — 31로 잡으면 32인 실행에서, 32로 잡으면 31인 실행에서
 *    빨개진다. 실제로 한 실행 안에서 S0-4(고정 기준선 대조)와 E-2(구 값 재현 대조)가 서로
 *    어긋나기까지 했다. 두 측정 시점이 경계 양쪽에 걸린 것이다.
 *    **고칠 것은 기준선이 아니라 측정 시점이다.** */
/*  ⚠⚠ '안정'만으로는 부족하다 — 첫 수리가 여기서 실패했다. 안내문이 도착하기 **전에도**
 *      개수는 완벽히 안정적이라(아직 아무것도 안 오므로) 2회 연속 같은 값이면 500ms에
 *      조기 통과해 버렸다. 진동이 그대로 재현됐다(3회 중 31·32·31).
 *      **오지 않은 것과 오고 나서 멈춘 것은 구별되지 않는다** — 그래서 하한(MIN_MS)을
 *      함께 둔다. 실측상 안내문은 1400ms까지 도착하므로 2.5s면 충분하다. */
const settleTokens = async (page: any, tries = 24, gap = 300, minMs = 2500): Promise<number> => {
  const t0 = Date.now()
  let last = -1, stable = 0
  for (let i = 0; i < tries; i++) {
    const n: number = await page.evaluate(`document.querySelectorAll('[class*="text-form-"]').length`)
    if (n > 0 && n === last) stable++
    else { stable = 0; last = n }
    if (stable >= 3 && Date.now() - t0 >= minMs) return n
    await page.waitForTimeout(gap)
  }
  return last
}

/** 인쇄 축 (S3-5~7) — 별도 경로. 화면 15개를 돌 필요가 없다(토큰이 붙은 요소만 보므로). */
if (MODE_PRINT) {
  const printResult: any = {}
  try {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await login(page, email)
    const url = `${BASE}/customers/${custId}?tab=plan&form=1.4`

    // ① 지금 화면(S3 적용 상태)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.evaluate('document.fonts.ready'); await settleTokens(page)
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
    await page.evaluate('document.fonts.ready'); await settleTokens(page)
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

  // ── S0-4 인쇄 고정 기준선 ────────────────────────────────────────────────
  //  ⚠ 위의 screenOld 대조만으로는 부족하다: OLD_VALUES(이 스크립트)와 @media print(CSS)는
  //    **같은 목록의 두 사본**이라, 둘을 함께 잘못 고치면 서로 일치해 통과한다.
  //    커밋된 파일과 대조하는 축을 하나 더 걸어 그 공모를 끊는다.
  if (MODE_BASELINE) {
    mkdirSync('scripts/_fixtures', { recursive: true })
    writeFileSync(PRINT_FIXTURE, JSON.stringify({
      note: '소방계획서_35 S0-4 — 인쇄 미디어 computed font-size 고정 기준선. 손으로 고치지 말 것',
      print: printResult.print,
    }, null, 2), 'utf8')
    console.log(`✅ 인쇄 기준선 기록: ${PRINT_FIXTURE}  ${show(printResult.print)}`)
  } else if (existsSync(PRINT_FIXTURE)) {
    const pinned = JSON.parse(readFileSync(PRINT_FIXTURE, 'utf8')).print
    check('S0-4 인쇄 값이 **커밋된 고정 기준선**과 일치 (OLD_VALUES 상수와 무관한 축)',
      eq(printResult.print ?? { hist: {} }, pinned ?? { hist: {} }),
      `인쇄 ${show(printResult.print)} / 고정 ${show(pinned)}`)
  } else {
    check('S0-4 인쇄 고정 기준선 파일이 있다', false,
      `${PRINT_FIXTURE} 없음 — --print --baseline 으로 채취할 것`)
  }

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

  // 목록 동기화 정적 가드 (DEF-B2) — 브라우저와 무관하므로 인쇄 축에 함께 둔다.
  assertTokenListsMatch()

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
    // 2026-08-30 세부제원 패널 확대 — **항등 축에서만** 부스트를 되돌린다.
    //   기준선(S0 고정)은 부스트 이전에 기록됐다. 여기서 누르지 않으면 패널이 늘 마운트돼 있는
    //   1.4·1.4-specs 두 화면이 영원히 빨갛고, 그렇다고 기준선을 다시 뜨면 S35 코드모드의
    //   '픽셀이 하나도 안 변했다' 증명 자체가 사라진다. 눌러도 어긋난다면 그건 부스트가 아니라
    //   **다른 것**이 변한 것이고, 그게 이 축이 지켜야 할 바로 그것이다.
    //   ⚠ --overflow에는 걸지 않는다 — 거기선 실제로 커진 기하를 재야 넘침이 의미가 있다.
    //   ⚠ --baseline에도 **함께** 건다. 기록 때 안 걸고 대조 때만 걸면 두 모드가 서로 다른
    //     화면을 보게 되어, 기준선을 다시 뜨는 순간 항등 축이 통째로 빨개진다.
    if (MODE_IDENTITY || MODE_BASELINE) await page.addStyleTag({ content: BOOST_OFF })
    // ⚠ S6-6 변이 — 넘침 검출기가 정말 작동하는지 본다.
    //
    //   처음엔 `--fs-scale: 2`로 밀었는데 **넘침이 0이었다**. 그건 검사가 죽어서가 아니라
    //   설계가 작동한 것이다 — 숫자열 폭(--fs-col-num)과 세부제원 패널 폭이 배율과 **함께**
    //   커지므로 기하가 같이 늘어나 넘칠 수가 없다. 즉 **배율은 이 검출기의 변이축이 못 된다**.
    //   (그 자체가 S6-1이 초록인 이유의 설명이기도 하다.)
    //
    //   그래서 '넘칠 수밖에 없는 것'을 직접 심어 검출기만 시험한다.
    if (MUTATE) await page.addStyleTag({ content: 'table { min-width: 4000px !important }' })
    await page.evaluate('document.fonts.ready')
    await page.waitForTimeout(500)
    collected[key] = await page.evaluate(COLLECT)

    // S6-2 — 같은 화면에서 배율만 갈아끼워 페이지 밀림을 잰다(이동 추가 0).
    //   변이 모드는 표에 min-width를 심으므로 이 축이 무의미하다 — 건너뛴다.
    if (MODE_OVERFLOW && !MUTATE) {
      const g: any = {}
      for (const s of SCALES) {
        await page.evaluate(`document.documentElement.setAttribute('data-fs','${s}')`)
        await page.waitForTimeout(220)
        g[s] = await page.evaluate(SCALE_GEOM)
      }
      await page.evaluate(`document.documentElement.removeAttribute('data-fs')`)
      scaleGeom[key] = g
    }
  }

  // 1.4 세부제원 패널 — 열어야 rowtable이 생긴다(닫힌 채 재면 0개를 세고 통과한다)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
  if (MODE_IDENTITY || MODE_BASELINE) await page.addStyleTag({ content: BOOST_OFF })   // 위 루프와 같은 이유
  await page.evaluate('document.fonts.ready')
  // ⚠ 패널을 여는 것은 **설비명 클릭**이다(plan-form14.tsx ledgerLabel → data-testid="form14-ledger-…").
  //   '대장'이라는 글자를 가진 버튼을 찾는 휴리스틱은 아무거나 눌러 놓고 panelOpened=true를 돌려줬고,
  //   rowtable은 0개인 채 기준선이 채취됐다 — 위험 위젯이 통째로 빠진 초록이었다.
  // ⚠ 서버 액션 응답 대기를 **클릭보다 먼저** 등록한다. 클릭 뒤에 등록하면 이미 끝난 응답을
  //   놓치고 그대로 흘러간다. (waitForResponse는 등록 이후 도착분만 보므로, 페이지 로드 중
  //   끝난 POST 4건은 여기 안 걸린다 — 실측 확인.)
  const inspectedResp = page.waitForResponse(
    (r: any) => r.request().method() === 'POST' && r.url().includes('/customers/'),
    { timeout: 30000 }).catch(() => null)
  const opened = await page.evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
    if (!els.length) return false;
    els[0].click();
    return true;
  })()`)
  // ⚠ 구 코드는 `waitForTimeout(1800)` 고정이었고 **그게 플레이크의 원인이었다**(소방계획서_37 S4-5).
  //   패널을 열면 fetchInspected()가 서버 액션을 쏘고, 그 응답이 진행도(0/70·14/48)·불량 건수·
  //   «점검함·제원 미입력 N곳» 배지 ~8개를 그린다. 실측 응답 시각이 **+1603ms·+1688ms** —
  //   1800ms 문턱에 그야말로 걸쳐 있어, 서버가 조금만 느려지면 그 8개가 통째로 빠진 채 채집됐다
  //   (1.4-specs가 303노드 ↔ 295노드를 오갔다). 그 상태로 --baseline을 뜨면 **사라진 8개가
  //   영원히 정상이 된다** — 실제로 한 번 그렇게 기록했다가 되돌렸다.
  //
  //   ⚠ networkidle은 답이 **아니다**(반증 완료). page.waitForLoadState('networkidle')은
  //     마지막 **내비게이션**의 라이프사이클을 반영해서, 이미 로드된 페이지에서는 즉시 반환하고
  //     이후 서버 액션을 기다리지 않는다.
  //
  //   증명(scripts/_probe37-flake.mts — 2×2, 6/0): 서버 액션 응답만 3500ms 늦춘 뒤
  //     구 대기 → 불량배지 0개(12px 45) · 새 대기 → 2개(53). 지연이 없으면 둘 다 2개(53).
  //     원인과 수리를 **대조군과 함께** 실증했다.
  await inspectedResp
  await page.waitForTimeout(400)   // 응답 → 리렌더 1프레임
  // ⚠ '패널이 열렸다'만으로는 부족하다 — 열려도 체크된 설비가 없으면 rowtable이 0개다.
  //   실제로 그 위젯이 그려졌는지를 별도 축으로 센다.
  const rowtables = await page.evaluate(`document.querySelectorAll('[data-testid^="rowtable-"]').length`)
  collected['1.4-specs'] = { ...(await page.evaluate(COLLECT)), panelOpened: opened, rowtables }

  // ── S6-3·S6-4 — 값을 **실제로 타이핑한 뒤** 배율별로 잰다 ────────────────────
  if (MODE_OVERFLOW && !MUTATE) {
    const boxes = page.locator('[data-testid^="rowtable-"] input:not([disabled])')
    const n = await boxes.count()
    for (const lvl of FILL_LEVELS) {
      // ⚠ 한 칸씩 채운다. await 사이에 재렌더가 끝나므로 다음 setCell이 신선한 `shown`을 읽는다.
      //   한꺼번에 쓸어 넣으면 마지막 한 칸만 남고 나머지는 조용히 되돌아간다.
      for (let i = 0; i < n; i++) {
        const el = boxes.nth(i)
        const cls = (await el.getAttribute('class')) ?? ''
        await el.fill(cls.includes('text-left') ? lvl.wide : lvl.num)
      }
      await page.waitForTimeout(500)
      const per: any = {}
      for (const s of SCALES) {
        await page.evaluate(`document.documentElement.setAttribute('data-fs','${s}')`)
        await page.waitForTimeout(350)
        per[s] = await page.evaluate(MEASURE_INPUTS)
      }
      await page.evaluate(`document.documentElement.removeAttribute('data-fs')`)
      await page.waitForTimeout(250)
      inputGeom[lvl.id] = per
    }
  }
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

  if (MODE_OVERFLOW && MUTATE) {
    // ⚠ 변이 모드의 기대는 정반대다 — 배율 2배에서 **넘쳐야** 검사가 살아 있는 것이다.
    //   화면별로 세지 않고 전체 합으로 본다(어느 화면이 먼저 넘치는지는 이 축의 관심이 아니다).
    let over = 0, docOver = 0, tables = 0
    for (const c of Object.values(collected) as any[]) {
      tables += c.tables.length
      over += c.tables.filter((t: any) => t.sw > t.cw + 1).length
      if (c.docScrollW > c.docClientW) docOver++
    }
    check(`변이 대상 표가 실재한다 (${tables}개)`, tables > 0, '표가 0이면 무엇이든 통과한다')
    check('S6-6 변이 — 넘칠 수밖에 없는 표를 심으면 검출기가 잡는다',
      over > 0,
      over === 0
        ? '⚠ min-width 4000px를 심었는데도 넘침 0 — 넘침 검출기가 죽었다(항진명제)'
        : `정상: 넘친 표 ${over}개 · 페이지 밀림 ${docOver}화면`)
  } else if (MODE_OVERFLOW) {
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

    // ── S6-2 페이지 전체 가로 밀림은 **전 배율** 금지 ──────────────────────────
    const geomScreens = Object.keys(scaleGeom)
    check(`S6-2 배율을 잰 화면 수가 수집 화면과 같다 (${geomScreens.length})`,
      geomScreens.length === Object.keys(collected).length - 1,   // 1.4-specs는 별도 축
      `배율 측정 ${geomScreens.length} vs 수집 ${Object.keys(collected).length - 1}`)
    // 판별자 — 배율이 실제로 먹었는지 먼저 본다. 안 먹었으면 아래 초록은 전부 무의미하다.
    const grew = geomScreens.filter(k => scaleGeom[k].xl.fs > scaleGeom[k].md.fs + 0.5)
    check(`S6-2 판별자 — xl에서 글자가 실제로 커졌다 (${grew.length}/${geomScreens.length} 화면)`,
      grew.length === geomScreens.length,
      geomScreens.filter(k => !grew.includes(k)).map(k => `${k} md=${scaleGeom[k].md.fs} xl=${scaleGeom[k].xl.fs}`).join(' · '))
    for (const s of SCALES) {
      const bad = geomScreens.filter(k => scaleGeom[k][s].docScrollW > scaleGeom[k][s].docClientW)
      check(`S6-2 배율 ${s} — 전 화면 페이지 가로 스크롤 없음`,
        bad.length === 0,
        bad.map(k => `${k} ${scaleGeom[k][s].docScrollW}>${scaleGeom[k][s].docClientW}`).join(' · '))
    }
    // 표 자체의 가로 스크롤은 lg·xl에서 **허용**한다(overflow-x-auto가 받는다).
    //   금지 대상은 페이지가 밀리는 것뿐이므로 여기서는 계수만 보고한다.
    for (const s of ['lg', 'xl'] as const) {
      const t = geomScreens.reduce((sum, k) => sum + scaleGeom[k][s].tablesOver, 0)
      console.log(`   · 배율 ${s} 표 자체 가로 스크롤 ${t}건 (허용 — overflow-x-auto가 받는다)`)
    }

    // ── S6-3·S6-4 입력칸 기하 ────────────────────────────────────────────────
    check('S6-3 입력칸 측정이 실제로 이뤄졌다',
      Object.keys(inputGeom).length === FILL_LEVELS.length, `측정 ${Object.keys(inputGeom).length}수준`)
    for (const lvl of FILL_LEVELS) {
      const per = inputGeom[lvl.id]
      if (!per) { check(`[${lvl.id}] 측정됨`, false, '수집 실패'); continue }
      // ⚠ 항진 차단 — 칸이 0개거나 값이 되돌아갔으면 '잘림 0'은 아무 뜻이 없다.
      const emptyAt = SCALES.filter(s => per[s].n === 0 || per[s].nonEmpty !== per[s].n)
      check(`[${lvl.id}] 잰 시점에 값이 남아 있다 (칸 ${per.md.n}개, 전 배율)`,
        per.md.n > 0 && emptyAt.length === 0,
        emptyAt.map(s => `${s}: ${per[s].nonEmpty}/${per[s].n}`).join(' · ') || '칸이 0개다')
      check(`[${lvl.id}] 판별자 — 배율에 따라 입력칸 글자가 커진다`,
        per.xl.fs > per.md.fs + 0.5, `md=${per.md.fs} lg=${per.lg.fs} xl=${per.xl.fs}`)
      // S6-4 — 세로 잘림은 전 배율·전 수준에서 0이어야 한다(h-form-6이 배율을 타므로).
      for (const s of SCALES) {
        check(`S6-4 [${lvl.id}] 배율 ${s} — 입력칸 높이 ≥ 줄높이 (글자 잘림 없음)`,
          per[s].clipped === 0, per[s].clipSample.join(' · '))
      }
    }
    // S6-3 ① 실무 값에서는 전 배율 가로 잘림 0
    {
      const per = inputGeom['실무 3자리']
      for (const s of SCALES) {
        check(`S6-3 [실무 3자리] 배율 ${s} — 가로 잘림 0`,
          (per?.[s]?.cut ?? -1) === 0, per?.[s]?.cutSample?.join(' · ') ?? '측정 없음')
      }
    }
    // S6-3 ② 스트레스 값의 진짜 질문은 '확대가 자릿수를 깎는가'다(W-1).
    //   실측 답은 **아니오, 오히려 낫다** — 처음 쟀을 때 md 8칸 / lg·xl 0칸이었다. 패널 폭과
    //   숫자열 폭이 배율을 함께 타는데 패널 안쪽 여백(p-4 32px)은 안 타서, 큰 배율일수록
    //   비례적으로 여유가 늘기 때문이다. 그래서 절대 0이 아니라 **악화되지 않음**을 단언한다.
    //   ⚠ md의 잘림은 확대가 만든 것이 아니라 5자리·6자 동명에서 원래 있던 경계값이었다.
    //     그 뒤 패널 폭이 배율을 타게 되면서(data-fs-boost·--fs-panel-w) md도 0으로 떨어졌다.
    //     단언을 '악화되지 않음'으로 둔 이유가 여기 있다 — 절대 0으로 박았다면 그때는
    //     빨간 채로 등재됐을 것이고, 지금은 우연히 초록이 됐다고 느슨해지지도 않는다.
    {
      const per = inputGeom['스트레스 5자리']
      for (const s of ['lg', 'xl'] as const) {
        check(`S6-3 [스트레스 5자리] 배율 ${s}에서 잘림이 md보다 늘지 않는다 (md ${per?.md?.cut} → ${s} ${per?.[s]?.cut})`,
          (per?.[s]?.cut ?? 99) <= (per?.md?.cut ?? -1),
          per?.[s]?.cutSample?.join(' · ') ?? '측정 없음')
      }
      // 조건부로 찍는다 — 이미 해소된 뒤에도 "잔여 8칸"을 무조건 찍으면 결함이 남은 것처럼 읽힌다.
      console.log(per?.md?.cut
        ? `   · 스트레스 5자리 md 잘림 ${per.md.cut}칸 — 확대 이전부터 있던 경계값(5자리 수량·6자 동명). 35의 회귀가 아니다`
        : `   · 스트레스 5자리도 전 배율 잘림 0 — 패널·숫자열 폭이 배율을 함께 타면서 종전 md 8칸이 해소됐다`)
    }
  }

  summary()
}
