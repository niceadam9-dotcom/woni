/** 별지 9호 3쪽 = 별지 4호 1·2쪽 공용 3열 표(p3Table) 레이아웃 회귀 프로브. 읽기 전용(DB·파일 무변경).
 *
 *  실제 렌더 HTML을 Chromium(=Gotenberg와 같은 엔진)에 print 미디어로 올려 **픽셀로** 판정한다:
 *   L-1 좌·우 표의 **바닥선이 같은 y** — 가운데 괘선이 한쪽만 짧게 끊기지 않음
 *   L-2 남는 높이는 '비고' 행이 흡수 — 비고 행 높이 > 일반 행 높이
 *   L-3 머리글 '점검결과'가 **한 줄**(줄바꿈 없음)
 *   L-4 '점검결과' 글자폭에 여유 — 폰트가 바뀌어도(Gotenberg=Noto Serif CJK KR / 미리보기=시스템 명조) 안 접힘
 *  CSS가 report9.ts·report4.ts에 **각각** 있어 한쪽만 고치면 드리프트 → 양쪽 문서를 다 검사한다.
 *  스크린샷: scripts/_out/form3-layout-{r9,r4}.png (육안 확인용)
 *
 *  실행: npx tsx scripts/_probe-form3-layout.mts */
import { mkdirSync } from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import r9mod from '../src/lib/doc-templates/report9.ts'
import r4mod from '../src/lib/doc-templates/report4.ts'

const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// 최소 데이터 — 3열 표만 보므로 나머지는 공란 서식 그대로
const DATA = {
  facilityChecks: ['옥내소화전설비', '스프링클러설비', '할론소화설비', '화재알림설비'],
  resultMarks: { 옥내소화전설비: 'X', 스프링클러설비: 'O', 할론소화설비: 'O', 화재알림설비: 'O' },
  muResults: { 'MU-001': 'O', 'MU-012': 'X' },
  assistants: [], defectRows: [], multiUseCounts: {}, sheetItems: [],
}
const HTML = {
  '별지 9호 3쪽': { html: renderReport9(DATA as never), page: 2 },
  '별지 4호 1쪽': { html: renderReport4(DATA as never), page: 0 },
  '별지 4호 2쪽': { html: renderReport4(DATA as never), page: 1 },
}

/** 높이 채움(.fill)을 끈 '자연 높이'와 켠 높이를 둘 다 재서, 늘어난 양이 정확히 비고 행에만
 *  들어갔는지 대조한다. 높이차가 0인 절(비고 쪽이 이미 더 긴 경우)에서도 증가 0으로 성립 —
 *  조건부 단언이 아니라 양방향 등식이다.
 *  tsx(esbuild) keepNames가 __name을 주입해 함수 전달이 깨진다 → 문자열로 평가 */
const MEASURE = (pageIdx: number, noFill: boolean) => `(() => {
  const old = document.getElementById('nofill'); if (old) old.remove()
  if (${noFill}) {
    const st = document.createElement('style'); st.id = 'nofill'
    st.textContent = 'table.form.fill{height:auto !important}'
    document.head.appendChild(st)
  }
  const p = document.querySelectorAll('div.page')[${pageIdx}]
  return Array.from(p.querySelectorAll('table.split')).map(s => {
    const [l, r] = Array.from(s.querySelectorAll(':scope > tbody > tr > td > table'))
    const noteRow = Array.from(s.querySelectorAll('tr')).find(
      tr => tr.firstElementChild && tr.firstElementChild.textContent.trim() === '비고')
    const noteTable = noteRow.closest('table')
    const th = Array.from(s.querySelectorAll('th')).find(
      t => t.textContent.replace(/\\s/g, '') === '점검결과')
    const cs = getComputedStyle(th)
    const range = document.createRange(); range.selectNodeContents(th)
    return {
      left: l.getBoundingClientRect().bottom, right: r.getBoundingClientRect().bottom,
      noteSide: noteTable === l ? 'left' : 'right',
      noteH: noteRow.getBoundingClientRect().height,
      plainH: noteRow.previousElementSibling.getBoundingClientRect().height,
      thLines: range.getClientRects().length,
      thAvail: th.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      thText: range.getBoundingClientRect().width,
    }
  })
})()`

type M = {
  left: number; right: number; noteSide: 'left' | 'right'; noteH: number; plainH: number
  thLines: number; thAvail: number; thText: number
}

const px = (n: number) => `${n.toFixed(1)}px`
const outDir = path.join(import.meta.dirname, '_out')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.emulateMedia({ media: 'print' })

for (const [label, { html, page: pageIdx }] of Object.entries(HTML)) {
  console.log(`=== ${label}`)
  await page.setContent(html, { waitUntil: 'load' })
  const nat = await page.evaluate(MEASURE(pageIdx, true)) as M[]
  const rows = await page.evaluate(MEASURE(pageIdx, false)) as M[]
  check(`${label} — 3열 표 존재`, rows.length > 0, `${rows.length}절`)
  rows.forEach((m, i) => {
    const n = nat[i], tag = `${label} ${i + 1}절`
    // 비고 쪽이 채우기 전에 얼마나 짧았나 = 비고 행이 흡수해야 할 양
    const gap = Math.max(0, (n.noteSide === 'left' ? n.right : n.left) - (n.noteSide === 'left' ? n.left : n.right))
    check(`L-1 ${tag} 좌·우 바닥 동일`, Math.abs(m.left - m.right) < 1,
      `좌 ${px(m.left)} / 우 ${px(m.right)}`)
    check(`L-2 ${tag} 높이차 전량을 비고 행이 흡수`, Math.abs((m.noteH - n.noteH) - gap) < 1,
      `비고 ${px(n.noteH)}→${px(m.noteH)} (+${px(m.noteH - n.noteH)}), 높이차 ${px(gap)}`)
    check(`L-2b ${tag} 비고 위 행은 자연 높이 유지`, Math.abs(m.plainH - n.plainH) < 1,
      `${px(n.plainH)}→${px(m.plainH)}`)
    check(`L-3 ${tag} 점검결과 한 줄`, m.thLines === 1, `${m.thLines}줄`)
    check(`L-4 ${tag} 점검결과 글자폭 여유 ≥2px`, m.thAvail - m.thText >= 2,
      `가용 ${px(m.thAvail)} - 글자 ${px(m.thText)} = ${px(m.thAvail - m.thText)}`)
  })
  const shot = path.join(outDir, `form3-layout-${label.replace(/\s/g, '')}.png`)
  await page.locator('div.page').nth(pageIdx).screenshot({ path: shot })
  console.log(`  스크린샷: ${shot}`)
}
await browser.close()

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
