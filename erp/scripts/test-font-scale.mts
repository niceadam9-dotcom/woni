/** 소방계획서_35 S4 — 글자 배율 4경로 동기화 E2E (D-1~D-6).
 *
 *  다크 모드(scripts/test-theme-settings.mts)와 같은 구조다: 정본은 DB 컬럼,
 *  쿠키는 첫 페인트 캐시, <html data-fs>는 그 표현. **세 축이 함께 맞아야** 통과다.
 *  한 축만 보면 "화면은 커졌는데 다른 기기엔 안 따라간다"를 못 잡는다.
 *
 *  ⚠ D-6(154 미적용 관용성)은 컬럼이 있는 DB에서는 직접 검증할 수 없다.
 *    대신 **관용 조회가 오류를 null로 삼키는지**를 코드 축으로 단언한다 —
 *    이게 깨지면 컬럼 없는 DB에서 로그인이 전멸한다(feedback_supabase_check_error).
 *
 *  실행: npx tsx scripts/test-font-scale.mts
 */
import { readFileSync } from 'node:fs'
import { raw, BASE, check, summary, launch, login, mkUser, delUser, PW } from './_e2e-helpers.mjs'

/** 변이 모드 — 배율 배선을 죽여 B-4가 정말 빨개지는지 본다(S4-13).
 *  이 실행의 초록은 '기능이 된다'가 아니라 '검사가 죽지 않았다'는 뜻이다. */
const MUTATE = process.argv.includes('--mutate')

const stamp = Date.now()
const emailA = `s35fsA_${stamp}@example.com`
const emailB = `s35fsB_${stamp}@example.com`
let uA: any = null, uB: any = null

/** profiles.form_font_scale 실제 값.
 *  ⚠ 오류를 조용히 undefined로 삼키면 '컬럼 없음'과 '행 없음'과 '권한 없음'이 구별되지 않는다
 *  — 실제로 그 셋을 헷갈려 154를 두 번 적용할 뻔했다. 이유를 함께 돌려준다. */
let lastDbNote = ''
async function dbScale(id: string): Promise<string | undefined> {
  const { data, error } = await raw.from('profiles').select('form_font_scale').eq('id', id).maybeSingle()
  if (error) { lastDbNote = `error=${error.code ?? ''} ${error.message}`; return undefined }
  if (!data) { lastDbNote = 'profiles 행 없음'; return undefined }
  lastDbNote = ''
  return (data as any)?.form_font_scale
}
const attr = (page: any) => page.evaluate(`document.documentElement.getAttribute('data-fs')`)
const cookieOf = async (ctx: any) => (await ctx.cookies()).find((c: any) => c.name === 'erp-fs')?.value

// ── 코드 축: 관용 조회 규약 (D-6 / W-9) ───────────────────────────────────────
{
  const fs = readFileSync('src/lib/font-scale.ts', 'utf8')
  check('D-6 readProfileFontScale가 오류를 null로 삼킨다 (컬럼 미적용 DB 관용)',
    /if\s*\(\s*error\s*\)\s*return null/.test(fs), '')
  const auth = readFileSync('src/lib/auth.ts', 'utf8')
  const m = auth.match(/PROFILE_COLS\s*=\s*[`'"]([^`'"]+)[`'"]/)
  const cols = m?.[1] ?? ''
  // ⚠ **매칭 성공을 먼저 단언한다.** 종전엔 `?.[1] ?? ''` 뒤에 `!''.includes(...)`라
  //   **정규식이 못 찾으면 그대로 통과**했다 — 독립 판정 C가 변이로 실증한 공허 경로 3개:
  //   ①const PROFILE_COLS 삭제 ②배열+join 형태로 리팩터 ③fetchProfile에 select 인라인.
  //   셋 다 '없는 컬럼 select = 로그인 전멸' 위험을 되살리는데 검사는 초록이었다.
  check('W-9 전제: PROFILE_COLS 문자열 상수를 실제로 찾았다 (못 찾으면 아래 단언이 공허하다)',
    m !== null && cols.length > 10,
    m ? `길이 ${cols.length}` : '⚠ 정규식 미매칭 — 상수 형태가 바뀌었다면 이 검사부터 고칠 것')
  check('W-9 전제: 프로필 조회가 PROFILE_COLS를 경유한다 (select 인라인이면 상수 검사가 무의미)',
    /\.select\(\s*PROFILE_COLS\s*\)/.test(auth),
    'auth.ts에서 .select(PROFILE_COLS) 호출을 못 찾았다 — 인라인 select로 우회됐을 수 있다')
  check('W-9 form_font_scale이 PROFILE_COLS에 없다 (없는 컬럼 select = 로그인 전멸)',
    !cols.includes('form_font_scale'), `PROFILE_COLS = ${cols.slice(0, 90)}…`)
  // CSS 정본과 lib의 비율 사본이 어긋나지 않는지 — 어긋나면 화면과 계산이 다른 말을 한다
  const css = readFileSync('src/app/globals.css', 'utf8')
  const lg = css.match(/html\[data-fs="lg"\]\s*\{\s*--fs-scale:\s*([\d.]+)/)?.[1]
  const xl = css.match(/html\[data-fs="xl"\]\s*\{\s*--fs-scale:\s*([\d.]+)/)?.[1]
  const lib = readFileSync('src/lib/font-scale.ts', 'utf8')
  check('배율 실값이 CSS와 lib에서 일치한다',
    lg === '1.15' && xl === '1.3' && /md:\s*1,\s*lg:\s*1\.15,\s*xl:\s*1\.3/.test(lib),
    `css lg=${lg} xl=${xl}`)

  // ── 세부제원 패널 확대 축 (2026-08-30) ──────────────────────────────────────
  // --fs-step은 --fs-scale의 사본이다(변수 순환 회피용). 어긋나면 부스트 패널만 다른 배율이
  // 되는데, 화면을 열어 보지 않으면 아무 데서도 안 터진다 — 그래서 여기서 대조한다.
  const stepLg = css.match(/html\[data-fs="lg"\][^}]*--fs-step:\s*([\d.]+)/)?.[1]
  const stepXl = css.match(/html\[data-fs="xl"\][^}]*--fs-step:\s*([\d.]+)/)?.[1]
  check('B-6 --fs-step 사본이 --fs-scale과 일치한다 (부스트 패널이 딴 배율이 되는 것 방지)',
    stepLg === lg && stepXl === xl, `step lg=${stepLg} xl=${stepXl} / scale lg=${lg} xl=${xl}`)
  // D35-5(사용자 결정): 인쇄는 화면 확대를 전부 되돌린다. 부스트도 예외가 아니다 —
  // --fs-step만 1로 눌러선 ×1.15가 살아남으므로 --fs-scale을 직접 되돌려야 한다.
  check('B-7 인쇄가 [data-fs-boost]를 1로 되돌린다 (법정 서식 규격 — D35-5)',
    /@media print\s*\{[\s\S]*?\[data-fs-boost\]\s*\{\s*--fs-scale:\s*1\s*\}[\s\S]*?\n\}/.test(css), '')
  // 순환 참조 방어 — calc(var(--fs-scale) …)로 자기 자신을 읽으면 guaranteed-invalid가 되어
  // 패널 글자가 통째로 상속 기본값으로 떨어진다(조용한 전멸). 정적으로 못 박는다.
  const boost = css.match(/\[data-fs-boost\]\s*\{\s*--fs-scale:\s*([^}]+)\}/)?.[1] ?? ''
  check('B-8 [data-fs-boost]가 --fs-scale을 자기참조하지 않는다 (CSS 변수 순환)',
    boost.includes('--fs-step') && !boost.includes('var(--fs-scale)'), `boost = ${boost.trim()}`)

  // ── 점검표 입력 sticky 2층 (소방계획서_38 S1-3) ─────────────────────────────
  // 중분류 헤더 높이와 소제목 sticky offset이 어긋나면 두 줄이 겹쳐 항목 첫 행을 가린다.
  // 종전에는 h-[22px]/top-[22px] 리터럴 쌍이라 한쪽만 고치면 조용히 깨졌다 — 화면을 열어
  // 봐야만 보이는 결함이다. 값이 아니라 **같은 변수를 읽는가**를 본다: 값 대조는 나중에
  // 둘 다 30px로 바꾸는 식의 정당한 변경까지 막지만, 이 단언은 갈라지는 것만 막는다.
  const hdrH = css.match(/@utility h-sheet-hdr[^}]*calc\(var\((--[\w-]+)\)/)?.[1]
  const subTop = css.match(/@utility top-sheet-hdr[^}]*calc\(var\((--[\w-]+)\)/)?.[1]
  check('S-1 h-sheet-hdr와 top-sheet-hdr가 같은 변수를 쓴다 (sticky 2층 겹침 방지)',
    !!hdrH && hdrH === subTop, `hdr=${hdrH} sub=${subTop}`)
  // 두 유틸리티 다 --fs-scale을 곱해야 배율에서 등식이 유지된다(한쪽만 고정이면 xl에서 겹친다)
  const sheetUtils = css.match(/@utility (?:h-sheet-hdr|top-sheet-hdr|h-sheet-chip|w-sheet-toc|size-sheet-mark)[^}]*\}/g) ?? []
  check('S-2 점검표 입력 기하 유틸리티 5종이 전부 --fs-scale을 곱한다',
    sheetUtils.length === 5 && sheetUtils.every(u => u.includes('var(--fs-scale)')),
    `${sheetUtils.length}종 / 배율 누락 ${sheetUtils.filter(u => !u.includes('var(--fs-scale)')).length}`)
  // S-3 — ○/✕ 탭 타깃 하한. 배율은 항상 ×1 이상이므로 --sheet-mark가 곧 하한이고,
  //   여기를 내리면 **모든 배율에서** 버튼이 함께 작아진다. 현장 근거(28px는 오탭이 잦다,
  //   sheet-item-editor.tsx)가 주석으로만 있으면 다음 사람이 '여백이 아깝다'며 줄인다.
  //   리터럴이 아니라 토큰을 읽는지도 함께 본다 — 리터럴로 되돌아가면 이 검사가 눈이 먼다.
  const markVal = parseFloat(css.match(/--sheet-mark:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? '0')
  const markUtil = css.match(/@utility size-sheet-mark[^}]*\}/)?.[0] ?? ''
  check('S-3 ○/✕ 탭 타깃 하한 40px + 토큰 참조 (현장 오탭 근거)',
    markVal >= 40 && markUtil.includes('var(--sheet-mark)'),
    `--sheet-mark=${markVal}px · 토큰참조=${markUtil.includes('var(--sheet-mark)')}`)
}

try {
  uA = await mkUser({ email: emailA, name: 'S35 배율A', employeeId: `S35A${stamp % 100000}` })
  uB = await mkUser({ email: emailB, name: 'S35 배율B', employeeId: `S35B${(stamp + 1) % 100000}` })

  const hasColumn = (await dbScale(uA)) !== undefined
  check('마이그레이션 154 적용 여부 (미적용이면 아래 DB 축은 SKIP이 아니라 그대로 실패한다)',
    hasColumn, hasColumn ? '' : `⚠ ${lastDbNote} — 154 적용/스키마 캐시/행 존재 중 무엇인지 위 사유로 구별할 것`)

  // ── D-1: 설정에서 고르면 3축이 함께 선다 ────────────────────────────────────
  const { browser, page } = await launch()
  const ctx = page.context()
  try {
    await login(page, emailA)
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="font-scale-settings-card"]', { timeout: 15000 })
    check('D-1a 설정에 글자 크기 카드가 있다', true, '')

    await page.click('[data-testid="fs-option-lg"]')
    await page.waitForSelector('[data-testid="fs-saved"]', { timeout: 15000 })
    const a1 = await attr(page), c1 = await cookieOf(ctx), d1 = await dbScale(uA)
    check('D-1 3축 일치 (html·쿠키·DB 모두 lg)',
      a1 === 'lg' && c1 === 'lg' && d1 === 'lg', `html=${a1} cookie=${c1} db=${d1} ${lastDbNote}`)

    // ── D-2: 새로고침 후에도 첫 페인트부터 유지 (인라인 스크립트) ─────────────
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    const a2 = await attr(page)
    check('D-2 새로고침 직후(domcontentloaded)에도 data-fs 유지 — FOUC 없음',
      a2 === 'lg', `html=${a2}`)

    // ── 배율이 실제로 화면 크기를 바꾸는가 (B-4: 절대값이 아니라 **비**) ───────
    const { data: fp } = await raw.from('fire_plans').select('customer_id').limit(1)
    const cust = fp?.[0]?.customer_id
    if (cust) {
      const measured: Record<string, number> = {}
      for (const s of ['md', 'lg', 'xl']) {
        await page.goto(`${BASE}/customers/${cust}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
        // ⚠ S4-13 변이 — 배율을 1로 강제 고정한다. 판별자가 살아 있다면 아래 비 검사가 무너진다.
        //   (data-fs는 그대로 두므로 '속성은 바뀌는데 크기는 안 바뀌는' 상태를 정확히 재현한다.
        //    이게 실제로 일어날 법한 회귀다 — 토큰 배선이 끊기거나 @utility가 사라지는 경우.)
        if (MUTATE) await page.addStyleTag({ content: ':root, html[data-fs] { --fs-scale: 1 !important }' })
        // ⚠ **하이드레이션과 경합한다.** FontScaleSync(유실보정)의 useEffect가 DB값으로
        //   data-fs를 되돌리는데, 콜드 컴파일 라우트에서는 그 effect가 아래 setAttribute
        //   **뒤에** 끝난다 → md를 세워도 lg로 되돌아가 `md=14.95`(=13×1.15=DB의 lg)가 잡혔다.
        //   독립 판정 C가 2회 중 1회 재현한 거짓 빨강이고, **실패 모양이 진짜 회귀와
        //   구별되지 않는다**는 게 진짜 위험이었다.
        //   → 세우고, 한 박자 뒤 **되돌아갔는지 확인해 다시 세운다**. 안정될 때까지 반복.
        let held = ''
        for (let t = 0; t < 12; t++) {
          await page.evaluate(`document.documentElement.setAttribute('data-fs','${s}')`)
          await page.waitForTimeout(250)
          held = await page.evaluate(`document.documentElement.getAttribute('data-fs')`) as string
          if (held === s) { await page.waitForTimeout(150)
            held = await page.evaluate(`document.documentElement.getAttribute('data-fs')`) as string
            if (held === s) break }
        }
        // 되돌림을 못 이겼으면 **측정값을 쓰지 않는다** — 조용히 틀린 수를 비교하는 것보다 낫다.
        check(`B-4 전제: 배율 ${s}가 측정 시점까지 유지된다 (FontScaleSync 되돌림 방지)`,
          held === s, `data-fs=${held} (기대 ${s}) — 하이드레이션 경합`)
        const v = await page.evaluate(`(() => {
          const el = document.querySelector('.text-form-xs');
          return el ? parseFloat(getComputedStyle(el).fontSize) : null })()`)
        measured[s] = v as number
      }
      // ⚠ 요소를 못 찾으면 SKIP이 아니라 FAIL — '검사할 게 없어서 통과'를 막는다
      check('B-4 측정 대상(.text-form-xs)이 실재한다',
        Number.isFinite(measured.md), `md=${measured.md}`)
      const ratioHolds = Math.abs(measured.lg - measured.md * 1.15) < 0.5 && Math.abs(measured.xl - measured.md * 1.3) < 0.5
      if (MUTATE) {
        // 변이 모드에서는 **무너져야** 통과다 — 초록은 "본 검사가 빨개질 수 있다"는 뜻이다.
        check('S4-13 변이 — 배율을 1로 고정하면 비 검사가 무너진다',
          !ratioHolds,
          ratioHolds ? '⚠ 배율을 죽였는데도 통과했다 — B-4가 항진명제다'
                     : `정상: md=${measured.md} lg=${measured.lg} xl=${measured.xl} (전부 같아야 함)`)
      } else {
        check('B-4 배율 비가 1 : 1.15 : 1.3 (±0.5px)', ratioHolds,
          `md=${measured.md} lg=${measured.lg} xl=${measured.xl}`)
      }
    } else {
      check('B-4 측정용 고객 존재', false, '소방계획서를 가진 고객이 없다')
    }

    // ── 세부제원 패널 부스트 (2026-08-30) ───────────────────────────────────────
    //  정적 정규식(B-6~B-8)은 "규칙이 적혔는가"만 본다. 부스트가 엉뚱한 요소에 붙거나
    //  명시도에 져서 실제로는 안 걸리는 경우를 못 잡으므로 **안팎을 나란히 재는** 축을 둔다.
    //  절대 px가 아니라 **비**로 본다 — 사용자 배율이 무엇이든 안:밖 = 1.15여야 한다.
    if (cust) {
      await page.goto(`${BASE}/customers/${cust}?tab=plan&form=1.4`, { waitUntil: 'networkidle' })
      await page.evaluate(`document.documentElement.removeAttribute('data-fs')`)
      // ⚠ 부스트만 죽인다(--fs-step 그대로) — '패널이 밖과 같은 크기'라는 회귀를 정확히 재현한다.
      if (MUTATE) await page.addStyleTag({ content: '[data-fs-boost] { --fs-scale: var(--fs-step) !important }' })
      // ⚠ 패널을 여는 것은 **설비명 클릭**이다. '대장' 글자를 가진 버튼을 찾는 휴리스틱은
      //   아무거나 눌러 놓고 열렸다고 답한 전례가 있다(test-plan-readability:339) — testid로만.
      const opened = await page.evaluate(`(() => {
        const els = [...document.querySelectorAll('[data-testid^="form14-ledger-"]')];
        if (!els.length) return false; els[0].click(); return true })()`)
      await page.waitForTimeout(1500)
      const m: any = await page.evaluate(`(() => {
        const panel = document.querySelector('[data-spec-panel]');
        if (!panel) return null;
        const inside = panel.querySelector('.text-form-xs');
        const outside = [...document.querySelectorAll('.text-form-xs')].find(el => !panel.contains(el));
        return {
          inside: inside ? parseFloat(getComputedStyle(inside).fontSize) : null,
          outside: outside ? parseFloat(getComputedStyle(outside).fontSize) : null,
          width: panel.getBoundingClientRect().width, vw: window.innerWidth,
        } })()`)
      // 요소를 못 찾으면 SKIP이 아니라 FAIL — '잴 게 없어서 통과'를 막는다
      check('B-9 패널이 열리고 안·밖 측정 대상이 둘 다 실재한다',
        !!opened && !!m && Number.isFinite(m?.inside) && Number.isFinite(m?.outside),
        `opened=${opened} ${JSON.stringify(m)}`)
      if (m && Number.isFinite(m.inside) && Number.isFinite(m.outside)) {
        const boostHolds = Math.abs(m.inside - m.outside * 1.15) < 0.6
        if (MUTATE) {
          check('S35B 변이 — 부스트를 죽이면 B-10이 무너진다', !boostHolds,
            boostHolds ? '⚠ 부스트를 죽였는데도 통과했다 — B-10이 항진명제다'
                       : `정상: inside=${m.inside} outside=${m.outside} (같아야 함)`)
        } else {
          check('B-10 패널 안 글자가 밖보다 한 단계(×1.15) 크다', boostHolds,
            `inside=${m.inside} outside=${m.outside} 기대=${(m.outside * 1.15).toFixed(2)}`)
          // 폭이 글자를 못 따라가면 표가 패널을 넘겨 가로 스크롤이 생긴다(패널 주석의 불변식)
          const expect = Math.min(m.vw * 0.96, 900 * 1.15)
          check('B-11 패널 폭도 부스트된 배율을 탄다 (기본 900px × 1.15, 96vw 상한)',
            Math.abs(m.width - expect) < 2, `width=${m.width} 기대=${expect.toFixed(1)} vw=${m.vw}`)
        }
      }
    }

    // ── D-3: 쿠키를 지워도 재로그인하면 DB에서 복원 ───────────────────────────
    await ctx.clearCookies()
    await login(page, emailA)
    const c3 = await cookieOf(ctx), a3 = await attr(page)
    check('D-3 쿠키 삭제 후 재로그인 → DB에서 복원',
      c3 === 'lg' && a3 === 'lg', `cookie=${c3} html=${a3}`)

    // ── D-4: 로그아웃하면 쿠키가 사라진다 (공용 PC) ───────────────────────────
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    // 헤더의 로그아웃은 아이콘 버튼이라 텍스트가 없다 — aria-label로 잡는다(header.tsx:42-49)
    const logout = await page.$('button[aria-label="로그아웃"]')
    if (logout) {
      await logout.click()
      await page.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {})
      const c4 = await cookieOf(ctx)
      check('D-4 로그아웃 시 erp-fs 쿠키 제거', c4 === undefined, `cookie=${c4 ?? '(없음)'}`)
    } else {
      check('D-4 로그아웃 버튼을 찾았다', false, '버튼 셀렉터가 낡았다 — 검사를 건너뛰지 않고 실패로 남긴다')
    }
  } finally { await browser.close() }

  // ── D-5: 계정 간 격리 ───────────────────────────────────────────────────────
  const { browser: b2, page: p2 } = await launch()
  try {
    await login(p2, emailB)
    const aB = await attr(p2), dB = await dbScale(uB)
    check('D-5 다른 계정은 기본값 그대로 (A=lg여도 B는 md)',
      (aB === null || aB === 'md') && dB === 'md', `B: html=${aB} db=${dB} / A db=${await dbScale(uA)}`)
  } finally { await b2.close() }
} catch (e: any) {
  check('스크립트 실행', false, e?.message ?? String(e))
} finally {
  if (uA) await delUser(uA)
  if (uB) await delUser(uB)
}

summary()
