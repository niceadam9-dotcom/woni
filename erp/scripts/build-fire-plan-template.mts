/** 소방계획서 엑셀 템플릿 자산화 — 소방계획서_42 S3.
 *
 *  법정 양식 `erp_goal/_Data/양식-placeholder.hwpx`(ZIP+XML)를 기계 파싱해
 *    · `erp/templates/fire-plan-workbook.xlsx`      (런타임이 값만 주입하는 골격)
 *    · `erp/src/lib/fire-plan-xlsx-manifest.json`   (시트·라벨·상자글자·토큰의 **단일 원천**)
 *  두 자산을 만든다. 갑지(`build-workbook-template.mts`)와 같은 자리의 역할이되, 원본이
 *  엑셀이 아니라 HWP라 LibreOffice 변환 대신 S1 파서 + S2 빌더를 쓴다.
 *
 *  실행: npx tsx scripts/build-fire-plan-template.mts
 *  게이트가 하나라도 붉으면 **파일을 쓰지 않고** exit 1 한다(S7-1).
 *
 *  ⚠ 1단계 범위는 **제1장**이다(D-3·Q-2). 제2·3장은 이 지도에 절을 더하면 늘어난다 —
 *    파서·빌더·검증은 그대로다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  parseTables, parseBorderFills, columnEdges, rowHeights, validateGrid,
  hwpToPt, hwpToPx, pxToColWidth,
  type HwpxTable, type HwpxCell, type HwpxBorderFill,
} from '../src/lib/hwpx-table.ts'
import {
  buildXlsx, cellRef, type BuildSheet, type BuildCell, type CellStyle,
} from '../src/lib/xlsx-build.ts'
import {
  scrubText, uncheckText, FIRE_PLAN_SCRUB_NEEDLES, FIRE_PLAN_MARK_CHECKED_RE,
} from '../src/lib/fire-plan-scrub.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const OUT_XLSX = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const OUT_MANIFEST = resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json')

/* ══════════════════════ 제1장 시트 지도 ══════════════════════
 *
 *  S3-1은 **1 표 = 1 시트**다. 엑셀은 시트당 열 격자가 하나인데 이 양식의 colCnt는 1~30으로
 *  요동친다 — 장별로 묶으면 열 경계 합집합이 5열 표를 수십 조각으로 쪼개 그 칸에 타이핑을
 *  못 하게 만든다. 1쪽=1시트도 불가하다(서식 1.11의 하위표 5개가 30/10/6/17/7).
 *  실측으로도 제1장에는 **열 경계 벡터가 같은 연속 표가 한 쌍도 없다**(있는 곳은 제2장 #55~#60).
 *
 *  ⚠ 지도를 손으로 적되 **빌드가 파싱 결과와 대조**한다 — 표 번호·행열 수·배너 서식번호가
 *    하나라도 어긋나면 실패한다. 양식이 개정되면 조용히 다른 서식이 나가는 대신 빌드가 선다.
 */
type Part =
  | { kind: 'banner'; table: number }
  | { kind: 'grid'; table: number; rc: [number, number] }

interface SectionDef {
  /** 시트명 — S3-2 규약(31자·금지문자 없음·중복 없음). 앵커·라우트·검증의 키 */
  name: string
  /** 서식 번호. 표지·개정이력은 번호가 없다 */
  no: string | null
  /** 문서 등장 순서 그대로 */
  parts: Part[]
}

const CHAPTER1: SectionDef[] = [
  // 표지 — 배너가 없다. #1(제목)이 #0(용도 상자) **뒤에** 오는 것은 원문 순서 그대로다.
  { name: '표지', no: null, parts: [{ kind: 'grid', table: 0, rc: [2, 4] }, { kind: 'banner', table: 1 }] },
  { name: '개정이력', no: null, parts: [{ kind: 'grid', table: 2, rc: [12, 6] }] },

  { name: '1.1 건축물 일반현황', no: '1.1', parts: [{ kind: 'banner', table: 3 }, { kind: 'banner', table: 4 }, { kind: 'grid', table: 5, rc: [25, 10] }] },

  { name: '1.2.1 구역별 세부현황', no: '1.2.1', parts: [{ kind: 'banner', table: 6 }, { kind: 'grid', table: 7, rc: [21, 12] }] },
  { name: '1.2.2 화재취약장소 현황', no: '1.2.2', parts: [{ kind: 'grid', table: 8, rc: [21, 6] }] },

  { name: '1.3 건축물 위치·운영현황', no: '1.3', parts: [{ kind: 'banner', table: 9 }, { kind: 'grid', table: 10, rc: [4, 1] }] },
  { name: '1.3 소방차 진입경로', no: '1.3', parts: [{ kind: 'grid', table: 11, rc: [7, 9] }] },

  { name: '1.4 소방시설 현황', no: '1.4', parts: [{ kind: 'banner', table: 12 }, { kind: 'grid', table: 13, rc: [25, 5] }] },

  { name: '1.5.1 피난·방화시설 현황', no: '1.5.1', parts: [{ kind: 'banner', table: 14 }, { kind: 'grid', table: 15, rc: [24, 12] }] },
  { name: '1.5.2 방화·제연구획 현황도', no: '1.5.2', parts: [{ kind: 'grid', table: 16, rc: [6, 9] }] },

  { name: '1.6.1 기타시설 일반현황', no: '1.6.1', parts: [{ kind: 'banner', table: 17 }, { kind: 'grid', table: 18, rc: [19, 8] }] },

  { name: '1.7.1 소방안전관리자 선임현황', no: '1.7.1', parts: [{ kind: 'banner', table: 19 }, { kind: 'grid', table: 20, rc: [18, 6] }] },

  { name: '1.8 업무대행 현황', no: '1.8', parts: [{ kind: 'banner', table: 21 }, { kind: 'grid', table: 22, rc: [15, 7] }] },

  // ⚠ 서식 1.9는 **배너 없는 표**다(F-3) — 표 대조 95/95이므로 누락이 아니다.
  //   번호는 표 자신이 들고 있다(#23 '1.9.3'). #24는 번호가 없어 지도에 적어 준다.
  { name: '1.9.3 입주사 현황', no: '1.9.3', parts: [{ kind: 'grid', table: 23, rc: [17, 6] }] },
  { name: '1.9 자위소방대 현황', no: '1.9', parts: [{ kind: 'grid', table: 24, rc: [26, 23] }] },

  { name: '1.10.1 연간 점검 계획', no: '1.10.1', parts: [{ kind: 'banner', table: 25 }, { kind: 'grid', table: 26, rc: [25, 16] }] },
  { name: '1.10.3 다중이용업소 관리현황', no: '1.10.3', parts: [{ kind: 'grid', table: 27, rc: [30, 15] }] },
  { name: '1.10.4 화재·비화재보 이력', no: '1.10.4', parts: [{ kind: 'grid', table: 28, rc: [17, 7] }] },

  { name: '1.11.1 소방훈련·교육 연간계획', no: '1.11.1', parts: [{ kind: 'banner', table: 29 }, { kind: 'grid', table: 30, rc: [16, 30] }] },
  { name: '1.11.2 소방훈련·교육 세부계획', no: '1.11.2', parts: [{ kind: 'grid', table: 31, rc: [19, 10] }] },
  { name: '1.11.3 소방훈련 시나리오', no: '1.11.3', parts: [{ kind: 'grid', table: 32, rc: [9, 6] }] },
  // 별지 제28호서식은 앞쪽·뒷쪽 두 표다. 열 격자가 17 vs 7로 달라 한 시트에 못 넣는다.
  { name: '1.11.4 훈련·교육 결과기록부', no: '1.11.4', parts: [{ kind: 'grid', table: 33, rc: [25, 17] }] },
  { name: '1.11.4 결과기록부 뒷쪽', no: '1.11.4', parts: [{ kind: 'grid', table: 34, rc: [16, 7] }] },

  { name: '1.12.1 화기취급작업 현황', no: '1.12.1', parts: [{ kind: 'banner', table: 35 }, { kind: 'grid', table: 36, rc: [19, 7] }] },

  { name: '1.13 소방시설 공사·정비 기록', no: '1.13', parts: [{ kind: 'banner', table: 37 }, { kind: 'grid', table: 38, rc: [15, 6] }] },

  { name: '1.14.1 화재예방 및 홍보 계획', no: '1.14.1', parts: [{ kind: 'banner', table: 39 }, { kind: 'grid', table: 40, rc: [16, 15] }] },
  { name: '1.14.2 화재예방 및 홍보 결과', no: '1.14.2', parts: [{ kind: 'grid', table: 41, rc: [5, 4] }] },

  { name: '1.15 피해 복구', no: '1.15', parts: [{ kind: 'banner', table: 42 }, { kind: 'grid', table: 43, rc: [17, 9] }] },
]

/* ══════════════════════ 표본 답 비우기 (S7-3 강순기 대조가 찾아낸 것) ══════════════════════
 *
 *  스크럽(S3-3)은 **PII**를, 체크 덮개(S3-4)는 **■**를 잡는다. 그 둘을 통과하고도 남는 부류가
 *  있다 — 표본 고객이 손으로 적은 **자유 텍스트 답**이다. 육안으로는 서식의 일부처럼 보여서
 *  안 잡힌다. 이걸 찾아낸 것이 강순기 대조다(같은 칸의 두 문서 값이 다르면 그 칸은 값 칸이다):
 *
 *    표지 용도       양식 '☐ 복합건축물'  vs 강순기 '☐ 근린생활시설'
 *    개정이력 일자   양식 '25.1.14'       vs 강순기 '25.01.01'
 *    1.2.2 위치      양식 '각 세대 보일러실' vs 강순기 '1층 보일러실'
 *
 *  ⚠ **손목록이라 다음 표본 답을 못 본다.** 그 구멍을 메우는 것이 목록이 아니라
 *    `_probe-42-gangsungi.mts` 자체다 — 양식이 갱신되면 그 대조가 먼저 붉어진다.
 *
 *  ⚠ 비우지 **않기로** 한 것들: 1.11.2 시나리오·훈련계획·교보재, 1.11.3 시나리오 본문 등은
 *    승진소방이 고객 간에 재사용하는 **표준 문구**이고, D-4가 '강순기와 같이'이므로 기본값으로
 *    남기는 편이 낫다. 지우면 사용자가 매번 다시 써야 한다. 이건 사용자 확인이 필요한 축이라
 *    S7-3 보고서에 남긴다(조용히 한쪽을 택하지 않는다 — Q-4 규약).
 */
interface BlankCell { table: number; row: number; col: number; why: string; keep?: string }

const SAMPLE_ANSWER_CELLS: BlankCell[] = [
  // 표지 용도 — 상자는 남기고 **라벨만** 지운다. 값 축이 `☐ {용도}`로 다시 조립한다(앵커 cover_purpose)
  { table: 0, row: 0, col: 1, why: '표지 용도 = 고객별 값(강순기는 근린생활시설)', keep: 'box' },
  // 개정이력 1행 — 날짜·내용 모두 표본. 틀린 날짜가 인쇄되는 것이 공란보다 나쁘다
  { table: 2, row: 1, col: 1, why: '개정이력 일자 = 표본(25.1.14). 개정이력 배선은 2단계' },
  { table: 2, row: 1, col: 2, why: "개정이력 내용 = 표본('2025년 …' 연도 고정)" },
  // 1.2.2 화재취약장소 위치 — 소방 문서에서 틀린 위치는 안전 문제다
  { table: 8, row: 3, col: 1, why: '보일러실 위치 = 고객별 값' },
  { table: 8, row: 7, col: 1, why: '주방 위치 = 고객별 값' },
  // ⚠ 이 칸은 강순기와 **우연히 같아서** 대조에 안 걸렸다. 역할이 같으므로 함께 비운다 —
  //   대조가 못 보는 자리를 사람이 메우는 쪽이고, 그래서 이유를 적어 둔다.
  { table: 8, row: 11, col: 1, why: '전기실 위치 = 고객별 값(강순기와 우연히 일치해 대조엔 안 걸렸다)' },
  // 1.11.2 시나리오 — 양식 '2층 주방에서…' vs 강순기 '2층 화재발생…'. 두 고객의 답이 다르므로
  // **값 칸**이다(라벨이면 같아야 한다). 같은 표의 훈련계획·교보재·참여대상은 양쪽이 일치해
  // 공용 표준 문구로 보고 **남겼다** — 그 판단은 사용자 확인이 필요해 Q-5로 올렸다.
  { table: 31, row: 12, col: 1, why: '소방훈련 시나리오 = 고객별 값(강순기와 문구가 다르다)' },
]

const blankAt = new Map<string, BlankCell>(SAMPLE_ANSWER_CELLS.map(b => [`${b.table}:${b.row}:${b.col}`, b]))

/* ══════════════════════ 게이트 수집기 ══════════════════════ */

const fails: string[] = []
const notes: string[] = []
const fail = (s: string) => { fails.push(s); console.log(`  ✗ ${s}`) }
const ok = (s: string) => console.log(`  · ${s}`)

/* ══════════════════════ ① 파싱 + 눈멂 가드(S3-5) ══════════════════════ */

console.log('① 양식 파싱')
const zip = await JSZip.loadAsync(readFileSync(HWPX))
const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
const headerXml = await zip.file('Contents/header.xml')!.async('string')
const tables = parseTables(sectionXml)
const { fills, unknownBorderTypes } = parseBorderFills(headerXml)

const cellTotal = tables.reduce((s, t) => s + t.cells.length, 0)
const mergeTotalDoc = tables.reduce(
  (s, t) => s + t.cells.filter(c => c.rowSpan > 1 || c.colSpan > 1).length, 0)

// 🚨 S3-5 눈멂 가드 — **먼저** 단언한다. 0을 훑고 '잔재 0'이라 말하면 항진명제다.
if (tables.length < 95) fail(`눈멂 가드: 표 ${tables.length} < 95`)
else ok(`표 ${tables.length}`)
if (cellTotal < 4000) fail(`눈멂 가드: 셀 ${cellTotal} < 4000`)
else ok(`셀 ${cellTotal}`)
if (mergeTotalDoc < 1) fail(`눈멂 가드: 병합 ${mergeTotalDoc} < 1`)
else ok(`병합 ${mergeTotalDoc}`)
if (unknownBorderTypes.length) fail(`미지 테두리 조합 ${unknownBorderTypes.length}종: ${unknownBorderTypes.join(' · ')}`)
else ok(`borderFill ${fills.size}종 · 미지 0`)

// 격자 정합(S1-3) — 여기가 통과해야 병합이 원본과 같아진다
{
  const problems = tables.flatMap(validateGrid)
  if (problems.length) fail(`격자 문제 ${problems.length}건: ${problems.slice(0, 3).map(p => `#${p.tableIndex} ${p.kind} ${p.detail}`).join(' / ')}`)
  else ok('격자 정합 95표 전건 문제 0')
}

/* ══════════════════════ ② 지도 대조 ══════════════════════ */

console.log('② 시트 지도 ↔ 파싱 결과 대조')
const ch2At = tables.findIndex(t => t.rowCnt === 1 && t.cells.some(c => /^제\s*2\s*장/.test(c.text.trim())))
if (ch2At < 0) fail('제2장 배너를 못 찾았다 — 제1장 범위를 정할 수 없다')
else ok(`제1장 = 표 #0..#${ch2At - 1} (제2장 배너 #${ch2At})`)

{
  const used = new Map<number, string>()
  for (const sec of CHAPTER1) {
    for (const p of sec.parts) {
      const prev = used.get(p.table)
      if (prev) fail(`표 #${p.table} 를 두 시트가 쓴다 — '${prev}' · '${sec.name}'`)
      used.set(p.table, sec.name)
      const t = tables[p.table]
      if (!t) { fail(`표 #${p.table} 가 없다 (${sec.name})`); continue }
      if (p.kind === 'banner') {
        if (t.rowCnt !== 1) fail(`배너 #${p.table} 의 행수가 1이 아니다 (${t.rowCnt}) — ${sec.name}`)
        const m = /^서식\s*([\d.]+)/.exec(t.cells.map(c => c.text.trim()).find(Boolean) ?? '')
        if (m && sec.no && !sec.no.startsWith(m[1])) {
          fail(`배너 #${p.table} 의 서식번호 '${m[1]}' 가 시트 번호 '${sec.no}' 와 다르다 — ${sec.name}`)
        }
      } else if (t.rowCnt !== p.rc[0] || t.colCnt !== p.rc[1]) {
        fail(`격자 #${p.table} 치수 ${t.rowCnt}x${t.colCnt} ≠ 지도 ${p.rc[0]}x${p.rc[1]} — ${sec.name}`)
      }
    }
  }
  if (ch2At >= 0) {
    const missing = Array.from({ length: ch2At }, (_, i) => i).filter(i => !used.has(i))
    if (missing.length) fail(`제1장 표 중 지도에 없는 것 ${missing.length}개: ${missing.join(',')}`)
    else ok(`제1장 표 ${ch2At}개를 ${CHAPTER1.length}시트가 빠짐없이 한 번씩 덮는다`)
  }
}

// 시트명 규약(S3-2) — buildXlsx도 막지만 여기서 먼저 이유를 붙여 세운다
{
  const seen = new Set<string>()
  for (const sec of CHAPTER1) {
    if (sec.name.length > 31) fail(`시트명 31자 초과(${sec.name.length}) — ${sec.name}`)
    if (/[:\\/?*[\]]/.test(sec.name)) fail(`시트명 금지문자 — ${sec.name}`)
    if (seen.has(sec.name)) fail(`시트명 중복 — ${sec.name}`)
    seen.add(sec.name)
    if (sec.no && !sec.name.startsWith(sec.no)) fail(`시트명이 서식번호로 시작하지 않는다 — ${sec.name}`)
  }
  ok(`시트명 ${seen.size}종 규약 통과`)
}

/* ══════════════════════ ③ 빈 상자 글자 판정 (F-6) ══════════════════════
 *
 *  원본이 `□`(449) 와 `☐`(212) 를 **섞어 쓴다**. 전역 어휘를 강제하면 어느 쪽을 골라도
 *  최소 212칸 또는 449칸이 원본과 갈라진다. 그래서 셀마다 원본 글자를 manifest에 적는다.
 *
 *  문제는 **체크된 칸(`■`)** 이다 — 표본 고객의 답이 원본 빈 글자를 덮어써서 그 칸이 원래
 *  `□`였는지 `☐`였는지 문서에 남아 있지 않다. 근처가 답이다: 같은 줄의 형제 상자들이 한
 *  어휘를 쓰고(예: `■ 승용 / ☐ 비상용 / ☐ 피난용`), 같은 열의 형제도 그렇다
 *  (`■소화기구 / □ 옥내소화전설비 / □ 스프링클러설비`). 행 → 열 → 표 → 전역 순으로 묻고,
 *  **어느 축에서 답을 얻었는지 manifest에 남긴다**(추측을 사실처럼 적지 않는다).
 */
const BOX_RE = /[□☐]/g

/** ⚠ 안내문 `※ □에는 해당되는 곳에 √표를 합니다.` 의 `□`는 **표의 어휘가 아니다** — 실측으로
 *  서식 1.1은 본문에 `☐`를 쓰면서 안내문엔 `□`를 쓴다. 인구조사에서 빼지 않으면 이 한 문장이
 *  그 행 전체의 어휘를 뒤집는다(실제로 `■ 대상명 :`을 `□ 대상명 :`으로 만들었다). */
const GUIDE_RE = /※.*√\s*표/

function boxCensus(texts: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of texts) {
    if (GUIDE_RE.test(t)) continue
    BOX_RE.lastIndex = 0
    for (const g of t.match(BOX_RE) ?? []) m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}
const dominant = (m: Map<string, number>): string | null => {
  let best: string | null = null
  let n = 0
  for (const [g, c] of m) if (c > n) { best = g; n = c }
  return best
}

interface BoxOracle {
  /**
   * (row,col) → 원본 빈상자 글자 + 판정 축.
   *
   * `null`은 "이 `■`는 체크박스가 아니다"라는 뜻이다 — 같은 행에도 같은 열에도 형제 빈 상자가
   * 없다. **선택지 묶음은 형제가 있고 불릿은 혼자 선다.** 실측으로 이 자리에 걸리는 것은
   * `■ 대상명 :`(9개 표에 반복)과 `■ 화재의 예방…[별지 제28호서식]` 뿐이고, 둘 다 표본 고객의
   * 답이 아니라 **법정 서식의 불릿 글자**다. 빈 상자로 바꾸면 원본에 없던 선택지가 생긴다.
   */
  glyphFor(cell: HwpxCell): { glyph: string; axis: 'row' | 'col' } | null
}

function makeBoxOracle(t: HwpxTable): BoxOracle {
  const byRow = new Map<number, string[]>()
  const byCol = new Map<number, string[]>()
  for (const c of t.cells) {
    if (!c.text) continue
    ;(byRow.get(c.row) ?? byRow.set(c.row, []).get(c.row)!).push(c.text)
    ;(byCol.get(c.col) ?? byCol.set(c.col, []).get(c.col)!).push(c.text)
  }
  return {
    glyphFor(cell) {
      const r = dominant(boxCensus(byRow.get(cell.row) ?? []))
      if (r) return { glyph: r, axis: 'row' }
      const k = dominant(boxCensus(byCol.get(cell.col) ?? []))
      if (k) return { glyph: k, axis: 'col' }
      return null
    },
  }
}

/* ══════════════════════ ④ 시트 조립 ══════════════════════ */

const TOKEN_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g

interface SheetManifest {
  name: string
  no: string | null
  tables: number[]
  rows: number
  cols: number
  merges: number
  /** 배너 행(0-based 시트 행) — 전폭 병합된 제목 줄 */
  bannerRows: number[]
  /** 리터럴로 인쇄되는 법정 문구. 'A1' → 글 */
  labels: Record<string, string>
  /** F-6 — 셀별 원본 빈상자 글자('□' 또는 '☐') */
  boxes: Record<string, string>
  /** `■`를 되돌린 칸 → 어느 축(행/열)에서 원본 글자를 얻었는가. 추측을 사실처럼 적지 않는다 */
  restoredBoxes: Record<string, string>
  /** 형제 빈 상자가 없어 **체크가 아니라 불릿**으로 판정한 `■` 칸 — 법정 자구라 그대로 둔다 */
  bulletCells: Record<string, string>
  /** 앵커 씨앗 — 'A1' → 원본 템플릿 문자열(`{{token}}` 포함). 셀은 template에서 **공란**이다 */
  tokenCells: Record<string, string>
  /** 스크럽된 칸 → 지운 니들 */
  scrubbed: Record<string, string[]>
  /** 표본 고객의 자유 텍스트 답이라 비운 칸 → 이유(S7-3 강순기 대조가 찾아냈다) */
  sampleBlanked: Record<string, string>
  /** 0열이 1,2,3… 으로 이어지는 구간 — 반복 행 예산의 파생 원천(S4-3) */
  numberedRuns: { startRow: number; rows: number }[]
}

function styleOf(bf: HwpxBorderFill | undefined): CellStyle {
  return {
    left: bf?.left ?? 'none', right: bf?.right ?? 'none',
    top: bf?.top ?? 'none', bottom: bf?.bottom ?? 'none',
    fill: bf?.faceColor ?? null,
    center: true,
  }
}

console.log('③ 시트 조립 · 스크럽 · 체크 되돌리기')

const sheets: BuildSheet[] = []
const manifests: SheetManifest[] = []
let scrubHits = 0
let uncheckHits = 0
let tokenCellCount = 0
let blankHits = 0

for (const sec of CHAPTER1) {
  const gridPart = sec.parts.find(p => p.kind === 'grid') as Extract<Part, { kind: 'grid' }> | undefined
  if (!gridPart) { fail(`${sec.name}: 격자 표가 없다`); continue }
  const grid = tables[gridPart.table]
  const nCols = grid.colCnt

  const banners = sec.parts.filter(p => p.kind === 'banner') as Extract<Part, { kind: 'banner' }>[]
  // 배너를 격자 앞에 둘지 뒤에 둘지는 **원문 순서**가 정한다(표지는 제목이 용도상자 뒤에 온다)
  const gridAt = sec.parts.indexOf(gridPart)
  const before = banners.filter(b => sec.parts.indexOf(b) < gridAt)
  const after = banners.filter(b => sec.parts.indexOf(b) > gridAt)

  const cells: BuildCell[] = []
  const merges: string[] = []
  const heights: number[] = []
  const m: SheetManifest = {
    name: sec.name, no: sec.no, tables: sec.parts.map(p => p.table),
    rows: 0, cols: nCols, merges: 0, bannerRows: [],
    labels: {}, boxes: {}, restoredBoxes: {}, bulletCells: {}, tokenCells: {}, scrubbed: {}, sampleBlanked: {}, numberedRuns: [],
  }

  /** 원문 → 스크럽 → 체크 되돌리기 → 토큰 비우기. **배너와 격자가 같은 관을 지난다** —
   *  갈라 두면 한쪽만 낡는다(실측: 배너만 빼놨더니 표지에 `{{customer_name}}`이 남았다). */
  const processText = (raw: string, ref: string, boxGlyph: () => { glyph: string; axis: string } | null) => {
    let text = raw
    const { text: cleaned, hits } = scrubText(text)
    if (hits.length) { text = cleaned; m.scrubbed[ref] = hits; scrubHits++ }

    // `[√]`·`☑`는 글자가 하나로 정해져 있어 상자 어휘를 물을 필요가 없다 — 항상 되돌린다
    const bracketed = text.replace(/\[\s*[√✓✔]\s*\]/g, '[ ]').replace(/[☑▣]/g, '☐')
    if (bracketed !== text) { text = bracketed; uncheckHits++ }

    if (text.includes('■')) {
      const hit = boxGlyph()
      if (hit) {
        text = uncheckText(text, hit.glyph)
        m.restoredBoxes[ref] = hit.axis
        uncheckHits++
      } else {
        // 형제 빈 상자가 없다 = 선택지가 아니다 → 법정 서식의 불릿. 바꾸면 없던 선택지가 생긴다
        m.bulletCells[ref] = text
      }
    }

    TOKEN_RE.lastIndex = 0
    if (TOKEN_RE.test(text)) {
      // 🚨 앵커 셀은 템플릿에서 **공란**이다(S7-2 백지 불변식) — 원문은 manifest가 들고 있다가
      //    S5가 값을 끼워 다시 조립한다. 템플릿에 남겨 두면 값이 없을 때 `{{...}}`가 인쇄된다.
      m.tokenCells[ref] = text
      tokenCellCount++
      text = ''
    }

    BOX_RE.lastIndex = 0
    const boxes = text.match(BOX_RE)
    if (boxes?.length) m.boxes[ref] = boxes[0]
    if (text) m.labels[ref] = text
    return text
  }

  const emitBanner = (idx: number, row: number) => {
    const bt = tables[idx]
    const raw = bt.cells
      .slice().sort((a, b) => a.col - b.col)
      .map(c => c.text.trim()).filter(Boolean).join('  ')
    const style = styleOf(fills.get(bt.cells[0]?.borderFillId ?? 0))
    const text = processText(raw, cellRef(row, 0), () => null)
    for (let k = 0; k < nCols; k++) cells.push({ row, col: k, text: k === 0 ? text : '', style })
    if (nCols > 1) merges.push(`${cellRef(row, 0)}:${cellRef(row, nCols - 1)}`)
    heights.push(hwpToPt(Math.max(...bt.cells.map(c => c.heightHwp), 0)) || 22)
    m.bannerRows.push(row)
  }

  let row = 0
  for (const b of before) emitBanner(b.table, row++)

  const gridTop = row
  const oracle = makeBoxOracle(grid)
  const gridHeights = rowHeights(grid).map(hwpToPt)
  for (const h of gridHeights) heights.push(h)
  row += grid.rowCnt

  for (const c of grid.cells) {
    const style = styleOf(fills.get(c.borderFillId))
    const r0 = gridTop + c.row
    const ref = cellRef(r0, c.col)
    const blank = blankAt.get(`${gridPart.table}:${c.row}:${c.col}`)
    // 표본 답 비우기 — 상자만 남기라는 지시면 빈 상자 글자 하나만 남긴다
    const raw = blank ? (blank.keep === 'box' ? (c.text.match(BOX_RE)?.[0] ?? '') : '') : c.text
    if (blank) { m.sampleBlanked[ref] = blank.why; blankHits++ }
    const text = processText(raw, ref, () => oracle.glyphFor(c))

    cells.push({ row: r0, col: c.col, text, style })

    if (c.rowSpan > 1 || c.colSpan > 1) {
      merges.push(`${cellRef(r0, c.col)}:${cellRef(r0 + c.rowSpan - 1, c.col + c.colSpan - 1)}`)
      // ⚠ 덮인 칸도 만든다 — xlsx에서 병합 영역의 테두리는 구성 셀들의 바깥 변에서 나온다.
      //   안 만들면 병합 안쪽 테두리가 통째로 빠진다.
      for (let r = r0; r < r0 + c.rowSpan; r++) {
        for (let k = c.col; k < c.col + c.colSpan; k++) {
          if (r === r0 && k === c.col) continue
          cells.push({ row: r, col: k, text: '', style })
        }
      }
    }
  }

  for (const b of after) emitBanner(b.table, row++)

  // 반복 행 예산 파생(S4-3) — 0열이 1,2,3…으로 이어지는 구간
  {
    const col0 = new Map<number, string>()
    for (const c of grid.cells) if (c.col === 0) col0.set(gridTop + c.row, c.text.trim())
    let start = -1, want = 1
    for (let r = 0; r <= row; r++) {
      const v = col0.get(r)
      if (v === String(want)) { if (start < 0) start = r; want++; continue }
      if (start >= 0 && want - 1 >= 3) m.numberedRuns.push({ startRow: start, rows: want - 1 })
      start = -1; want = 1
      if (v === '1') { start = r; want = 2 }
    }
    if (start >= 0 && want - 1 >= 3) m.numberedRuns.push({ startRow: start, rows: want - 1 })
  }

  m.rows = row
  m.merges = merges.length
  manifests.push(m)
  sheets.push({ name: sec.name, colWidths: colWidthsOf(grid), rowHeights: heights, cells, merges })
}

function colWidthsOf(t: HwpxTable): number[] {
  const edges = columnEdges(t)
  return Array.from({ length: t.colCnt }, (_, i) => pxToColWidth(hwpToPx(edges[i + 1] - edges[i])))
}

ok(`시트 ${sheets.length} · 스크럽 ${scrubHits}칸 · 체크 되돌림 ${uncheckHits}칸 · 표본답 비움 ${blankHits}칸 · 토큰칸 ${tokenCellCount}`)
notes.push(`스크럽 ${scrubHits}칸 · 체크 되돌림 ${uncheckHits}칸 · 표본답 비움 ${blankHits}칸 · 토큰 씨앗 ${tokenCellCount}칸`)
// 선언한 만큼 실제로 비웠는가 — 좌표가 밀리면 조용히 0칸이 된다(항진명제 방지)
if (blankHits !== SAMPLE_ANSWER_CELLS.length) {
  fail(`표본답 비움 ${blankHits}칸 ≠ 선언 ${SAMPLE_ANSWER_CELLS.length}칸 — 좌표가 밀렸다`)
}

/* ══════════════════════ ⑤ 조립 ══════════════════════ */

console.log('④ xlsx 조립')
const built = await buildXlsx(sheets)
ok(`${built.bytes.length} bytes · cellXfs ${built.styleCount}`)

/* ══════════════════════ ⑥ 게이트 ══════════════════════ */

console.log('⑤ 게이트')

// 🚨 S3-3 PII — **원시 바이트** 축. 셀 값 스캔은 파트 안에 남은 원문을 못 본다
{
  const z = await JSZip.loadAsync(built.bytes)
  let hitCount = 0
  for (const name of Object.keys(z.files)) {
    if (z.files[name].dir) continue
    const raw = await z.file(name)!.async('string')
    for (const n of FIRE_PLAN_SCRUB_NEEDLES) {
      if (raw.includes(n)) { fail(`원시 바이트 니들 잔존: ${name} ⊃ '${n}'`); hitCount++ }
    }
  }
  if (!hitCount) ok(`니들 ${FIRE_PLAN_SCRUB_NEEDLES.length}종 · 전 파트 원시 바이트 0건`)
}

// 🚨 sharedStrings 파트 **부재** — 내용이 아니라 구조로 닫는다(S2-2)
{
  const z = await JSZip.loadAsync(built.bytes)
  const names = Object.keys(z.files)
  if (names.includes('xl/sharedStrings.xml')) fail('sharedStrings.xml 파트가 생겼다 — 고아 si 사고 경로가 열린다')
  else ok('sharedStrings.xml 부재(고아 si 사고를 구조로 차단)')
  if (names.some(n => n.startsWith('xl/media/'))) fail('xl/media 파트가 생겼다 — 이미지 0 규약 위반')
  else ok('xl/media 부재')
  let f = 0
  for (const n of names.filter(x => /^xl\/worksheets\/.*\.xml$/.test(x))) {
    f += ((await z.file(n)!.async('string')).match(/<f[\s>]/g) ?? []).length
  }
  if (f) fail(`수식 ${f}개 — 무수식 규약 위반`)
  else ok('수식 0개')
}

// 🚨 S3-4 체크 마크 덮개 — 리터럴 셀에 체크된 표시가 남으면 표본 고객의 답이 전 고객 문서에
//    인쇄된다. 지금은 앵커가 없어 **전 셀이 리터럴**이라 가장 강한 형태로 검사된다.
//    유일한 예외는 규칙으로 파생된 `bulletCells`(형제 빈 상자가 없는 `■` = 법정 불릿)뿐이고,
//    그 목록도 여기서 다시 심사한다 — 손목록이 아니라 **규칙과 그 규칙의 결과**를 함께 본다.
{
  const bullets = new Map<string, string>()
  for (const x of manifests) for (const [ref, t] of Object.entries(x.bulletCells)) bullets.set(`${x.name}!${ref}`, t)

  const bad: string[] = []
  for (const sh of sheets) {
    for (const c of sh.cells) {
      if (!c.text || !FIRE_PLAN_MARK_CHECKED_RE.test(c.text)) continue
      const key = `${sh.name}!${cellRef(c.row, c.col)}`
      if (!bullets.has(key)) bad.push(`${key} = ${c.text.slice(0, 24)}`)
    }
  }
  if (bad.length) fail(`체크된 표시 잔존 ${bad.length}칸: ${bad.slice(0, 5).join(' · ')}`)
  else ok(`체크된 표시 0칸 (불릿 예외 ${bullets.size}칸)`)

  // 불릿 심사 — ①`■`로 시작하고 ②그 뒤에 라벨이 있고 ③상자가 하나뿐이고 ④수가 적어야 한다.
  // 하나라도 어긋나면 그건 불릿이 아니라 놓친 체크다.
  for (const [key, t] of bullets) {
    if (!t.trimStart().startsWith('■')) fail(`불릿 판정 부적격(맨 앞이 아니다): ${key} = ${t.slice(0, 30)}`)
    if ((t.match(/■/g) ?? []).length !== 1) fail(`불릿 판정 부적격(■가 여러 개): ${key} = ${t.slice(0, 30)}`)
    if (t.replace(/■/g, '').trim().length < 2) fail(`불릿 판정 부적격(라벨이 없다): ${key} = ${t.slice(0, 30)}`)
    if (/[☑▣√✓✔]/.test(t)) fail(`불릿 판정 부적격(다른 체크 표시 동반): ${key} = ${t.slice(0, 30)}`)
  }
  if (bullets.size > 12) fail(`불릿 예외 ${bullets.size}칸 — 너무 많다. 체크박스를 불릿으로 오판했을 소지`)
  for (const [key, t] of bullets) notes.push(`불릿 예외 ${key} = ${t.slice(0, 40)}`)
}

// 남은 `{{token}}` 0건 — 하나라도 남으면 고객 문서에 `{{owner_name}}`이 인쇄된다
{
  const bad: string[] = []
  for (const sh of sheets) for (const c of sh.cells) if (c.text.includes('{{')) bad.push(`${sh.name}!${cellRef(c.row, c.col)}`)
  if (bad.length) fail(`템플릿에 {{token}} 잔존 ${bad.length}칸: ${bad.slice(0, 5).join(' · ')}`)
  else ok('{{token}} 잔존 0칸')
}

// 눈멂 가드 ② — 산출물 쪽. 시트·병합·라벨이 0이면 위 검사들이 전부 항진명제가 된다
{
  const labelTotal = manifests.reduce((s, x) => s + Object.keys(x.labels).length, 0)
  const mergeTotal = manifests.reduce((s, x) => s + x.merges, 0)
  if (sheets.length < 28) fail(`산출 시트 ${sheets.length} < 28`)
  if (labelTotal < 500) fail(`라벨 ${labelTotal} < 500 — 스크럽이 과했거나 조립이 비었다`)
  if (mergeTotal < 500) fail(`병합 ${mergeTotal} < 500`)
  if (tokenCellCount < 50) fail(`토큰 씨앗 ${tokenCellCount} < 50 — 앵커 초안의 분모가 사라졌다`)
  ok(`산출 시트 ${sheets.length} · 라벨 ${labelTotal} · 병합 ${mergeTotal} · 토큰 ${tokenCellCount}`)
}

/* ══════════════════════ ⑦ 쓰기 ══════════════════════ */

if (fails.length) {
  console.log(`\n🚨 게이트 ${fails.length}건 실패 — 자산을 쓰지 않는다`)
  for (const f of fails) console.log(`   ${f}`)
  process.exit(1)
}

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

const manifest = {
  version: 1,
  doc: '소방계획서_42',
  scope: '제1장',
  builtBy: 'scripts/build-fire-plan-template.mts',
  source: { file: 'erp_goal/_Data/양식-placeholder.hwpx', sha256: sha(readFileSync(HWPX)), tables: tables.length, cells: cellTotal },
  asset: { file: 'templates/fire-plan-workbook.xlsx', sha256: sha(built.bytes), bytes: built.bytes.length, styles: built.styleCount },
  scrubNeedles: FIRE_PLAN_SCRUB_NEEDLES,
  sheets: manifests,
}

mkdirSync(dirname(OUT_XLSX), { recursive: true })
writeFileSync(OUT_XLSX, built.bytes)
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`\n✅ 게이트 전건 통과`)
for (const n of notes) console.log(`   ${n}`)
console.log(`   ${OUT_XLSX}  (${built.bytes.length} bytes · sha ${manifest.asset.sha256.slice(0, 12)})`)
console.log(`   ${OUT_MANIFEST}  (${existsSync(OUT_MANIFEST) ? readFileSync(OUT_MANIFEST).length : 0} bytes)`)
