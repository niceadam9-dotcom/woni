/** 육안 — 자동 문구 행의 일자 칸이 실제로 어떻게 인쇄되나 (소방계획서_43 Q-5)
 *
 *  Q-5는 **인쇄물을 바꾼** 변경이다(자리표 `.  .  .  ~  .  .  .` → `—`). 단언은 그린이지만
 *  '보기에 어떤가'는 문자열 검사로 알 수 없다 — 문구 행과 패딩 행이 **한 표 안에 나란히** 서는
 *  모양이 어색하지 않은지, 「해당없음」 옆의 `—`가 빈칸처럼 보이지 않는지가 판정 대상이다.
 *
 *  Gotenberg 없이 본다: 렌더 HTML을 그대로 Chromium에 물려 표만 잘라 찍는다(인쇄 CSS 적용).
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-visual-note.mts
 *  산출: scripts/_out-43-visual/*.png */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { renderReport10, renderReport11, type Annex1011Data, type AnnexPlanRow } from '../src/lib/doc-templates/report1011.ts'
import { DEFECT_GROUPS, DEFECT_FOLD_TEXT } from '../src/lib/doc-templates/report9.ts'

const OUT = 'scripts/_out-43-visual'
mkdirSync(OUT, { recursive: true })

const base: Annex1011Data = {
  customerName: '서림사', purpose: '문화및집회시설', address: '경기 양평군 강상면 가레밭골길 40',
  ownerName: '홍길동2', ownerPhone: '010-1234-3432', mgrName: '홍길동2', mgrPhone: '010-1234-3432',
  rows: [], reportDate: '2026년 9월 8일', submitTo: '양평소방서장',
}

// 11호 — ①실이행조치 1건 + ③문구 행이 섞이지 않는 두 케이스를 각각 본다
const cases: Array<[string, string]> = [
  ['11호-A-실조치2건+패딩2행', renderReport11({
    ...base,
    rows: [
      { content: '소화기 압력미달 교체', period: '2026년 8월 19일' },
      { content: '유도등 안정기 교체', period: '2026년 8월 26일' },
    ],
  })],
  ['11호-B-해당없음문구', renderReport11({
    ...base, rows: [{ content: DEFECT_FOLD_TEXT.na, period: '', isNote: true }],
  })],
  ['11호-C-이상없음문구', renderReport11({
    ...base, rows: [{ content: DEFECT_FOLD_TEXT.ok, period: '', isNote: true }],
  })],
]

// 10호 7행 — 실기간 행과 문구 행이 **한 표 안에 나란히** 서는 모양(여기가 진짜 판정 자리)
const planRows: AnnexPlanRow[] = DEFECT_GROUPS.map((group, i) => {
  if (i === 0) return { group, content: '소화기 압력미달 교체', period: '2026년 8월 18일 ~ 2026년 8월 20일', days: '3' }
  if (i === 1) return { group, content: DEFECT_FOLD_TEXT.refer, period: '', days: '', isNote: true }
  if (i === 2) return { group, content: DEFECT_FOLD_TEXT.ok, period: '', days: '', isNote: true }
  return { group, content: DEFECT_FOLD_TEXT.na, period: '', days: '', isNote: true }
})
cases.push(['10호-혼재-실기간1행+문구6행', renderReport10({
  ...base, planRows, totalPeriod: '2026년 8월 18일 ~ 2026년 8월 20일', totalDays: '3',
})])

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 })
for (const [name, html] of cases) {
  writeFileSync(`${OUT}/${name}.html`, html, 'utf8')
  await page.setContent(html, { waitUntil: 'load' })
  await page.emulateMedia({ media: 'print' })   // 인쇄 CSS로 본다 — 화면 CSS는 다른 답을 준다
  // ⚠ '마지막 table.form'을 잡으면 **유의사항 표**가 걸린다(처음에 그렇게 찍었다).
  //   판정 대상은 「이행조치 일자」 헤더를 가진 표다 — 내용으로 지목한다.
  const tables = await page.$$('table.form')
  let target = null
  for (const t of tables) if ((await t.innerText()).includes('이행조치 일자')) target = t
  if (!target) { console.log(`── ${name}: 이행조치 표를 못 찾음`); continue }
  await target.screenshot({ path: `${OUT}/${name}.png` })
  const txt = (await target.innerText()).replace(/\n+/g, ' | ')
  console.log(`── ${name}\n   ${txt.slice(0, 300)}`)
}
await browser.close()
console.log(`\n산출: ${OUT}/*.png (${cases.length}장)`)
