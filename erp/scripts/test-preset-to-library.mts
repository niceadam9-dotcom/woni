// 공통 수기 프리셋 폐지 → 계획서 공통문구 흡수 E2E (2026-08-19)
// 실행: npx tsx scripts/test-preset-to-library.mts   (로컬 dev + 스테이징 DB)
//
// 고정하는 것:
//  1부(소스) 프리셋 잔재가 없다 — 전역 문자열 치환(applyPresetPairs)·_presets 읽기·presetType 인자
//  2부(DB)   유형별 문구가 라이브러리 항목으로 살아 있다(142) · ⭐기본은 건드리지 않았다
//  3부(화면) 3.4 비화재보·대피방법이 **고객이 고칠 수 있는 칸**이 됐다 — 종전엔 템플릿 하드코딩이었다
//  4부(생성) 입력한 문구가 실제 생성물(HTML)에 들어가고, 비우면 양식 기본값이 그대로 나온다
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { readFileSync } from 'node:fs'

const EMAIL = 'preset-library-e2e@erp-test.com'
let userId = '', custId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const code = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

console.log('— 1부 프리셋 잔재 제거(소스)')
{
  const tpl = code('lib/fire-plan-template.ts')
  const gen = code('lib/fire-plan-generate.ts')
  const act = code('app/(dashboard)/fire-plans/generate/actions.ts')
  const pre = code('lib/fire-plan-presets.ts')

  // 폐지 핵심 — 완성 HTML에 find→value를 문서 전역 치환하던 함수
  check('applyPresetPairs 함수가 없다', !/export function applyPresetPairs/.test(tpl))
  check('생성 경로가 치환을 부르지 않는다', !/applyPresetPairs\(/.test(gen))
  check('_presets 파일을 읽지 않는다', !/_presets/.test(gen))
  check('조립에 presetType 인자가 없다', !/presetType/.test(gen))
  check('프리셋 조회·저장 액션이 없다', !/getFirePlanPresetsAction|saveFirePlanPresetAction/.test(act))
  check('프리셋 문구 자료구조가 없다', !/ANCHORS|DEFAULT_PRESETS|PRESET_FILE_KEYS/.test(pre))
  // 유형 분류는 남는다 — 1.11.1 ★ 표시·1.5 용도 기본값 버튼이 문구와 무관하게 쓴다
  check('건물 유형 분류는 유지된다', /recommendPresetType/.test(pre) && /PRESET_TYPES/.test(pre))

  const sec = code('lib/plan-text-sections.ts')
  check('3.4 섹션에 비화재보·대피방법 칸이 생겼다',
    /key: 'falseAlarm'/.test(sec) && /key: 'evacMethod'/.test(sec))
}

console.log('— 2부 유형별 문구 이관(DB · 마이그레이션 142)')
{
  const { data } = await raw.from('plan_text_library')
    .select('section_key, title, body, is_default, is_active')
  const rows = (data ?? []) as Array<{ section_key: string; title: string; body: Record<string, unknown>; is_default: boolean; is_active: boolean }>
  const find = (t: string) => rows.find(r => r.title === t)

  for (const t of ['상가형 훈련 시나리오', '공장형 훈련 시나리오', '상가형 피난유도', '공장형 피난유도']) {
    check(`이관됨 — ${t}`, !!find(t), '없음')
  }
  const retail = find('상가형 피난유도')
  check('상가형 비화재보 문구가 종전 프리셋 값 그대로',
    String(retail?.body?.falseAlarm ?? '').includes('건물 앞 주차장 대기 후 오동작 각 매장 전파'),
    String(retail?.body?.falseAlarm ?? ''))
  check('상가형 대피방법 문구도 그대로',
    String(retail?.body?.evacMethod ?? '').includes('1층 주 출입구로 대피'),
    String(retail?.body?.evacMethod ?? ''))

  // ⭐기본을 옮기면 신규 고객 문서 내용이 조용히 달라진다 — 선택은 사람이 한다
  check('이관 항목은 ⭐기본으로 지정되지 않았다',
    ['상가형 훈련 시나리오', '공장형 훈련 시나리오', '상가형 피난유도', '공장형 피난유도']
      .every(t => find(t)?.is_default === false))
  check('섹션당 활성 ⭐기본은 최대 1개(제약 유지)',
    Object.values(rows.filter(r => r.is_active && r.is_default)
      .reduce((a: Record<string, number>, r) => ({ ...a, [r.section_key]: (a[r.section_key] ?? 0) + 1 }), {}))
      .every(n => n <= 1))
}

try {
  console.log('— 3부 3.4 두 칸이 고객 입력칸이 됐는가(화면)')
  userId = await mkUser({ email: EMAIL, name: '프리셋이관E2E', employeeId: 'E2E-PTL' })
  custId = await mkCustomer({ customer_name: `ZZ프리셋이관${Math.random().toString(36).slice(2, 6)}`, created_by: userId })

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers/${custId}?tab=plan&form=ch3`)
  await page.waitForLoadState('networkidle')

  const falseAlarm = page.getByPlaceholder(/비워 두면 양식 기본값이 인쇄됩니다 — 예: 피난 실시/)
  const evacMethod = page.getByPlaceholder(/비워 두면 양식 기본값이 인쇄됩니다 — 예: 2층 화재/)
  const shown = await falseAlarm.count() > 0 && await evacMethod.count() > 0
  check('3.4에 비화재보·대피방법 입력칸이 있다', shown)
  if (!shown) await page.screenshot({ path: 'scripts/_shots/preset-library-ch3.png', fullPage: true })

  if (shown) {
    const MARK = `ZZ검증문구${Math.random().toString(36).slice(2, 6)}`
    await falseAlarm.fill(`${MARK} 비화재보`)
    await evacMethod.fill(`${MARK} 대피방법`)
    await page.waitForTimeout(500)
    // 3장 저장 — 화면의 저장 버튼(섹션 공용)
    const saveBtn = page.getByRole('button', { name: /저장/ }).first()
    await saveBtn.click()
    await page.waitForTimeout(3000)

    const { data: fp } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', custId).maybeSingle()
    const ev = ((fp as { sections?: Record<string, Record<string, unknown>> } | null)?.sections?.evacPlan ?? {}) as Record<string, unknown>
    check('★ 입력한 비화재보가 DB에 저장된다', String(ev.falseAlarm ?? '').includes(MARK), String(ev.falseAlarm ?? ''))
    check('★ 입력한 대피방법이 DB에 저장된다', String(ev.evacMethod ?? '').includes(MARK), String(ev.evacMethod ?? ''))

    console.log('— 4부 생성물에 반영되는가')
    // 즉석 미리보기(파일 미생성) — 생성 경로와 같은 조립·템플릿을 탄다
    await page.goto(`${BASE}/customers/${custId}?tab=plan&form=archive`)
    await page.waitForLoadState('networkidle')
    const previewBtn = page.getByRole('button', { name: /현재 내용/ }).first()
    if (await previewBtn.count() > 0) {
      await previewBtn.click()
      await page.waitForTimeout(6000)
      const body = await page.content()
      check('★ 입력 문구가 생성물에 실린다', body.includes(MARK), '미리보기에서 못 찾음')
      check('종전 하드코딩 문구는 사라졌다(고객 입력이 우선)',
        !body.includes('피난 실시 및 1층 주차장 대기 후 오동작 각 세대 전파'))
    } else {
      check('미리보기 버튼 노출', false, '[현재 내용] 버튼 못 찾음')
    }
  }
} finally {
  if (browser) await browser.close()
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
