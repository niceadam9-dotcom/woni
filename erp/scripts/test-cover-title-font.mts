/** 표지 제목 글꼴 검사 — 「강순기건물 소방계획서와 같은 표지」의 유일한 자.
 *
 *  사용자 지시(2026-09-21): 표지 제목을 납품본 HWP와 같게. 그 HWP에서 직접 읽은 값이
 *  **HY헤드라인M / 32pt / 가운데**다(`_probe-hwp-cover-fmt.mjs`가 DocInfo의 CHAR_SHAPE·
 *  PARA_SHAPE를 풀어 찍었다). 근거와 맞바꿈은 `build-fire-plan-template.mts`의
 *  `COVER_TITLE_FONT` 주석에 있다.
 *
 *  ⭐ **양성과 음성을 짝으로** 묻는다. 「32pt 글꼴이 하나 있다」만 물으면 그게 표지 제목이
 *    아니라 엉뚱한 칸에 붙어도 초록이고, 반대로 그 글꼴이 **전 시트로 번져도** 초록이다.
 *    그래서 ① 표지 제목 칸이 그 글꼴을 쓰는가 ② 본문 글꼴 두 벌이 10pt 맑은 고딕 그대로인가
 *    ③ 제목 글꼴을 쓰는 칸이 **워크북을 통틀어 그 한 칸뿐인가** 를 함께 묻는다.
 *
 *  🚨 **여기서 재는 32pt는 「템플릿의 출발값」이지 사용자가 받는 크기가 아니다**(2026-09-21 개편).
 *    산출물에서는 라우트가 고객 이름 길이에 맞춰 이 칸을 **48~96pt로 키운다**
 *    (`lib/fire-plan-cover-title` — 고정 크기로는 짧은 이름을 키우면 긴 이름이 넘친다. 실측:
 *    종전 32pt에서 활성 309명 중 32명이 이미 넘쳐 제목이 잘린 채 나가고 있었다).
 *    그러니 이 검사가 초록이어도 «표지가 32pt로 나간다»는 뜻이 아니다 — 산출물 쪽 계약은
 *    `_probe-cover-title.mts`가 실제 생성 파일을 열어 따로 붙든다.
 *    여기가 지키는 것은 **글꼴 이름·정렬·유일성**이고, 런타임은 그 셋을 승계만 하고 바꾸지 않는다.
 *
 *  실행: npx tsx scripts/test-cover-title-font.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const FACE = 'HY헤드라인M'
const SIZE = '32'
/** 표지 제목이 앉는 칸 — 빌더가 배너를 0열에 싣고 A3:BH3로 병합한다 */
const TITLE_REF = 'A3'

let pass = 0
const fails: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✔ ${name}`) }
  else { fails.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const zip = await JSZip.loadAsync(readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx')))
const styles = await zip.file('xl/styles.xml')!.async('string')

/* ── 글꼴 표 ── */
const fontsXml = /<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)![1]
const fonts = fontsXml.match(/<font>[\s\S]*?<\/font>/g) ?? []
const sizeOf = (f: string) => /<sz val="([^"]+)"\/>/.exec(f)?.[1] ?? ''
const nameOf = (f: string) => /<name val="([^"]+)"\/>/.exec(f)?.[1] ?? ''

console.log(`① 글꼴 표 (${fonts.length}벌)`)
// 음성 — 본문 두 벌은 손대지 않았다. 여기가 흔들리면 «머리띠만 글자 크기가 다르다»가 재발한다.
check('fontId 0 = 맑은 고딕 10pt', nameOf(fonts[0]) === '맑은 고딕' && sizeOf(fonts[0]) === '10',
  `${nameOf(fonts[0])}/${sizeOf(fonts[0])}pt`)
check('fontId 1 = 맑은 고딕 10pt(흰 글씨)',
  nameOf(fonts[1]) === '맑은 고딕' && sizeOf(fonts[1]) === '10' && fonts[1].includes('FFFFFFFF'),
  `${nameOf(fonts[1])}/${sizeOf(fonts[1])}pt`)

const titleFontIds = fonts
  .map((f, i) => (nameOf(f) === FACE && sizeOf(f) === SIZE ? i : -1))
  .filter(i => i >= 0)
check(`제목 글꼴 ${FACE} ${SIZE}pt 이 정확히 한 벌`, titleFontIds.length === 1,
  `${titleFontIds.length}벌 (전체: ${fonts.map(f => `${nameOf(f)}/${sizeOf(f)}`).join(', ')})`)
const titleFontId = titleFontIds[0]

/* ── 그 글꼴을 쓰는 cellXfs ── */
const xfs = (/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1]
  .match(/<xf\b[\s\S]*?(?:\/>|<\/xf>)/g) ?? [])
const titleStyleIds = xfs
  .map((x, i) => (/ fontId="(\d+)"/.exec(x)?.[1] === String(titleFontId) ? i : -1))
  .filter(i => i >= 0)
console.log(`\n② 스타일 (cellXfs ${xfs.length})`)
check('제목 글꼴을 쓰는 스타일이 정확히 하나', titleStyleIds.length === 1, `${titleStyleIds.length}개`)
const titleStyle = titleStyleIds[0]
check('제목 스타일은 가운데 정렬', /horizontal="center"/.test(xfs[titleStyle] ?? ''),
  /horizontal="([^"]+)"/.exec(xfs[titleStyle] ?? '')?.[1] ?? '(없음)')

/* ── 시트 전수: 그 스타일이 붙은 칸 ── */
const wb = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const target = new Map<string, string>()
for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
const sheets = [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: `xl/${target.get(m[2])!.replace(/^\/?xl\//, '')}` }))

/* ⚠ 병합 칸이라 **한 칸이 아니다.** 빌더는 배너 스타일을 병합 범위의 60열 전부에 싣는다
 *   (`emitBanner` — 병합 블록이 고르게 그려지려면 구성 칸이 같은 스타일을 들어야 한다).
 *   「1칸」으로 물었더니 제품이 맞는데 붉었다. 그래서 **블록**으로 묻는다: 어느 시트·어느 행에
 *   앉았고, 그 행이 통째로 병합된 그 범위와 정확히 같은가. */
const hits: { sheet: string; ref: string }[] = []
let coverMerges: string[] = []
for (const sh of sheets) {
  const xml = await zip.file(sh.path)!.async('string')
  if (sh.name === '표지') coverMerges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)"/g)) {
    if (Number(m[2]) === titleStyle) hits.push({ sheet: sh.name, ref: m[1] })
  }
}
const TITLE_ROW = TITLE_REF.replace(/^[A-Z]+/, '')
const stray = hits.filter(h => h.sheet !== '표지' || !h.ref.endsWith(TITLE_ROW))
console.log(`\n③ 배선 (시트 ${sheets.length})`)
// 🎯 핵심 단언 — 개수가 아니라 **어디인가**. 「N칸」만 물으면 엉뚱한 시트로 옮겨도 초록이다.
check(`제목 글꼴은 표지 ${TITLE_ROW}행 밖으로 새지 않는다`, stray.length === 0,
  stray.slice(0, 6).map(h => `${h.sheet}!${h.ref}`).join(', '))
check(`그 행이 ${TITLE_REF} 로 시작하는 한 덩어리로 병합`,
  hits.some(h => h.ref === TITLE_REF)
  && coverMerges.includes(`${TITLE_REF}:${hits[hits.length - 1].ref}`),
  `칸 ${hits.length}개(${hits[0]?.ref}~${hits[hits.length - 1]?.ref}) · 병합 ${coverMerges.join(' ')}`)

/* ── 값 축: 그 칸이 실제로 제목 토큰을 받는 자리인가 ── */
const man = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/fire-plan-xlsx-manifest.json'), 'utf8'))
const cover = man.sheets.find((s: { name: string }) => s.name === '표지')
check(`표지!${TITLE_REF}가 제목 토큰 자리`,
  /소방계획서$/.test(cover?.tokenCells?.[TITLE_REF] ?? ''),
  JSON.stringify(cover?.tokenCells?.[TITLE_REF] ?? null))

console.log(`\n${fails.length ? '❌' : '✅'} ${pass}/${pass + fails.length}`)
if (fails.length) { console.log(fails.map(f => `   · ${f}`).join('\n')); process.exit(1) }
