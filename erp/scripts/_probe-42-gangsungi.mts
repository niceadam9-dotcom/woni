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
  // 시트의 격자 표 = tables 배열의 마지막 것(배너는 1행짜리라 rowCnt로 가른다)
  const gridIdx = s.tables.filter(ti => formTables[ti]?.rowCnt > 1)
  for (const ti of gridIdx) {
    const ours = formTables[ti]
    const theirs = tables[ti]
    if (!theirs) continue
    // 배너 줄 수만큼 시트 행이 밀려 있다
    const bannerAbove = s.bannerRows.filter(r => r < (s.rows - ours.rowCnt)).length
    for (let k = 0; k < Math.min(ours.cells.length, theirs.cells.length); k++) {
      const oc = ours.cells[k]
      const ref = XLSX.utils.encode_cell({ r: bannerAbove + oc.row, c: oc.col })
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
      const kind =
        !a && b ? '강순기에만(고객이 채운 값)'
        : a && !b ? '우리에만(양식 자구·강순기가 비운 칸)'
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
