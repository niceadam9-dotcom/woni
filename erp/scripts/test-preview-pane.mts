// 별지 실시간 미리보기 칸 — 높이 채움 + [크게 보기] 오버레이 회귀
// 실행: npx tsx scripts/test-preview-pane.mts   (로컬 dev + 스테이징 DB)
//
// 종전 결함(2026-08-18 실측): Pane 본문이 높이 제약을 물려주지 않아 AnnexPreview의 h-full이 auto로
// 풀렸고, iframe이 min-h(224px)에 갇혀 칸 594px 중 322px이 죽은 공간이었다. A4 문서는 872px을
// 요구하므로 27%만 보이고 나머지는 내부 스크롤이었다. 이 스위트가 그 회귀를 고정한다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'preview-pane-e2e@erp-test.com'
let userId = '', custId = '', inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
const STEP_DEFS = [
  { step_num: 1, name_ko: '점검일', days: 0 },
  { step_num: 2, name_ko: '배치확인서 보고서 작성', days: 7 },
  { step_num: 3, name_ko: '관계인 보고서 제출', days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록', days: 21 },
  { step_num: 5, name_ko: '소방보수 완료', days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출', days: 35 },
]

try {
  userId = await mkUser({ email: EMAIL, name: '미리보기E2E', employeeId: 'E2E-PVW' })
  custId = await mkCustomer({ customer_name: '미리보기칸E2E고객', created_by: userId })
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: custId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  await raw.from('fire_facilities').insert({
    building_id: bld!.id, category: '소화설비', facility_code: '소화기구 및 자동소화장치', installed: true,
  })
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: kstShift(-8), status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id
  const { data: ex } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', inspId)
  if (!ex || ex.length === 0) {
    await raw.from('inspection_steps').insert(STEP_DEFS.map(d => {
      const dt = new Date(kstShift(-8) + 'T12:00:00'); dt.setDate(dt.getDate() + d.days)
      return { inspection_id: inspId, step_num: d.step_num, name_ko: d.name_ko, due_date: dt.toISOString().split('T')[0] }
    }))
  }
  // ⑤가 활성 단계가 되려면 불량이 있어야 한다(activeStepNums) — 컬럼명 주의: defect_name(item_name 아님)
  const { error: dErr } = await raw.from('inspection_defects').insert({
    inspection_id: inspId, defect_code: 'A-01', defect_name: '램프 미점등', severity: '보통',
    action_plan: '램프교체', action_start: kstShift(-1), action_end: kstShift(1),
  })
  if (dErr) throw new Error(`불량 생성 실패: ${dErr.message}`)

  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}?step=5`)
  await page.waitForLoadState('networkidle')
  await page.locator('iframe[title*="미리보기"]').waitFor({ state: 'visible', timeout: 25000 })
  await page.waitForTimeout(1500)

  // ── 1. 칸 높이를 실제로 다 쓰는가 ─────────────────────────────────────────
  console.log('— 1. 미리보기 칸 높이 채움')
  const m = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="workbench-panes"]') as HTMLElement | null
    const pane = [...(grid?.children ?? [])][2] as HTMLElement | undefined
    const iframe = document.querySelector('iframe[title*="미리보기"]') as HTMLIFrameElement | null
    if (!pane || !iframe) return null
    return {
      paneH: Math.round(pane.getBoundingClientRect().height),
      bodyH: Math.round((pane.querySelector(':scope > div') as HTMLElement).getBoundingClientRect().height),
      frameH: Math.round(iframe.getBoundingClientRect().height),
      needH: iframe.contentDocument?.documentElement.scrollHeight ?? -1,
    }
  })
  check('미리보기 칸·iframe을 측정할 수 있다', !!m)
  if (m) {
    const dead = m.paneH - m.bodyH
    check(`칸 높이(${m.paneH}) 대비 죽은 공간이 60px 미만 (실측 ${dead}px)`, dead < 60, `${dead}px`)
    // 회귀 지표: 종전 237px에 갇혀 있었다. 칸이 커지면 iframe도 따라 커져야 한다.
    check(`iframe이 min-h(224px)에 갇히지 않는다 (실측 ${m.frameH}px)`, m.frameH > 400, `${m.frameH}px`)
    check(`iframe이 칸 본문 높이의 90% 이상을 쓴다 (${m.frameH}/${m.bodyH})`,
      m.frameH >= m.bodyH * 0.9, `${m.frameH}/${m.bodyH}`)
    console.log(`   ℹ 한 화면 표시율 ${Math.round(m.frameH / m.needH * 100)}% (문서 요구 ${m.needH}px)`)
  }

  // ── 2. [크게 보기] — 스크롤 없이 한 장 ────────────────────────────────────
  console.log('— 2. [크게 보기] 오버레이')
  check('[크게 보기] 버튼이 있다', await page.locator('[data-testid="preview-zoom"]').count() > 0)
  await page.locator('[data-testid="preview-zoom"]').click()
  await page.locator('[data-testid="preview-zoom-overlay"]').waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(1200)
  const z = await page.evaluate(() => {
    const f = document.querySelector('[data-testid="preview-zoom-overlay"] iframe') as HTMLIFrameElement | null
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), needH: f.contentDocument?.documentElement.scrollHeight ?? -1 }
  })
  check('오버레이 안에 미리보기 iframe이 있다', !!z)
  if (z) {
    check(`오버레이 iframe이 칸보다 훨씬 크다 (${z.w}×${z.h})`, z.h > (m?.frameH ?? 0) * 1.4, `${z.h}px`)
    // 이 기능의 존재 이유 — 스크롤 없이 한 장이 다 보이는 것
    check(`문서 전체가 스크롤 없이 들어간다 (필요 ${z.needH} ≤ 확보 ${z.h})`, z.h >= z.needH, `${z.h} vs ${z.needH}`)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  check('ESC로 닫힌다', await page.locator('[data-testid="preview-zoom-overlay"]').count() === 0)
  check('닫은 뒤 body 스크롤 잠금이 풀린다',
    await page.evaluate(() => document.body.style.overflow !== 'hidden'))

  // ── 2-b. 폭 재배분 — 미리보기 칸이 다른 칸보다 넓고, 가로로 넘치지 않는다 ─────────
  console.log('— 2-b. ⑤ 3칸 폭 재배분')
  const w = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="workbench-panes"]') as HTMLElement
    const panes = [...grid.children] as HTMLElement[]
    return {
      w: panes.map(p => Math.round(p.getBoundingClientRect().width)),
      // 가로 넘침 — 4px은 반올림·스크롤바 잡음이라 여유를 준다(실측 기준선)
      ovf: panes.slice(0, 2).map(p => {
        let worst = 0
        for (const el of p.querySelectorAll<HTMLElement>('*')) worst = Math.max(worst, el.scrollWidth - el.clientWidth)
        return worst
      }),
    }
  })
  check(`미리보기 칸이 가장 넓다 (${w.w.join('/')})`, w.w[2] > w.w[0] && w.w[2] > w.w[1], w.w.join('/'))
  check(`이행계획 칸이 가로로 넘치지 않는다 (${w.ovf[0]}px)`, w.ovf[0] <= 12, `${w.ovf[0]}px`)
  check(`고유값 칸이 가로로 넘치지 않는다 (${w.ovf[1]}px)`, w.ovf[1] <= 12, `${w.ovf[1]}px`)

  // ── 3. ④ 9호 칸 — 고유값 + 미리보기가 같이 있어도 미리보기가 높이를 받는다 ──
  console.log('— 3. ④ 9호 칸(고유값 + 미리보기 동거)')
  await page.locator('[data-testid="workbench-stepbar"] [data-step="submit9"]').click()
  await page.locator('iframe[title*="미리보기"]').waitFor({ state: 'visible', timeout: 25000 })
  await page.waitForTimeout(1500)
  await page.locator('[data-annex-fields="report9"]').waitFor({ state: 'visible', timeout: 30000 })
  const m9 = await page.evaluate(() => {
    const f = document.querySelector('iframe[title*="미리보기"]') as HTMLIFrameElement | null
    return f ? Math.round(f.getBoundingClientRect().height) : -1
  })
  check(`④ 9호 미리보기도 min-h에 갇히지 않는다 (실측 ${m9}px)`, m9 > 260, `${m9}px`)
  // ⚠ 위 높이는 **고유값 칸을 지우면** 거저 얻어진다 — 그건 결함을 결함으로 바꾸는 것이다.
  //    9호 고유값 8칸(보고일·비고 + select 6)이 전부 살아 있고, 접힌 2열 안에서 실제로 닿을 수
  //    있는지(스크롤로 보이게 되는지)를 같은 자리에서 함께 고정한다.
  const f9 = await page.evaluate(() => {
    const box = document.querySelector('[data-annex-fields="report9"]') as HTMLElement | null
    if (!box) return null
    // DateInput은 달력 팝업용 히든 <input type="date">를 하나 더 그린다(aria-hidden) — 사람이 쓰는 칸만 센다.
    // mark2 체크쌍(실시/미실시)은 role=group 하나가 한 칸이다(annex-fields.tsx)
    const ctrls = [...box.querySelectorAll<HTMLElement>('input, select, textarea, [role="group"]')]
      .filter(c => c.getAttribute('aria-hidden') !== 'true')
    let worstOvf = 0
    for (const el of box.querySelectorAll<HTMLElement>('*')) worstOvf = Math.max(worstOvf, el.scrollWidth - el.clientWidth)
    return {
      n: ctrls.length,
      labels: ctrls.map(c => c.getAttribute('aria-label') ?? ''),
      // display:none·visibility:hidden로 숨겨 높이를 번 것이 아님을 확인
      hidden: ctrls.filter(c => c.offsetParent === null && getComputedStyle(c).position !== 'fixed').length,
      boxH: Math.round(box.getBoundingClientRect().height),
      ovf: worstOvf,
    }
  })
  check('④ 고유값 칸을 측정할 수 있다', !!f9)
  if (f9) {
    // annex-fields.tsx FIELD_DEFS.report9 = 8칸 (보고일·비고 + mark2 체크쌍 4 + select 2)
    check(`④ 9호 고유값 8칸이 전부 살아 있다 (실측 ${f9.n}칸)`, f9.n === 8, f9.labels.join('/'))
    check(`④ 고유값 칸이 숨겨져 높이를 번 것이 아니다 (숨김 ${f9.hidden}칸)`, f9.hidden === 0, `${f9.hidden}칸`)
    check(`④ 고유값 칸이 미리보기를 밀어내지 않는다 (실측 ${f9.boxH}px ≤ 200)`, f9.boxH <= 200, `${f9.boxH}px`)
    check(`④ 고유값 칸이 가로로 넘치지 않는다 (${f9.ovf}px)`, f9.ovf <= 12, `${f9.ovf}px`)
  }
} finally {
  if (browser) await browser.close()
  if (inspId) await raw.from('inspection_defects').delete().eq('inspection_id', inspId)
  await cleanupCustomer(custId)
  await delUser(userId)
}

summary()
