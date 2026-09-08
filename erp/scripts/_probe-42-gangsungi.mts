/** 소방계획서_42 S7-3 — 🎯 강순기 대조(핵심 판정축).
 *
 *  `강순기건물 소방계획서`는 실제 납품된 **완성본**이다. F-1로 이 문서와 법정 양식 hwpx가
 *  표 95개·치수까지 일치함이 확인됐으므로, 강순기는 구조 대안이 아니라 **'그 틀을 어떻게
 *  채우는가'의 정답지**다. 우리 엑셀의 라벨(양식 고정 문구)이 이것과 같아지면 성공이다.
 *
 *  대조 축 셋 — 하나라도 빼면 '대충 비슷하다'가 된다:
 *   ① 구조: 표 수·표별 치수·표별 셀 수가 강순기 == 양식hwpx == 우리 시트
 *   ② 라벨: 우리 시트의 리터럴 == 강순기의 같은 칸 (**100% 일치를 요구**)
 *   ③ 차이 분류: 남는 차이가 전부 '고객의 답'인가(값·체크). 설명 안 되는 것은 전건 목록화
 *
 *  🚨 산출물을 저장소에 커밋하지 않는다 — 강순기 문서는 통째로 실고객 문서다(R-2).
 *     그래서 보고서는 %TEMP% 에 쓴다.
 *
 *  실행: npx tsx scripts/_probe-42-gangsungi.mts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { parseTables } from '../src/lib/hwpx-table.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_SCRUB_RULES } from '../src/lib/fire-plan-scrub.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset, TAG } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const REPORT = join(tmpdir(), '_42-gangsungi-대조.txt')

let pass = 0, fail = 0
const R: string[] = []
const say = (s: string) => { R.push(s) }
const check = (l: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log(`  ok   ${l}${d ? ' — ' + d : ''}`) }
  else { fail++; console.log(`  FAIL ${l}${d ? ' — ' + d : ''}`) }
  say(`${ok ? 'ok  ' : 'FAIL'} ${l}${d ? ' — ' + d : ''}`)
}

if (!existsSync(HWP)) { console.log(`강순기 원본이 없다: ${HWP}`); process.exit(1) }

/* ══════════════════ [1] 강순기 읽기 + 좌표 보정 ══════════════════ */
console.log('\n[1] 강순기 HWP5 읽기')
const { bytes, compressed } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
check('Section0 해제', bytes.length > 0, `${bytes.length} bytes · 압축=${compressed}`)
check('레코드가 0이 아니다(눈멂 가드)', records.length > 100, `${records.length}개`)

// 양식 hwpx = 좌표의 정답지(hp:cellAddr가 명시돼 있다)
const zip = await JSZip.loadAsync(readFileSync(HWPX))
const formTables = parseTables(await zip.file('Contents/section0.xml')!.async('string'))
const truth = formTables.map(t => t.cells.map(c => ({ row: c.row, col: c.col })))

const cal = calibrateCellOffset(records, truth)
check('셀 좌표 오프셋 보정 성공', cal !== null, cal ? `offset=${cal.offset} 일치율=${(cal.hitRate * 100).toFixed(1)}%` : '후보 전건 95% 미만 — 좌표 대조 불가')
const tables = extractTables(records, cal?.offset ?? 8)

/* ══════════════════ [2] 축① 구조 ══════════════════ */
console.log('\n[2] 축① 구조 — 강순기 == 양식 hwpx')
check('표 수 일치', tables.length === formTables.length, `강순기 ${tables.length} vs 양식 ${formTables.length}`)
{
  const n = Math.min(tables.length, formTables.length)
  const dimBad: string[] = []
  const cellBad: string[] = []
  for (let i = 0; i < n; i++) {
    if (tables[i].rowCnt !== formTables[i].rowCnt || tables[i].colCnt !== formTables[i].colCnt) {
      dimBad.push(`#${i} 강순기 ${tables[i].rowCnt}x${tables[i].colCnt} vs 양식 ${formTables[i].rowCnt}x${formTables[i].colCnt}`)
    }
    if (tables[i].cells.length !== formTables[i].cells.length) {
      cellBad.push(`#${i} 셀 ${tables[i].cells.length} vs ${formTables[i].cells.length}`)
    }
  }
  check('표별 치수 95/95 일치(F-1 재확인)', dimBad.length === 0, dimBad.slice(0, 4).join(' · '))
  check('표별 셀 수 일치(순서 정렬의 전제)', cellBad.length === 0, cellBad.slice(0, 4).join(' · '))
}

/* ══════════════════ [3] 축② 라벨 대조 ══════════════════ */
console.log('\n[3] 축② 라벨 — 우리 시트의 리터럴이 강순기와 같은가')

const wb = XLSX.read(readFileSync(XLSX_PATH), { cellStyles: false })
const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[ ]/g, ' ').trim()
/** 상자·체크 글자를 지운 '자구' — 체크 여부는 고객의 답이라 라벨 대조에서 뺀다 */
const words = (s: string) => norm(s).replace(/[□☐■☑▣]/g, '').replace(/\[\s*[√✓✔ ]?\s*\]/g, '').replace(/\s+/g, ' ').trim()
/** 강순기에서 스크럽 대상(표본 실명·기관)을 지운다 — 우리 템플릿은 이미 지워져 있다 */
const scrubbed = (s: string) => {
  let out = s
  for (const r of FIRE_PLAN_SCRUB_RULES) { r.strip.lastIndex = 0; out = out.replace(r.strip, '') }
  return out
}

interface Diff { sheet: string; ref: string; table: number; ours: string; theirs: string; kind: string }
const diffs: Diff[] = []
let compared = 0, same = 0

for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const ws = wb.Sheets[s.name]
  if (!ws) continue
  /* 🚨 격자의 시트 내 위치를 **추측하지 않는다** — manifest의 `gridTops`가 사실을 들고 있다.
   *
   *  종전에는 ①격자 = rowCnt>1인 표 ②시작 행 = 배너 수 로 추론했는데, 2단계에서 둘 다 깨졌다:
   *   · 서식 2.3의 머리 블록(#50 3x2 · #52 2x1)은 **여러 행짜리 배너**라 격자로 오인된다.
   *   · 2.4 개별임무카드는 한 시트에 격자 6개가 **세로로 쌓여** 시작 행이 저마다 다르다.
   *  실제로 추론판은 카드 6장을 전부 첫 장 자리로 읽어 **멀쩡한 서식을 자구 불일치 26건으로
   *  신고**했다. 대조기가 틀리면 제품이 옳아도 붉어진다. */
  for (const gt of s.gridTops) {
    const ti = gt.table
    const ours = formTables[ti]
    const theirs = tables[ti]
    if (!ours || !theirs) continue
    for (let k = 0; k < Math.min(ours.cells.length, theirs.cells.length); k++) {
      const oc = ours.cells[k]
      const ref = XLSX.utils.encode_cell({ r: gt.top + oc.row, c: oc.col })
      const ourText = String((ws[ref] as XLSX.CellObject | undefined)?.v ?? '')
      const theirText = scrubbed(theirs.cells[k].text)
      const a = words(ourText), b = words(theirText)
      if (!a && !b) continue
      compared++
      if (a === b) { same++; continue }
      // 분류 — 남는 차이가 '고객의 답'으로 설명되는가.
      // ⚠ 아래 두 갈래는 **내 분류기가 틀렸던 자리**다(1차 실행에서 멀쩡한 칸 2개를 '자구
      //   불일치'로 신고했다). 느슨하게 푸는 게 아니라, 각각이 왜 정상인지를 식으로 적는다.
      const noSpace = (x: string) => x.replace(/\s/g, '')
      //   ① 줄바꿈만 다르다 — 원본 두 문서의 문단 나눔이 다를 뿐 자구는 같다
      //      (예: 우리 '훈련내용(기대행동)' vs 강순기 '훈련내용\n(기대행동)')
      const lineBreakOnly = noSpace(a) === noSpace(b)
      //   ② 틀 칸 — 우리는 `년 월` 빈 틀이고 강순기는 거기에 숫자를 채웠다. **우리가 옳다**:
      //      템플릿은 공란이어야 한다. 강순기에서 숫자를 지웠을 때 우리와 같아지면 이 갈래다.
      const frameFilled = !/\d/.test(a) && /\d/.test(b)
        && noSpace(b.replace(/[\d]/g, '')) === noSpace(a)
      //   ③ 🎯 **우리가 규칙으로 걷어낸 표본 답**(2026-09-08). 빌드의 fill-in 규칙이 이 칸의
      //      숫자·자유 텍스트를 지웠고 manifest가 그 사실을 `fillInStripped`에 적어 두었다.
      //      ⭐ 여기서 강순기는 **반대편 증인**이다 — 같은 칸에 고객의 답이 실제로 들어 있으니
      //        '그 자리는 답을 적는 칸'이라는 규칙의 판정이 독립적으로 확인된다. 아래 [3b]가
      //        방향(강순기 ⊋ 우리)까지 단언하므로 이 갈래는 봐주기가 아니라 **검증**이다.
      const stripped = !!s.fillInStripped?.[ref]
      const kind =
        !a && b ? '강순기에만(고객이 채운 값)'
        : a && !b ? '우리에만(양식 자구·강순기가 비운 칸)'
        : stripped ? '걷어낸 표본 답(규칙 축 · 강순기가 증언)'
        : lineBreakOnly ? '줄바꿈만 다름(자구 동일)'
        : frameFilled ? '틀 칸(우리 공란·강순기 기입 — 정상)'
        : b.includes(a) || a.includes(b) ? '부분포함(값이 라벨에 덧붙음)'
        : '자구 불일치'
      if (kind === '자구 불일치') diffs.push({ sheet: s.name, ref, table: ti, ours: ourText, theirs: theirText, kind })
      else diffs.push({ sheet: s.name, ref, table: ti, ours: ourText, theirs: theirText, kind })
    }
  }
}

check('대조한 칸이 0이 아니다(눈멂 가드)', compared >= 500, `${compared}칸`)
const byKind = new Map<string, number>()
for (const d of diffs) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1)
say('\n── 차이 분류 ──')
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) { console.log(`       ${k}: ${n}`); say(`  ${k}: ${n}`) }
console.log(`       완전 일치: ${same}/${compared} (${(same / compared * 100).toFixed(1)}%)`)
say(`  완전 일치: ${same}/${compared}`)

const wording = diffs.filter(d => d.kind === '자구 불일치')
check('🎯 자구 불일치 0건 (법정 문구가 갈라지지 않았다)', wording.length === 0, `${wording.length}건`)

/* ══════ [3b] 걷어낸 표본 답 — 방향 단언 ══════
 *  분류만 해 두면 '봐주기'가 된다. 이 갈래가 **검증**이 되려면 방향이 서야 한다:
 *  같은 칸에서 강순기는 답을 이고 있고 우리는 그것을 비웠는가. 반대라면(우리가 더 많다면)
 *  규칙이 엉뚱한 칸을 건드린 것이므로 붉어져야 한다. */
{
  const st = diffs.filter(d => d.kind.startsWith('걷어낸 표본 답'))
  // 🚨 정체 판정 — 0건이면 '깨끗'이 아니라 대조가 이 축을 잃은 것이다.
  // ⭐ 실측 **6/6** — 규칙이 걷어낸 여섯 칸을 강순기가 하나도 빠짐없이 증언했다. 그중 넷은
  //   종전 분류에서 '부분포함·틀 칸'으로 흡수돼 조용히 지나가고 있었다(대조는 그 칸을 보고도
  //   답이라 부르지 못했다). 규칙 축과 대조 축이 **서로를 확인**한 자리다.
  check('걷어낸 표본 답을 강순기가 증언한다(정체 판정)', st.length === 6,
    st.map(d => `${d.sheet}!${d.ref}`).join(' · '))
  const wrongWay = st.filter(d => d.theirs.replace(/\s/g, '').length <= d.ours.replace(/\s/g, '').length)
  check('방향이 맞다 — 강순기에 답이 있고 우리는 비었다', wrongWay.length === 0,
    wrongWay.map(d => `${d.sheet}!${d.ref}`).join(' · '))
  for (const d of st) say(`  걷어냄 ${d.sheet}!${d.ref}\n      우리 : ${JSON.stringify(d.ours)}\n      강순기: ${JSON.stringify(d.theirs)}`)
}

say('\n── 자구 불일치 전건 ──')
for (const d of wording) say(`  ${d.sheet}!${d.ref} (표#${d.table})\n      우리 : ${JSON.stringify(d.ours)}\n      강순기: ${JSON.stringify(d.theirs)}`)
for (const d of wording.slice(0, 12)) {
  console.log(`       ${d.sheet}!${d.ref}\n         우리 : ${JSON.stringify(d.ours.slice(0, 60))}\n         강순기: ${JSON.stringify(d.theirs.slice(0, 60))}`)
}

say('\n── 우리에만 있는 칸(양식 자구 · 강순기가 비운 칸) 표본 ──')
for (const d of diffs.filter(x => x.kind.startsWith('우리에만')).slice(0, 40)) say(`  ${d.sheet}!${d.ref}  ${JSON.stringify(d.ours.slice(0, 50))}`)

/* ══════════════════ [4] 체크 축 — 우리는 비었고 강순기는 답이 있는가 ══════════════════ */
console.log('\n[4] 체크 축 — 표본의 답이 우리 템플릿에 넘어오지 않았는가')
{
  let theirChecked = 0, oursChecked = 0
  for (const t of tables) for (const c of t.cells) if (/■/.test(c.text)) theirChecked++
  for (const s of FIRE_PLAN_MANIFEST.sheets) {
    const ws = wb.Sheets[s.name]
    if (!ws) continue
    const bullets = new Set(Object.keys(s.bulletCells))
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!') || bullets.has(k)) continue
      if (/■/.test(String((ws[k] as XLSX.CellObject).v ?? ''))) oursChecked++
    }
  }
  check('강순기에는 체크된 답이 있다(분모 확인)', theirChecked > 20, `${theirChecked}칸`)
  check('우리 템플릿은 0칸(불릿 제외)', oursChecked === 0, `${oursChecked}칸`)
}

writeFileSync(REPORT, R.join('\n'), 'utf8')
console.log(`\n       📄 전건 보고서(저장소 밖): ${REPORT}`)
console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
