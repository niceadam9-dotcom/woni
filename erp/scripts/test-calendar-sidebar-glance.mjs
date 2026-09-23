// 달력 단계 사이드바 「한눈에」 — 누른 단계가 스크롤 없이 보이는가 (2026-09-23 사용자 요청 image-15)
// 실행: node scripts/test-calendar-sidebar-glance.mjs   (dev 서버 localhost:3000 필요)
//
// 사용자: 「달력에서 6단계를 클릭했는데 스크롤바를 내려야만 보인다 · 입력하기 버튼도 너무 크다 ·
//         버튼 사이즈 동일하게 · 사이드바 한눈에 · 스크롤바를 내리지 않아도 되게 · 전체진행률 삭제해도 돼」
// 🚨 급소: ① **누른 그 단계**가 목록 안에 보이는가(화면 밖이면 사용자가 또 스크롤한다)
//         ② 기본 배율에서 목록 전체가 **스크롤 없이** 들어가는가 — 1920×937(사용자 모니터)
//         ③ 사이드바의 **모든 버튼이 같은 높이**인가(단계 입력·사유 완료·엑셀·입력)
//         ④ 큰 글자 배율에서 넘쳐도 ①은 지켜지는가(자동 스크롤이 안전판)
// 표본: 송학떡집 — image-10·15의 그 고객(6단계까지 있는 회차). 칩을 **달력에서 직접 누른다**.
import { BASE, raw, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const S = Date.now().toString(36); const EMAIL = `glance-${S}@test.local`
let uid = '', b = null
try {
  const { data: cust } = await raw.from('customers').select('id').eq('customer_name', '송학떡집').maybeSingle()
  const { data: steps } = await raw.from('inspection_steps').select('step_num, due_date, inspection_id, inspections!inner(customer_id)')
    .eq('inspections.customer_id', cust.id).eq('step_num', 6).not('due_date', 'is', null).order('due_date', { ascending: false }).limit(1)
  const s6 = steps?.[0]
  check('표본: 송학떡집 6단계(마감일 있음)', !!s6, JSON.stringify(steps))
  const month = s6.due_date.slice(0, 7)

  uid = await mkUser({ email: EMAIL, name: '한눈사이드바', employeeId: `E2E-GLN-${S}` })
  const l = await launch(); b = l.browser; const { page } = l; page.setDefaultTimeout(120000)
  await login(page, EMAIL)

  for (const [w, h] of [[1920, 937], [1536, 730]]) {
    for (const fs of ['', 'lg', 'xl', 'xxl']) {
      await page.setViewportSize({ width: w, height: h })
      // 그 달로 가서 **칩을 누른다**(사용자 동선 그대로) — 검색으로 이 고객만 남겨 칩이 「+N개 더 보기」에 숨지 않게
      // 🚨 배율은 **DB·쿠키로** 건다 — html[data-fs]를 직접 바꾸면 FontScaleSync가 정본(DB) 값으로 되돌려
      //   큰 배율 검사가 기본 배율을 네 번 재고 초록이 된다(2026-09-23 실제로 그랬다 — 캡처가 잡았다).
      await raw.from('profiles').update({ form_font_scale: fs || 'md' }).eq('id', uid)
      await page.context().addCookies([{ name: 'erp-fs', value: fs || 'md', url: BASE }])
      await page.goto(`${BASE}/inspections/calendar?cust=${encodeURIComponent('송학떡집')}`)
      // 달력은 월을 주소로 받지 않는다 — 탐색 줄(이전/다음)로 6단계 마감월까지 간다
      const now = new Date(Date.now() + 9 * 3600_000)
      const diff = (Number(month.slice(0, 4)) - now.getUTCFullYear()) * 12 + (Number(month.slice(5, 7)) - (now.getUTCMonth() + 1))
      for (let i = 0; i < Math.abs(diff); i++) await page.click(`[data-testid="cal-nav"] button[title="${diff > 0 ? '다음' : '이전'}"]`)
      const chip = page.locator('.rbc-event', { hasText: '6단계' }).first()
      await chip.waitFor({ timeout: 60000 })
      await chip.click()
      await page.waitForSelector('[data-testid="daypanel-steps"] [data-step-num="6"]')
      await page.waitForTimeout(400)
      const r = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="daypanel-steps"]')
        const s6 = box.querySelector('[data-step-num="6"]').getBoundingClientRect()
        const bx = box.getBoundingClientRect()
        const btns = [...document.querySelectorAll('[data-testid="daypanel-steps"] a, [data-testid="daypanel-steps"] button, [data-testid="daypanel-docs"] a, [data-testid="daypanel-docs"] > div > button')]
          .map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h > 0)
        return {
          visible: s6.top >= bx.top - 1 && s6.bottom <= bx.bottom + 1,
          focused: box.querySelector('[data-step-num="6"]').getAttribute('data-focused') === '1',
          overflow: box.scrollHeight - box.clientHeight,
          heights: [...new Set(btns)],
          progress: !!document.body.innerText.match(/전체 진행률/),
          scale: getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim(),
        }
      })
      const tag = `${w}×${h} ${fs || '기본'}`
      const want = { '': '1', lg: '1.15', xl: '1.3', xxl: '1.45' }[fs]
      check(`계측기: [${tag}] 배율이 실제로 걸렸다(--fs-scale=${want})`, r.scale === want, `실제 ${r.scale}`)
      check(`★ ① [${tag}] 누른 6단계가 스크롤 없이 목록 안에 보인다`, r.visible, JSON.stringify(r))
      check(`① [${tag}] 누른 단계를 테두리로 짚는다`, r.focused)
      check(`★ ③ [${tag}] 사이드바 버튼 높이가 전부 같다`, r.heights.length === 1, JSON.stringify(r.heights))
      if (w === 1920 && fs === '') {
        check('★ ② [1920×937 기본] 단계 목록 전체가 스크롤 없이 들어간다', r.overflow <= 1, `${r.overflow}px 넘침`)
        check('「전체 진행률」은 없다(사용자: 삭제해도 돼)', !r.progress)
        await page.screenshot({ path: 'scripts/_shots/glance-1920.png', clip: { x: 1540, y: 0, width: 380, height: 937 } })
      } else {
        console.log(`    (${tag} 목록 넘침 ${r.overflow}px — 넘쳐도 ①이 지켜지면 된다)`)
      }
      if (fs === 'xxl') await page.screenshot({ path: `scripts/_shots/glance-${w}-xxl.png`, clip: { x: w - 380, y: 0, width: 380, height: h } })
    }
  }
} catch (e) {
  check('예외 없이 끝났다', false, e instanceof Error ? e.stack : String(e))
} finally {
  await b?.close(); if (uid) await delUser(uid)
  summary()
}
