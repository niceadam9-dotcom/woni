/** 소방계획서_35 S1-7·S1-9 — 한글이 **실제로 Pretendard로 그려졌는가**.
 *
 *  ⚠ 이 검사가 항진명제가 되는 길 셋. 전부 실측으로 막았다.
 *   ① `document.fonts.check('13px Pretendard', '소방')`
 *      → 폰트가 **로드만 되면** true다. globals.css 스택에 안 넣어도 통과한다.
 *   ② `getComputedStyle(el).fontFamily.includes('Pretendard')`
 *      → **선언된 스택 문자열**을 돌려줄 뿐이다. woff2가 전부 404여도 통과한다.
 *        (실제로 2026-08-29에 proxy.ts가 /fonts를 로그인으로 리다이렉트해
 *         모든 조각이 HTML로 오고 있었다 — 이 두 검사였다면 초록이었다.)
 *   ③ 캔버스에 Pretendard 하나로만 폭을 재기
 *      → 폴백으로 그려져도 "폭이 나왔다"로 통과한다.
 *
 *  채택한 판별자 — **3중 폭 대조**. 실제 요소의 텍스트 폭을 두 프로브와 함께 본다.
 *      targetW  : 화면의 진짜 요소가 차지한 폭
 *      probeP   : 같은 글자·크기·굵기를 'Pretendard Variable'로 강제한 폭
 *      probeSys : 같은 조건을 맑은 고딕(폴백 후보)으로 강제한 폭
 *      판정: |targetW − probeP| < ε  **AND**  |targetW − probeSys| > δ
 *  두 번째 조건이 핵심이다. 폴백으로 그려졌다면 targetW는 probeSys와 같아진다.
 *  '맞다'만 보지 않고 '다른 것과 다르다'를 함께 요구한다.
 *
 *  변이 검증(--mutate): 폰트 라우트를 abort시켜 같은 단언이 **FAIL해야** 한다.
 *  FAIL하지 않으면 판별자가 죽은 것이므로 그 사실 자체를 실패로 보고한다.
 *
 *  S1-9(A-4): 라틴·숫자 폭 불변 — Pretendard를 스택 **후미**에 둔 설계의 실증.
 *  숫자는 여전히 Inter/PJS가 그려야 한다(1.4 세부제원 표의 44px 칸 계산 근거).
 *
 *  실행: npx tsx scripts/test-korean-font-render.mts
 *        npx tsx scripts/test-korean-font-render.mts --mutate
 */
import { BASE, check, summary, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'

const MUTATE = process.argv.includes('--mutate')

/** 브라우저 안에서 3중 폭 대조를 수행한다. */
const MEASURE = `(() => {
  const SAMPLE = '소방계획서점검표작동종합';
  const SIZE = '13px', WEIGHT = '400';
  function measure(family) {
    const s = document.createElement('span');
    s.textContent = SAMPLE;
    s.style.cssText = 'position:absolute;left:-9999px;top:-9999px;white-space:pre;' +
      'font-size:' + SIZE + ';font-weight:' + WEIGHT + ';letter-spacing:normal;font-family:' + family;
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  }
  // 실제 화면 요소가 아니라 '본문 스택 그대로'를 재는 프로브를 target으로 쓴다.
  // body의 computed font-family를 그대로 물려받으므로 화면과 같은 해석을 거친다.
  const bodyStack = getComputedStyle(document.body).fontFamily;
  return {
    bodyStack,
    targetW:  measure(bodyStack),
    probeP:   measure("'Pretendard Variable'"),
    probeSys: measure("'Malgun Gothic','맑은 고딕'"),
    // 라틴·숫자 축 (A-4)
    latinTarget: (() => { const s=document.createElement('span'); s.textContent='0123456789';
      s.style.cssText='position:absolute;left:-9999px;white-space:pre;font-size:13px;font-variant-numeric:tabular-nums;font-family:'+bodyStack;
      document.body.appendChild(s); const w=s.getBoundingClientRect().width; s.remove(); return w })(),
    latinPretendard: (() => { const s=document.createElement('span'); s.textContent='0123456789';
      s.style.cssText="position:absolute;left:-9999px;white-space:pre;font-size:13px;font-variant-numeric:tabular-nums;font-family:'Pretendard Variable'";
      document.body.appendChild(s); const w=s.getBoundingClientRect().width; s.remove(); return w })(),
    fontsReady: document.fonts.status,
  };
})()`

const email = `s35font_${Date.now()}@example.com`
let userId: string | null = null
let browser: any = null

try {
  const u = await mkUser({ email, name: 'S35 폰트 렌더', employeeId: `S35F${Date.now() % 100000}` })
  userId = u   // mkUser는 id 문자열을 반환한다(객체 아님)
  const { browser: b, page } = await launch()
  browser = b

  if (MUTATE) {
    // 변이: 폰트 조각을 전부 죽인다. 판별자가 살아 있다면 아래 단언이 무너져야 한다.
    await page.route('**/fonts/pretendard/**', (r: any) => r.abort())
    console.log('⚠ 변이 모드 — /fonts/pretendard/** 전부 abort. 아래 한글 단언은 FAIL해야 정상이다.\n')
  }

  await login(page, email)
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' })
  // 웹폰트가 실제로 적용될 시간을 준다 (font-display: swap이라 늦게 갈아끼운다)
  await page.evaluate('document.fonts.ready')
  await page.waitForTimeout(600)

  const m: any = await page.evaluate(MEASURE)

  console.log(`   body 스택: ${m.bodyStack}`)
  console.log(`   한글 폭 — 화면 ${m.targetW.toFixed(2)} / Pretendard ${m.probeP.toFixed(2)} / 맑은고딕 ${m.probeSys.toFixed(2)}`)
  console.log(`   숫자 폭 — 화면 ${m.latinTarget.toFixed(2)} / Pretendard ${m.latinPretendard.toFixed(2)}`)
  console.log(`   document.fonts.status = ${m.fontsReady}\n`)

  const dP = Math.abs(m.targetW - m.probeP)
  const dSys = Math.abs(m.targetW - m.probeSys)

  const probeGap = Math.abs(m.probeP - m.probeSys)
  const drawnByPretendard = dP < 0.5 && dSys > 1.0

  if (MUTATE) {
    // ⚠ 변이 모드의 기대는 **정반대**다. 여기서 초록은 "본 검사가 빨개질 수 있다"는 뜻이다.
    //    폰트를 죽이면 Pretendard 강제 프로브조차 맑은 고딕으로 폴백하므로 두 프로브가
    //    같은 값으로 붕괴한다 — 그 붕괴 자체가 판별자가 살아 있다는 증거다.
    check('변이 — 두 프로브가 같은 값으로 붕괴한다 (강제 프로브도 폴백)',
      probeGap < 1.0,
      `|${m.probeP.toFixed(2)} − ${m.probeSys.toFixed(2)}| = ${probeGap.toFixed(2)}px (<1.0 기대)`)
    check('변이 — 폰트를 죽이면 "Pretendard로 그려졌다"가 성립하지 않는다',
      !drawnByPretendard,
      drawnByPretendard
        ? '⚠ 전부 abort했는데도 통과했다 — 판별자가 죽었다(항진명제)'
        : `정상: Δ(Pretendard)=${dP.toFixed(2)} Δ(맑은고딕)=${dSys.toFixed(2)}`)
    // (숫자 폭은 여기서 단언하지 않는다 — 본 실행값을 이 프로세스가 모르므로
    //  하드코딩하거나 `|| true`로 채우면 항진명제가 된다. 라틴 축은 본 실행의 S1-9가 본다.)
  } else {
    // 판별자가 유효한가: 두 프로브가 애초에 구별 가능해야 한다.
    // (같은 폰트로 둘 다 그려지면 아래 대조는 무의미하다)
    check('판별자 유효 — Pretendard와 맑은고딕의 폭이 다르다',
      probeGap > 1.0,
      `|${m.probeP.toFixed(2)} − ${m.probeSys.toFixed(2)}| = ${probeGap.toFixed(2)}px (>1.0 요구)`)
    check('S1-7 한글이 Pretendard로 그려진다 (화면 폭 ≈ Pretendard)',
      dP < 0.5, `Δ = ${dP.toFixed(2)}px (<0.5 요구)`)
    check('S1-7 한글이 맑은 고딕으로 폴백되지 **않았다** (화면 폭 ≠ 맑은고딕)',
      dSys > 1.0, `Δ = ${dSys.toFixed(2)}px (>1.0 요구)`)
    // ── A-4: 숫자는 Pretendard가 아니어야 한다. 스택 후미 배치의 실증.
    check('S1-9 숫자 폭은 Pretendard와 다르다 (라틴은 여전히 PJS/Inter — 표 칸 계산 불변)',
      Math.abs(m.latinTarget - m.latinPretendard) > 0.5,
      `화면 ${m.latinTarget.toFixed(2)} vs Pretendard ${m.latinPretendard.toFixed(2)}`)
  }
} catch (e: any) {
  check('스크립트 실행', false, e?.message ?? String(e))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
}

summary()
