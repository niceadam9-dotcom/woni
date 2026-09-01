/** 갑지 → 워크북 템플릿 자산 빌드 (소방계획서_27 S1 — 전처리 1회, 재실행 가능)
 *  실행: npx tsx scripts/build-workbook-template.mts     (로컬 LibreOffice 필요)
 *  산출: templates/report-workbook.xlsx + src/lib/xlsx-template-manifest.json
 *
 *  갑지 서식이 갱신되면 이 스크립트를 다시 돌린다(Q-4: 재변환). 그러면 manifest의 지문이 바뀌어
 *  test-xlsx-anchors가 먼저 붉어지고, 그때 앵커 좌표를 재실측해 재승인한다.
 *
 *  하는 일:
 *  ① .xls → .xlsx 변환 — 반드시 LibreOffice로. SheetJS로 변환하면 빈 서식 셀 9,162개가
 *     소멸해 서식이 전멸한다(2026-08-21 실측, lib/xlsx-inject.ts 머리 주석).
 *  ② 인쇄여백 복원 — LibreOffice가 header/footer를 0.3in → 1.3cm로 정규화한다(실측).
 *     법정 서식은 인쇄물이 곧 결과라 원본 값으로 되돌린다.
 *  ③ 🚨 샘플 실고객 데이터 전면 스크럽 — 템플릿에 정내과의원·김미진·전화·생년월일이 **리터럴로**
 *     박혀 있다(_probe-pii-scrub.mjs). 개요의 입력 칸 전부(HUB_INPUT_CELLS)를 비우고, 이행 폐포로
 *     스포크의 캐시값까지 비운다. 주입 누락 시 다른 고객 문서에 남의 값이 인쇄되는 것을 원천 차단.
 *  ④ 깨진 외부 참조 처리 — '1번 입력'!·'입력'! 시트는 워크북에 없다. 재계산을 안 켜면 #REF!로
 *     드러나지도 않는 부류라, <f>를 지우고 (회사 고정값은 값 유지 / 나머지는 공란) 처리한다.
 *     **알 수 없는 깨진 참조가 새로 발견되면 빌드를 실패시킨다** — 조용히 지나치지 않는다.
 *  ⑤ fullCalcOnLoad 부여 — 값 반영 수단이 아니라(D-4 폐기: LibreOffice가 무시) 사용자가
 *     Excel에서 허브를 고쳤을 때 수식이 살아 움직이게 하는 보조다. */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { injectWorkbook, sheetFileMap, buildFullRefGraph, transitiveClosure } from '../src/lib/xlsx-inject.ts'
import { HUB_INPUT_CELLS, HUB_LABEL_CELLS, SCRUB_NEEDLES, ANCHORS, MARK_CHECKED_RE, VERDICT_MARKS, SAMPLE_OPINION_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { FORM4_ROWS, FORM4_UNWIRED, FORM4_SHEET, FORM4_CODES_WITHOUT_ROW, form4CodeErrors } from '../src/lib/xlsx-form4.ts'
import { forceWrapText, HYEON5_WRAP_XFS } from '../src/lib/xlsx-wrap-fix.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const OUT = 'templates/report-workbook.xlsx'
const MANIFEST = 'src/lib/xlsx-template-manifest.json'
const HUB = '개요'

/** 깨진 참조의 **알려진** 처리 방침 — 여기 없는 깨진 참조가 나오면 빌드 실패 */
const KNOWN_BROKEN: Record<string, { keepValue: boolean; why: string }> = {
  '위임장!N6': { keepValue: false, why: '대리인 성명 — 런타임 앵커(agentName)가 채운다' },
  '위임장!N7': { keepValue: false, why: '대리인 직위 — agentPosition' },
  '위임장!N8': { keepValue: false, why: '대리인 연락처 — agentPhone' },
  '위임장!N9': { keepValue: false, why: '대리인 생년월일 — agentBirth' },
  '계약서!D29': { keepValue: false, why: '대표자 — repName 앵커가 company_profile에서 채운다' },
  '완료보고서!I12': { keepValue: true, why: '회사 사업자번호(고정값) — 값 그대로 두고 수식만 제거' },
  // '[21]1번 입력'! — 외부 통합문서 참조(경로가 이 PC에 없다). 전부 회사 고정 정보라 값 유지
  '완료보고서!B12': { keepValue: true, why: '회사 상호(고정값)' },
  '완료보고서!C14': { keepValue: true, why: '대표자(고정값)' },
  '완료보고서!F14': { keepValue: true, why: '회사 전화(고정값)' },
  '완료보고서!B16': { keepValue: true, why: '회사 주소(고정값)' },
}

/** 🚨 **허브 밖에 있는 표본 고객의 '답'** — ④의 스크럽 축은 `HUB_INPUT_CELLS`의 폐포라서
 *  개요와 무관한 시트에 박힌 표본 답이 **아예 보이지 않았다**(2026-08-24 독립 판정 3인 교차 확인).
 *  갑지는 실제 고객 하나(정내과의원)의 **완성된 문서**이므로, 별지 4호 쪽 시트는 그 고객의
 *  설비 목록·점검 결과·수신기 위치·점검 소견이 전부 채워진 채로 들어 있다.
 *
 *  ERP는 이 값들의 원천을 이 파이프라인에서 해석하지 않는다(별지 4호 값 배선은 Phase 3 몫).
 *  그러니 **채우지 않고 비운다** — 값을 지어내지 않고(D-7), 손으로 채워 쓰는 백지 서식이 된다.
 *  남의 점검 결과가 '양호'로 인쇄되는 것보다 빈칸이 낫다(D-10과 같은 판단).
 *
 *  ⚠ 이 표는 **손목록**이므로 그 자체로는 다음 사각을 못 막는다. 막는 것은 빌드 사후검증과
 *  test-xlsx-anchors의 **전 시트 덮개 불변식**이다: '앵커에 없는 리터럴 셀에 체크된 마크가
 *  하나라도 있으면 실패'. 갑지가 갱신돼 새 표본 답이 들어오면 그 불변식이 먼저 붉어진다.
 *  파생 수식 캐시(현1!C3·대상물!B10·세3!C17·위임장!D2 등 19칸)는 폐포가 따라오고,
 *  복합 수식 캐시(현황!S7의 `IF(C6="[  ]","/","○")` 등)는 ④f가 함께 비운다. */
const blankMarks = (s: string) => s.replace(/\[√\]/g, '[  ]').replace(/［√］/g, '［  ］')
const SAMPLE_ANSWERS: Array<{ sheet: string; cell: string; to: (orig: string) => string | null; why: string }> = [
  // 별지 4호 1쪽 — 표본이 설치한 설비 5종. 이 5칸이 `IF(…="[  ]","/","○")` 수식 88칸을 구동해
  // '○'(양호) 8칸·'/'(해당없음) 120칸을 만든다 → 안 한 점검이 양호로 인쇄되던 원천
  { sheet: '현황', cell: 'C6', to: blankMarks, why: '소화기구 및 자동소화장치 설치 √' },
  { sheet: '현황', cell: 'D7', to: blankMarks, why: '소화기구(소화기·자확·간이) √' },
  { sheet: '현황', cell: 'Y13', to: blankMarks, why: '유도등 √' },
  { sheet: '현황', cell: 'C28', to: blankMarks, why: '자동화재탐지설비 및 시각경보기 √' },
  { sheet: '현황', cell: 'Y28', to: blankMarks, why: '비상구·피난통로 √' },
  { sheet: '현1', cell: 'B4', to: blankMarks, why: '소화기구 세부 — 분말 √' },
  { sheet: '다수동', cell: 'C3', to: blankMarks, why: '소화기 √' },
  { sheet: '다수동', cell: 'B4', to: blankMarks, why: '분말 √' },
  // 점검 구분 — 표지(대상처!B7)는 앵커라 점검종류가 가변인데 여기는 표본의 '종합점검(최초점검)'
  // 고정이라 **한 파일 안에서 모순**됐다. 위임장!D2가 이 칸을 캐시로 끌어간다
  { sheet: '대상물', cell: 'G3', to: blankMarks, why: '점검 구분 종합점검(최초점검) √ — 표지와 모순' },
  // 별지 4호 5쪽 세부현황 — 마크 + **표본 고객의 실내 위치**(3층 직원실). 세3·세4가 캐시로 복제
  {
    sheet: '현3', cell: 'C8', why: '수신기 위치 — 층·실명이 표본 고객 것',
    to: o => blankMarks(o).replace('( 3 )층', '(   )층').replace('( 직원실 )', '(     )'),
  },
  { sheet: '현3', cell: 'C9', to: blankMarks, why: '경보방식·시각경보기 √' },
  { sheet: '현3', cell: 'C10', to: blankMarks, why: '설치장소 √' },
  { sheet: '현3', cell: 'C12', to: blankMarks, why: '감지기종류 √' },
  { sheet: '현3', cell: 'C34', to: blankMarks, why: '유도등 종류 √' },
  { sheet: '현3', cell: 'C35', to: blankMarks, why: '유도등 설치장소 √' },
  // 별지 4호 8쪽 불량 세부 — **남의 점검 소견**이 전 고객의 법정 서식에. 계획서!H12~H24가 캐시 복제
  //
  // ⚠ 여기서 비운 뒤 **④g2가 `=""`로 되돌린다.** 그냥 비워 두면 `=현5!C4` 부류 7칸
  //   (계획서!H12·H14·H16·H18·H20·H22·H24)이 **빈 셀 참조 = 0**이 되어 LibreOffice 재계산 후
  //   전 고객 문서에 `"0"`이 인쇄된다(2026-08-25 실측 — 그전에는 표본의 '이상없음'이 인쇄됐으니
  //   결함을 **다른 결함으로** 바꿨던 셈이었다). 참조자는 `_probe-form4-refs.mts`로 실측 1:1.
  ...['C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'].map(cell => ({
    sheet: '현5', cell, to: () => null, why: '점검 소견(이상없음·별첨참조) — 표본 고객의 판단',
  })),
  // 참조자 0건이라(실측) 통째로 비워도 0이 새어 나갈 곳이 없다
  { sheet: '완료보고서', cell: 'B20', to: () => null, why: '이행조치 결과 별첨참조 — 표본 답' },
]

/** LibreOffice가 파괴한 수식 복원 — NUMBERSTRING(한국어 Excel 전용)은 LO가 몰라 #REF!로
 *  바꿔 버린다(2026-08-21 실측: 원본 .xls엔 멀쩡히 있었다). 사용자의 실제 도구는 Excel이므로
 *  원본 수식을 되살린다 — J11·J14에 금액을 넣으면 한글 금액("일금 … 원정")이 자동으로 산다. */
const RESTORE_FORMULAS: Array<{ sheet: string; cell: string; formula: string }> = [
  { sheet: '계약서', cell: 'E11', formula: 'NUMBERSTRING(J11,1)&" 원정"' },
  { sheet: '계약서', cell: 'E14', formula: 'NUMBERSTRING(J14,1)&" 원정"' },
]

/** 셀을 **`=""`(빈 문자열 수식)** 로 만든다 — 스타일 인덱스(s=)는 보존.
 *
 *  '비어 있어야 하는데 **다른 칸이 단일 참조로 복제**하는' 칸의 유일한 안전한 표현이다.
 *  빈 셀·빈 inlineStr·빈 `<v>`는 전부 복제칸에서 `0`으로 재계산된다(5종 표현 LO 왕복 실측:
 *  `scripts/_probe-empty-repr.mts`). injectWorkbook은 값만 쓰고 수식은 못 만들므로 여기서 직접 패치한다. */
async function toEmptyFormula(src: Uint8Array, cells: Array<{ sheet: string; cell: string }>): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(src)
  const files = await sheetFileMap(zip)
  const bySheet = new Map<string, string[]>()
  for (const c of cells) bySheet.set(c.sheet, [...(bySheet.get(c.sheet) ?? []), c.cell])
  for (const [sheet, refs] of bySheet) {
    const path = files.get(sheet)
    if (!path) throw new Error(`toEmptyFormula: 시트 없음 ${sheet}`)
    let xml = await zip.file(path)!.async('string')
    for (const ref of refs) {
      const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
      const m = re.exec(xml)
      if (!m) throw new Error(`toEmptyFormula: 셀 없음 ${sheet}!${ref}`)
      const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
      xml = xml.replace(re, () => `<c r="${ref}"${attrs} t="str"><f>""</f></c>`)
    }
    zip.file(path, xml)
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

const dir = mkdtempSync(join(tmpdir(), 'wbtpl-'))
console.log(`임시: ${dir}`)

// ── ① .xls → .xlsx (LibreOffice) ─────────────────────────────────────
console.log('① .xls → .xlsx 변환')
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dir, SRC],
  { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
const converted = join(dir, basename(SRC).replace(/\.xls$/, '.xlsx'))
if (!existsSync(converted)) throw new Error('LibreOffice 변환 실패')

const origWb = XLSX.read(readFileSync(SRC), { cellStyles: true })
const mergeCount = (wb: XLSX.WorkBook) => wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)
const origMerges = mergeCount(origWb)

let bytes = new Uint8Array(readFileSync(converted))

// ── ② 인쇄여백 복원 ──────────────────────────────────────────────────
console.log('② 인쇄여백 복원')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  let restored = 0
  for (const [sheet, path] of files) {
    const m = origWb.Sheets[sheet]?.['!margins'] as Record<string, number> | undefined
    const f = zip.file(path)
    if (!m || !f) continue
    const xml = await f.async('string')
    if (!/<pageMargins[^>]*\/>/.test(xml)) continue
    zip.file(path, xml.replace(/<pageMargins[^>]*\/>/,
      `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`))
    restored++
  }
  console.log(`   ${restored}/${files.size} 시트`)
  if (restored !== files.size) throw new Error('여백 복원 누락 — pageMargins 태그 형태 확인 필요')
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④(선행) 깨진 외부 참조 전수 색출 — 모르는 것이 나오면 실패 ────────
console.log('③ 깨진 외부 참조 검사')
const scanWb = XLSX.read(bytes, { cellFormula: true })
const sheetSet = new Set(scanWb.SheetNames)
const brokenTargets: Array<{ sheet: string; cell: string; keepValue: boolean }> = []
{
  const unknown: string[] = []
  const restoreKeys = new Set(RESTORE_FORMULAS.map(r => `${r.sheet}!${r.cell}`))
  for (const s of scanWb.SheetNames) {
    const ws = scanWb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const f = String((ws[k] as XLSX.CellObject).f ?? '')
      const key = `${s}!${k}`
      if (restoreKeys.has(key)) continue                       // LO가 파괴한 수식 — 별도 복원
      // 외부 통합문서 참조('[21]시트'!)는 대괄호를 벗겨 시트명만 본다
      const m = /'?(?:\[\d+\])?([^'!=[\]]+)'?!/.exec(f)
      if (!m || sheetSet.has(m[1])) continue
      const known = KNOWN_BROKEN[key]
      if (!known) { unknown.push(`${key} = ${f}`); continue }
      brokenTargets.push({ sheet: s, cell: k, keepValue: known.keepValue })
    }
  }
  console.log(`   알려진 깨진 참조 ${brokenTargets.length}건 처리 예정`)
  if (unknown.length) {
    console.error(`   ❌ 알 수 없는 깨진 참조 ${unknown.length}건 — KNOWN_BROKEN에 방침을 정한 뒤 다시 빌드할 것`)
    for (const u of unknown) console.error(`      ${u}`)
    process.exit(1)
  }
}

// ── ③④ 스크럽 + 깨진 참조 처리 — 한 번의 injectWorkbook으로 ─────────
console.log('④ 샘플 데이터 스크럽(개요 전 입력 칸 + 이행 폐포) · 깨진 참조 수식 제거')
{
  const targets = [
    // 개요의 입력 칸 전부 공란 — 폐포 전파로 스포크 캐시까지 함께 비워진다
    ...HUB_INPUT_CELLS.map(cell => ({ sheet: HUB, cell, value: null as null })),
    // 깨진 참조: 수식 제거. 회사 고정값은 값 유지, 나머지는 공란
    ...brokenTargets.map(b => ({
      sheet: b.sheet, cell: b.cell, dropFormula: true,
      value: b.keepValue ? String((scanWb.Sheets[b.sheet][b.cell] as XLSX.CellObject).v ?? '') : null,
    })),
  ]
  // forbidden까지 걸어 니들을 문 캐시·공유문자열 텍스트를 함께 소거 — 판정 실측(2026-08-22):
  // 고아 si 5건(정내과의원·주소·김미진·845.75·전화)이 셀에는 안 보여도 산출물 바이트에 실려 나갔다
  const r = await injectWorkbook(bytes, targets, { forbidden: SCRUB_NEEDLES })
  if (r.missed.length) throw new Error(`스크럽 대상 미발견: ${r.missed.join(', ')}`)
  console.log(`   대상 ${targets.length}칸 + 폐포 전파 ${r.propagated}칸 + 니들 소거 ${r.scrubbed.length}곳`)
  bytes = r.bytes
}

// ── ④c 허브 영향 복합 수식의 잔존 캐시 소거 ─────────────────────────
// 단일 참조 폐포(④)는 값을 전파할 수 있는 간선만 비운다. 교차 연산(정보!I16 = 개요!D19 개요!D19)·
// 산술(완료보고서!G25 = 개요!G10+5) 같은 복합 수식은 폐포 밖이라 표본 캐시(교육이수일 40719·
// 이행조치일 46237 — 날짜 시리얼이라 문자 니들로도 안 잡힌다)가 남아 전 고객 문서에 인쇄된다.
// 허브에서 전체 그래프로 닿는 셀 중 캐시가 남은 것을 전수 소거한다(<f>는 보존 — Excel이 재계산)
console.log('④c 허브 영향 복합 수식 캐시 소거')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  const full = await buildFullRefGraph(zip, files)
  const affected = new Map<string, { sheet: string; cell: string }>()
  for (const c of HUB_INPUT_CELLS)
    for (const d of transitiveClosure(full, HUB, c)) affected.set(`${d.sheet}!${d.cell}`, d)
  const stale: Array<{ sheet: string; cell: string; value: null }> = []
  for (const [sheet, path] of files) {
    const xml = await zip.file(path)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (!affected.has(`${sheet}!${m[1]}`)) continue
      if (/<v>[\s\S]*?<\/v>|<is>/.test(m[2] ?? '')) stale.push({ sheet, cell: m[1], value: null })
    }
  }
  if (stale.length) {
    console.log(`   잔존 캐시 ${stale.length}칸 소거: ${stale.map(s => `${s.sheet}!${s.cell}`).join(', ')}`)
    const rc = await injectWorkbook(bytes, stale)
    if (rc.missed.length) throw new Error(`캐시 소거 실패: ${rc.missed.join(', ')}`)
    bytes = rc.bytes
  } else console.log('   잔존 캐시 0칸')
}

// ── ④e 표본 고객의 '답' 스크럽 (허브 밖 축) ──────────────────────────
// ④·④c의 축은 전부 `개요` 허브의 폐포다. 갑지는 실고객의 **완성 문서**라 별지 4호 쪽 시트에
// 허브와 무관한 답이 채워져 있었고, 그래서 기존 검사가 전부 초록인 채로 남의 설비 목록·점검
// 결과·수신기 위치·점검 소견이 전 고객 산출물에 인쇄됐다(2026-08-24 독립 판정 3인 교차 확인)
console.log('④e 표본 답 스크럽(허브 밖 — 별지 4호 설비·판정·세부현황·소견)')
{
  const w = XLSX.read(bytes, { cellFormula: true })
  const targets = SAMPLE_ANSWERS.map(s => {
    const c = w.Sheets[s.sheet]?.[s.cell] as XLSX.CellObject | undefined
    if (c === undefined) throw new Error(`④e 대상 없음: ${s.sheet}!${s.cell} — 갑지가 갱신됐다면 좌표를 재실측할 것`)
    if (c.f) throw new Error(`④e 대상이 수식이다: ${s.sheet}!${s.cell} f=${c.f} — 원천 리터럴을 고쳐야 한다`)
    const orig = String(c.v ?? '')
    const to = s.to(orig)
    // 바뀌지 않으면 좌표가 밀렸거나 이미 고쳐진 것 — 조용히 지나가면 다시 사각이 된다
    if (to !== null && to === orig) throw new Error(`④e 변화 없음: ${s.sheet}!${s.cell} = ${JSON.stringify(orig)}`)
    return { sheet: s.sheet, cell: s.cell, value: to }
  })
  const r = await injectWorkbook(bytes, targets)
  if (r.missed.length) throw new Error(`④e 미발견: ${r.missed.join(', ')}`)
  console.log(`   ${targets.length}칸 + 폐포 전파 ${r.propagated}칸`)
  bytes = r.bytes
}

// ── ④f 폐지(2026-08-25) ──────────────────────────────────────────────
// ④e가 고친 칸에서 **전체 참조 그래프**로 닿는 캐시를 전부 비우던 단계였는데, 실측해 보니
// 순 기여가 0이었다: ④f가 필요했던 8칸(현황!S7·AO13·S28·AO28 · 대상물!G11·N17·G32·N32)은
// 아래 ④g가 수식째 없애며 덮고, 대신 ④e가 **폐포로 올바르게 채운** `[  ]`·서식 문장 19칸
// (세3!C17·C18·C19·C21 · 세4!E12·E13 · 위임장!D2 · 대상물!B10·C11·I17·B32·I32 · 현1!C3 ·
//  현3!A8·A34 · 세1!B5·C4 · 세3!A17 · 세4!A12)을 **되지웠다** — 과잉 삭제였다.
// 없애면 그 19칸이 살아난다(제거 후 실측으로 확인).

// ── ④g 점검 판정 **수식** 제거 ────────────────────────────────────────
// 별지 4호 1쪽의 점검결과 칸은 서식 자체가 `IF(설치칸="[  ]","/","○")` 수식 64칸이다.
//
// ⚠ 종전엔 **캐시(`<v>`)만** 비우고 `<f>`를 보존했다("LibreOffice는 재계산하지 않으므로
//   캐시가 곧 인쇄물"이라는 D-9 공리에 기대). 그 공리는 **이 부류에 성립하지 않는다** —
//   LibreOffice는 파일을 여는 순간 이 수식을 재계산해 `/`·`○`를 되살린다(2026-08-25 실측
//   `scripts/_probe-xlsx-recalc.mts`). 그래서 '판정 마크 0칸'이라는 종전 보고는 **캐시 층만
//   잰 가짜 초록**이었고, 실제 인쇄물에는 전 고객에게 `／`(해당없음)가 찍히고 있었다.
//   SheetJS·XML 축으로는 재계산 결과가 영원히 보이지 않는다 — 축을 하나 더 둔 이유다.
//
// 이제 **수식 자체를 없앤다**. 설치 여부는 런타임 앵커(xlsx-form4 · 대장 실값)가 `[√]`로 찍고,
// 점검결과는 미설치일 때만 `/`를 찍는다 — 설치했다는 사실에서 `○`(양호)를 만들어내지 않는다.
// ⚠ 이 단계는 갑지 26시트에만 돈다(도너 이식 전). 도너의 세로 3연속 ○/×/／ 범례는
//    build-workbook-full의 몫이고 거기서 보존된다 — 축이 겹치지 않는다.
console.log('④g 점검 판정 수식 제거(설치=√ → 자동 ○ 차단)')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  // ⚠ 판정 수식을 지운 자리는 **빈 셀이 아니라 `=""`**로 둔다. 64칸 전부가 `대상물`·`대상물2`에
  //   `=현황!S7` 같은 **단일 참조 복제칸**을 하나씩 갖고 있어(실측 `_probe-form4-mirrors.mts`),
  //   원본을 통째로 비우면 복제칸이 **빈 셀 참조 = 0**으로 재계산돼 `0`이 인쇄된다.
  //   빈 문자열 셀(`<is><t/></is>`)로도 안 된다 — LibreOffice가 blank로 정규화한다
  //   (5종 표현 왕복 실측 `_probe-empty-repr.mts`: 살아남는 것은 `공백 1칸`과 `=""` 둘뿐).
  const targets: Array<{ sheet: string; cell: string }> = []
  for (const [sheet, path] of files) {
    const xml = await zip.file(path)!.async('string')
    // ⚠ 자기닫힘 <c …/>을 함께 받는다 — 안 받으면 수식이 앞 빈 셀 좌표로 귀속된다(xlsx-inject:86)
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
      if (!f) continue
      // 판정 마크를 **리터럴로 산출**하는 수식만. XML이라 따옴표는 &quot;로도 올 수 있다
      if (!/&quot;[○×X/／]&quot;|"[○×X/／]"/.test(f)) continue
      targets.push({ sheet, cell: m[1] })
    }
  }
  // 0칸이면 서식이 갱신됐거나 이 단계가 무력화된 것 — 조용히 지나가면 다시 사각이 된다
  if (targets.length === 0) throw new Error('④g 대상 0칸 — 갑지의 판정 수식 구조가 바뀌었다. 재실측할 것')
  console.log(`   판정 수식 ${targets.length}칸 → =""  (${[...new Set(targets.map(t => t.sheet))].join(', ')})`)
  bytes = await toEmptyFormula(bytes, targets)
}

// ── ④g-b 판정 마크 **캐시** 소거(복제칸) ─────────────────────────────
// ④g가 없앤 것은 판정을 **만들어내는** 수식이고, 그 결과를 **복제**하는 칸(대상물!G11 = `현황!S7`,
// 대상물2!F3 = `현황!S37` … 64칸)은 여전히 표본의 옛 캐시 '○'·'/'를 물고 있다.
// 종전에는 ④f(표본 답 폐포)가 우연히 이 캐시까지 쓸어 갔는데, ④f는 같은 비질로 ④e가 옳게 채운
// 서식 문장 19칸까지 되지웠다(순 기여 0·과잉 삭제). 그래서 ④f는 폐지하고, **필요한 것만** 여기서
// 정확히 겨눈다: 캐시만 비우고 `<f>`는 보존한다(복제 관계가 살아 있어야 런타임 전파가 닿는다).
console.log('④g-b 판정 마크 캐시 소거(복제칸)')
{
  const w = XLSX.read(bytes, { cellFormula: true })
  const VERDICT = new Set<string>(VERDICT_MARKS)
  const stale: Array<{ sheet: string; cell: string; value: null }> = []
  for (const s of w.SheetNames) {
    const ws = w.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const c = ws[k] as XLSX.CellObject
      if (!c.f) continue                       // 리터럴 판정 마크는 ⑥ 사후검증이 잡는다
      if (VERDICT.has(String(c.v ?? '').trim())) stale.push({ sheet: s, cell: k, value: null })
    }
  }
  if (stale.length) {
    console.log(`   복제 캐시 ${stale.length}칸 소거 (${[...new Set(stale.map(s => s.sheet))].join(', ')})`)
    const rgb = await injectWorkbook(bytes, stale)
    if (rgb.missed.length) throw new Error(`④g-b 소거 실패: ${rgb.missed.join(', ')}`)
    bytes = rgb.bytes
  } else console.log('   복제 캐시 0칸')
}

// ── ④g2 '참조되는 빈 칸'을 `=""`로 ───────────────────────────────────
// ④e가 표본 소견을 지운 현5!C4~C10은 계획서!H12~H24가 단일 참조로 복제한다(실측 1:1).
// 통째로 비웠더니 **빈 셀 참조 = 0**이 되어 전 고객 문서의 계획서에 `"0"`이 인쇄됐다
// (직전 커밋이 표본 '이상없음'을 지우면서 만든 회귀 — 결함을 다른 결함으로 바꿨던 셈이다).
// ④g와 같은 처방을 쓴다. 목록이 짧고 명시적인 이유: 개요 입력 칸처럼 **런타임이 값을 채우는**
// 칸에 `=""`를 두면 주입값이 재계산으로 지워진다 — 그러니 '전부 빈 칸'에 일괄 적용하면 안 된다.
// 여기 오는 칸은 (ⓐ 런타임 앵커가 아니거나 ⓑ 앵커가 dropFormula를 갖는) 칸뿐이다.
console.log('④g2 참조되는 빈 칸 → =""')
{
  const cells = ['C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'].map(cell => ({ sheet: '현5', cell }))
  const anchorNoDrop = new Set(ANCHORS.filter(a => !a.dropFormula).map(a => `${a.sheet}!${a.cell}`))
  const bad = cells.filter(c => anchorNoDrop.has(`${c.sheet}!${c.cell}`))
  if (bad.length) throw new Error(`④g2 대상이 dropFormula 없는 앵커다(주입값이 지워진다): ${bad.map(c => `${c.sheet}!${c.cell}`).join(', ')}`)
  bytes = await toEmptyFormula(bytes, cells)
  console.log(`   ${cells.length}칸`)
}

// ── ④h 셀 메모(comments) 파트 제거 ───────────────────────────────────
// 갑지에는 원 작성자의 **내부 업무 지시** 9건이 셀 메모로 박혀 있었다('이상없는 설비만 날짜를
// 지울것' · '보고서 제출일자 적을 것' · '숫자만 입력' 등). 셀 값·공유문자열 스캔에는 전혀 안
// 잡히는 별도 파트(xl/comments*.xml + vmlDrawing)인데 **LibreOffice가 렌더한다** — 즉 고객에게
// 배포되는 인쇄물에 사내 메모가 그려진다. 외부링크 파트(④d)와 같은 부류라 같은 규약으로 막는다:
// **파트 존재 자체를 금한다**(내용 니들이 아니라 존재로 판정 — 니들 목록은 다음 메모를 못 본다).
console.log('④h 셀 메모(comments) 파트 제거')
{
  const zip = await JSZip.loadAsync(bytes)
  const parts = Object.keys(zip.files).filter(n =>
    /xl\/(threadedComments\/)?comments\d*\.xml$/.test(n) || /vmlDrawing/.test(n) || /xl\/persons?\.xml$/.test(n))
  for (const p of parts) zip.remove(p)
  // 시트 본문의 <legacyDrawing>(메모 도형 앵커)과 워크시트 rels의 항목을 함께 거둔다 —
  // 남기면 없는 파트를 가리키는 고아 참조가 되어 뷰어가 파일을 거부할 수 있다
  let sheetsTouched = 0, relsTouched = 0
  const files = await sheetFileMap(zip)
  for (const [, path] of files) {
    const xml = await zip.file(path)!.async('string')
    if (!/<legacyDrawing\b/.test(xml)) continue
    zip.file(path, xml.replace(/<legacyDrawing[^>]*\/>/g, ''))
    sheetsTouched++
  }
  for (const name of Object.keys(zip.files)) {
    if (!/worksheets\/_rels\//.test(name)) continue
    const x = await zip.file(name)!.async('string')
    const y = x.replace(/<Relationship\b[^>]*Target="[^"]*(?:comments\d*\.xml|vmlDrawing\d*\.vml)"[^>]*\/>/g, '')
    if (y === x) continue
    zip.file(name, y)
    relsTouched++
  }
  let ct = await zip.file('[Content_Types].xml')!.async('string')
  ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/(?:threadedComments\/)?comments\d*\.xml"[^>]*\/>/g, '')
    .replace(/<Override\b[^>]*PartName="\/xl\/drawings\/vmlDrawing\d*\.vml"[^>]*\/>/g, '')
    .replace(/<Default\b[^>]*Extension="vml"[^>]*\/>/g, '')
  zip.file('[Content_Types].xml', ct)
  console.log(`   파트 ${parts.length}개 · legacyDrawing ${sheetsTouched}시트 · rels ${relsTouched}개 · Content_Types 정리`)
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④b LibreOffice가 파괴한 수식 복원 ────────────────────────────────
console.log('④b NUMBERSTRING 수식 복원(계약서 보수금액·잔금)')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  for (const r of RESTORE_FORMULAS) {
    const path = files.get(r.sheet)!
    let xml = await zip.file(path)!.async('string')
    const re = new RegExp(`<c r="${r.cell}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
    const m = re.exec(xml)
    if (!m) throw new Error(`수식 복원 대상 미발견: ${r.sheet}!${r.cell}`)
    const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
    const esc = r.formula.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    xml = xml.replace(re, `<c r="${r.cell}"${attrs} t="str"><f>${esc}</f></c>`)
    zip.file(path, xml)
  }
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④d 외부 통합문서 링크 파트 제거 ──────────────────────────────────
// 갑지는 예전 견적·양식 파일들과 연결돼 있던 흔적을 xl/externalLinks/*로 안고 있다. 그 안에는
// **타 고객 상호·직원 개인 휴대전화·내부 NAS 경로**가 캐시값과 rel Target에 박혀 있어(2026-08-23
// 독립 판정 실측 24건) 산출물마다 함께 배포된다. 셀·공유문자열 스캔에는 잡히지 않는 축이다.
// 참조하는 수식이 0건임을 먼저 실측했으므로(_fix27-extlinks-scan) 제거는 무손실이다.
console.log('④d 외부 통합문서 링크 파트 제거')
{
  const zip = await JSZip.loadAsync(bytes)
  const parts = Object.keys(zip.files).filter(n => n.includes('xl/externalLinks/'))
  // 안전 전제: 이 링크를 쓰는 수식이 하나라도 있으면 값이 죽으므로 지우지 않고 실패한다
  const files = await sheetFileMap(zip)
  const users: string[] = []
  for (const [sheet, path] of files) {
    const xml = await zip.file(path)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
      const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2])?.[1]
      if (f && /\[\d+\]/.test(f)) users.push(`${sheet}!${m[1]} = ${f.slice(0, 60)}`)
    }
  }
  if (users.length) {
    console.error(`   ❌ 외부링크 참조 수식 ${users.length}건 — 제거하면 값이 죽는다. 방침을 정한 뒤 다시 빌드할 것`)
    for (const u of users.slice(0, 10)) console.error(`      ${u}`)
    process.exit(1)
  }
  for (const p of parts) zip.remove(p)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  wbXml = wbXml.replace(/<externalReferences>[\s\S]*?<\/externalReferences>/g, '')
  zip.file('xl/workbook.xml', wbXml)
  // workbook rels·[Content_Types]에서 고아 항목 제거
  let rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  rels = rels.replace(/<Relationship\b[^>]*Target="externalLinks\/[^"]*"[^>]*\/>/g, '')
  zip.file('xl/_rels/workbook.xml.rels', rels)
  let ct = await zip.file('[Content_Types].xml')!.async('string')
  ct = ct.replace(/<Override\b[^>]*PartName="\/xl\/externalLinks\/[^"]*"[^>]*\/>/g, '')
  zip.file('[Content_Types].xml', ct)
  console.log(`   파트 ${parts.length}개 · <externalReferences> 블록 제거 (참조 수식 0건)`)
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④i 유효성 목록 어휘 통일 (소방계획서_32 D트랙 F-D1) ───────────────
// 기증 원본은 판정 목록을 ASCII `X`(U+0058)로 적는데 ERP의 resultMark()·PDF·별지 4호는
// 전부 `×`(U+00D7)다. 이 워크북은 **손으로 고쳐 쓰는 산출물**이라(route.ts 머리주석) 드롭다운이
// X를 내면 주입값 ×와 수기값 X가 한 열에 섞이고, dv가 errorStyle="stop"이라 사용자가 ×를
// 직접 칠 수도 없다. 「현황」의 판정 dv 65칸이 그 상태였고 **f4v_ 판정 앵커 45칸과 겹친다**
// — 도너 시트는 설치 설비만 남지만 현황은 **모든 고객 문서에 항상 실린다**(2026-08-30 독립 판정 D).
//
// ⚠ **왜 여기서 고치나**: 전체 워크북 빌드(build-workbook-full)는 '갑지 파트 바이트 불변'을
//   불변식으로 갖고 있다. 결함의 원천이 이 템플릿이므로 **원천에서** 고치고, 하류는 검증만 한다.
// ⚠ **왜 '전수'인가**: 종전 D-1 수리는 범례 탐지(세로 ○/／X 3연속) 위에서만 돌아
//   **범례 셀이 있는 시트만** 볼 수 있었다. 목록을 인라인으로 든 현황은 구조적으로 시야 밖이었고,
//   '범례 37곳'이라는 수치가 "37이 전부"라는 착시를 만들었다.
//   **탐지축이 못 보는 표면은 '없는 것'이 아니라 '안 센 것'이다.**
console.log('④i 유효성 목록 어휘 통일')
{
  const INJECT_MARKS = ['○', '×', '/'] as const   // resultMark()가 낼 수 있는 전부
  const zip = await JSZip.loadAsync(bytes)
  // ⚠ XLSX는 인라인 목록을 `<formula1>&quot;○,X,/&quot;</formula1>`처럼 **XML 이스케이프된
  //   따옴표**로 적는다. 리터럴 `"`만 찾으면 하나도 못 잡고, 그런데도 '불일치 0'이라 초록을 낸다
  //   (2026-08-30 내가 실제로 그렇게 만들었다 — 눈먼 검사가 통과를 보고했다). 아래 눈멂 가드 참조.
  const unquote = (inner: string): string[] | null => {
    const t = inner.trim()
    for (const q of ['&quot;', '"']) {
      if (t.startsWith(q) && t.endsWith(q) && t.length > q.length * 2 - 1) return t.slice(q.length, -q.length).split(',')
    }
    return null   // 셀 범위 참조 등 — 인라인 목록이 아니다
  }
  const isVerdictList = (items: string[]) => items.includes('○') && items.includes('/')
  const parts = Object.keys(zip.files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p))

  let dvTotal = 0, dvInline = 0, fixed = 0
  const fixedAt: string[] = []
  for (const p of parts) {
    const before = await zip.file(p)!.async('string')
    let dirty = false
    // 치환은 **함수 replacer**로만 — 목록에 `$`가 섞이면 문자열 replacer가 그룹으로 해석한다
    const after = before.replace(/(<dataValidation\b([^>]*)>[\s\S]*?<formula1>)([\s\S]*?)(<\/formula1>)/g,
      (whole, head: string, attrs: string, inner: string, tail: string) => {
        dvTotal++
        const items = unquote(inner)
        if (!items) return whole
        dvInline++
        if (!isVerdictList(items) || items.includes('×')) return whole
        const i = items.indexOf('X')
        if (i < 0) return whole
        items[i] = '×'
        fixed++; dirty = true
        fixedAt.push(`${p.split('/').pop()}(${/sqref="([^"]*)"/.exec(attrs)?.[1]?.slice(0, 40) ?? '?'})`)
        return `${head}&quot;${items.join(',')}&quot;${tail}`
      })
    if (dirty) zip.file(p, after)
  }
  // ⚠ 눈멂 가드 — 0건을 훑고 '불일치 0'이라 말하면 그게 곧 항진명제다. 무엇을 몇 개 보았는지 먼저 단언한다.
  if (dvTotal < 1) throw new Error(`④i 눈멂 — dv를 하나도 못 봤다(${dvTotal}). 파서를 먼저 볼 것`)
  if (dvInline < 1) throw new Error(`④i 눈멂 — 인라인 목록을 하나도 못 봤다. 따옴표 형태(&quot; vs ")를 볼 것`)

  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))

  // 닫힌 덮개 — 쓴 것을 되읽어 단언한다('썼다'와 '들어갔다'는 다른 축이다)
  {
    const back = await JSZip.loadAsync(bytes)
    const fails: string[] = []
    let verdictLists = 0
    for (const p of parts) {
      const x = await back.file(p)!.async('string')
      for (const m of x.matchAll(/<dataValidation\b([^>]*)>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/g)) {
        const items = unquote(m[2])
        if (!items || !isVerdictList(items)) continue
        verdictLists++
        const sq = /sqref="([^"]*)"/.exec(m[1])?.[1]?.slice(0, 40) ?? '?'
        const missing = INJECT_MARKS.filter(k => !items.includes(k))
        if (missing.length) fails.push(`dv(${sq}): 주입 어휘 ${missing.join(' ')} 가 목록에 없다 — ${items.join(',')}`)
        if (items.includes('X')) fails.push(`dv(${sq}): ASCII X 잔존 — ${items.join(',')}`)
      }
    }
    if (fails.length) throw new Error(`유효성 목록 어휘 불일치 ${fails.length}건:\n  ${fails.join('\n  ')}`)
    if (verdictLists < 1) throw new Error('④i 눈멂 — 판정 목록을 하나도 못 찾았다(현황이 최소 1건)')
    console.log(`   dv ${dvTotal}건 중 인라인 ${dvInline}건 · 판정 목록 ${verdictLists}건 · X→× ${fixed}건 수리${fixedAt.length ? ` [${fixedAt.join(' ')}]` : ''} · 불일치 0`)
  }
}

// ── ⑤ fullCalcOnLoad ────────────────────────────────────────────────
console.log('⑤ fullCalcOnLoad 부여')
{
  const zip = await JSZip.loadAsync(bytes)
  let wbXml = await zip.file('xl/workbook.xml')!.async('string')
  if (!wbXml.includes('fullCalcOnLoad')) {
    wbXml = wbXml.includes('<calcPr')
      ? wbXml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
      : wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
    zip.file('xl/workbook.xml', wbXml)
  }
  bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

// ── ④j 현5 불량 세부 14칸 wrapText 강제 (2026-09-01) ──────────────────
// 현5는 그룹당 1행 고정이라 ERP가 여러 불량을 **줄바꿈으로 접어** 넣는데, 그 칸들의 xf가
// wrapText="false"여서 Excel이 0x0A를 **네모(두부)로 그렸다**. 서식 자신은 접기를 전제하고
// 있었다 — 행 높이 ht="77.25"(헤더 36.75의 2배)이고 옆 라벨칸(A열)은 이미 true다.
// 위 ⑤의 fullCalcOnLoad와 함께 보면 축이 분명하다: 이 파일은 Excel에서 다시 계산·재배치된다.
// ⚠ 런타임이 아니라 여기서 고치는 이유 — 주입 시 styles.xml을 건드리면 test-xlsx-inject의
//   '주입 전후 styles.xml 바이트 동일' 불변식이 깨진다. 그 축을 이 수리로 약화시키지 않는다.
console.log('④j 현5 불량 세부 wrapText 강제')
{
  const zip = await JSZip.loadAsync(bytes)
  const { xml, changed } = forceWrapText(await zip.file('xl/styles.xml')!.async('string'), HYEON5_WRAP_XFS)
  console.log(`   wrapText ${changed}칸 (대상 xf ${HYEON5_WRAP_XFS.join(',')})`)
  if (changed > 0) {
    zip.file('xl/styles.xml', xml)
    bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  }
  // 닫힌 덮개 — 0건은 '이미 옳다'일 수도 있지만 **서식이 갱신돼 인덱스가 밀린 것**일 수도 있다.
  // 후자를 조용히 넘기면 두부가 되살아난다. 되읽어 실제 상태로 판정한다('썼다'≠'들어갔다').
  const back = await JSZip.loadAsync(bytes)
  const block = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(await back.file('xl/styles.xml')!.async('string'))![1]
  const xfs = [...block.matchAll(/<xf\s[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(x => x[0])
  const bad = HYEON5_WRAP_XFS.filter(i => !/<alignment[^>]*\swrapText="(?:true|1)"/.test(xfs[i] ?? ''))
  if (bad.length) {
    throw new Error(`④j 실패 — xf ${bad.join(',')}에 wrapText가 없다. 서식 갱신으로 인덱스가 밀렸을 수 있다: `
      + 'scripts/_p4-hyeon5-wrap.mts로 현5 B4:C10의 s= 를 재실측하고 HYEON5_WRAP_XFS를 갱신할 것')
  }
}

// ── 사후 검증 — 쓰기 전에 스스로 확인한다 ────────────────────────────
console.log('⑥ 사후 검증')
{
  const wb = XLSX.read(bytes, { cellStyles: true })
  const fails: string[] = []
  if (wb.SheetNames.length !== origWb.SheetNames.length)
    fails.push(`시트 수 ${origWb.SheetNames.length} → ${wb.SheetNames.length}`)
  if (mergeCount(wb) !== origMerges) fails.push(`병합 ${origMerges} → ${mergeCount(wb)}`)
  // 실고객 흔적 전수 부재 — 리터럴이든 캐시든 남으면 실패.
  // 니들 목록은 xlsx-anchors.ts SCRUB_NEEDLES 단일 원천 — 런타임 안전망(D-10)과 같은 축
  const NEEDLES = SCRUB_NEEDLES
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const n of NEEDLES) if (v.includes(n)) fails.push(`실고객 흔적 잔존: ${s}!${k} = ${v}`)
    }
  }
  // 원시 바이트 축 — 셀 값 스캔은 sharedStrings 고아 항목을 못 본다(.xlsx는 zip이라 셀에 안
  // 보여도 파트 안에 원문이 실린다 — 판정 실측 5건). 전 파트를 문자열로 풀어 니들 전수 검사
  {
    const zip = await JSZip.loadAsync(bytes)
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue
      const raw = await zip.file(name)!.async('string')
      for (const n of NEEDLES) if (raw.includes(n)) fails.push(`원시 바이트 니들 잔존: ${name} ⊃ '${n}'`)
    }
  }
  // ★ **고아 공유문자열 0** — 위 니들 검사는 **목록에 적힌 문자열만** 본다. 니들은 표본 고객
  // 하나만 인코딩하므로 직원 실명·자격번호처럼 목록 밖 원문은 통과했다. 실제로 앵커가 셀을
  // 덮은 뒤에도 그 셀이 가리키던 si가 참조 0으로 남아, **압축만 풀면 읽히는 상태로** 자산과
  // 전 산출물에 실려 나갔다(2026-08-30 독립 판정 C·D가 서로 다른 축에서 같은 결론).
  // 니들을 늘리는 대신 **구조**로 닫는다 — externalLinks를 '파트 존재 자체 금지'로 막은 규약과 같다.
  {
    const zip = await JSZip.loadAsync(bytes)
    const sstRaw = await zip.file('xl/sharedStrings.xml')?.async('string')
    if (sstRaw) {
      const referenced = new Set<number>()
      for (const name of Object.keys(zip.files)) {
        if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue
        const wx = await zip.file(name)!.async('string')
        for (const m of wx.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          if (!/\st="s"/.test(m[1] ?? '')) continue
          const v = /<v>(\d+)<\/v>/.exec(m[2] ?? '')
          if (v) referenced.add(Number(v[1]))
        }
      }
      const orphans: string[] = []
      let at = 0
      for (const m of sstRaw.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const i = at++
        const text = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
        if (referenced.has(i) || !text) continue
        orphans.push(`si${i}='${text.slice(0, 40)}'`)
      }
      if (orphans.length) fails.push(`고아 공유문자열 ${orphans.length}건 잔존: ${orphans.slice(0, 4).join(' · ')}`)
    }
  }
  // ★ **전 시트 덮개 불변식** — 앵커에 없는 **리터럴** 셀에 체크된 마크(√)가 하나라도 있으면 실패.
  // ④e의 SAMPLE_ANSWERS는 손목록이라 그 자체로는 다음 사각을 못 막는다. 막는 것은 이 불변식이다:
  // 갑지가 갱신돼 새 표본 답이 들어오면 목록이 아니라 **여기가** 먼저 붉어진다.
  // 종전 검사는 '정보·보고서·다수동일때' 3시트만 봐서 나머지 64시트의 √ 15칸이 영구히 안 보였다
  // (2026-08-24 독립 판정 3인 교차). 마크 정규식은 xlsx-anchors.MARK_CHECKED_RE 단일 원천 —
  // 두 파일에 복붙돼 있던 종전 정규식은 공백 1칸 `[ ]`를 양쪽 다 빠뜨려 사각을 공유했다.
  {
    const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
    for (const s of wb.SheetNames) {
      const ws = wb.Sheets[s]
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue
        const c = ws[k] as XLSX.CellObject
        // ⚠ **수식 캐시도 본다**(종전엔 `if (c.f) continue`로 건너뛰었다). 건너뛰면 캐시에 새로
        //   생긴 표본 답은 SAMPLE_ANSWERS 손목록에만 의존하게 돼, 이 불변식이 리터럴 축에서만
        //   참이 된다(2026-08-24 독립 판정). ④e·④f·④g 후 캐시 체크마크는 실측 0칸이다
        if (!MARK_CHECKED_RE.test(String(c.v ?? ''))) continue
        if (!anchored.has(`${s}!${k}`)) fails.push(`표본 답(√) 잔존: ${s}!${k}${c.f ? '(캐시)' : ''} = ${String(c.v).slice(0, 60)}`)
      }
    }
  }
  // 표본 점검 소견 — 마크가 아니라 자유 텍스트라 위 덮개에 안 걸린다. 템플릿(백지 서식)에는
  // 어떤 소견도 있어서는 안 된다 — 있으면 남의 판단이 전 고객 문서에 인쇄된다
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const n of SAMPLE_OPINION_NEEDLES) if (v.includes(n)) fails.push(`표본 소견 잔존: ${s}!${k} ⊃ '${n}'`)
    }
  }
  // 점검 판정 마크 — 리터럴이든 캐시든 갑지 26시트에 남으면 안 된다(④g). 남으면 설치 여부와
  // 무관하게 '해당없음'·'양호'가 전 고객 문서에 인쇄된다
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const t = String((ws[k] as XLSX.CellObject).v ?? '').trim()
      if ((VERDICT_MARKS as readonly string[]).includes(t)) fails.push(`판정 마크 잔존: ${s}!${k} = '${t}'`)
    }
  }
  // 허브 영향 셀(복합 수식 포함) 캐시 전무 — ④c가 소거한 부류가 되살아나면 여기서 붉어진다
  {
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    const full = await buildFullRefGraph(zip, files)
    const affected = new Set<string>()
    for (const c of HUB_INPUT_CELLS)
      for (const d of transitiveClosure(full, HUB, c)) affected.add(`${d.sheet}!${d.cell}`)
    for (const [sheet, path] of files) {
      const xml = await zip.file(path)!.async('string')
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        if (!affected.has(`${sheet}!${m[1]}`)) continue
        if (/<v>[\s\S]*?<\/v>|<is>/.test(m[2] ?? '')) fails.push(`허브 영향 셀 캐시 잔존: ${sheet}!${m[1]}`)
      }
    }
  }
  // 개요 입력 칸 전부 공란(완전 덮어쓰기 불변식의 템플릿 측).
  // ⚠ SheetJS로 보면 안 된다 — 캐시 없는 수식 셀을 v=0으로 돌려줘(실측: G9 등 6칸)
  //   '값 잔존'과 구별이 안 된다. XML에서 <v>·<is>의 실존 여부로 판정한다.
  {
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    const hubXml = await zip.file(files.get(HUB)!)!.async('string')
    for (const c of HUB_INPUT_CELLS) {
      const m = new RegExp(`<c r="${c}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(hubXml)
      const inner = m?.[1] ?? ''
      if (/<v>[\s\S]*?<\/v>|<is>/.test(inner)) fails.push(`개요!${c} 입력 칸에 값 잔존: ${inner.slice(0, 80)}`)
    }
  }
  // 외부링크 파트가 되살아나지 않았는가(④d) — 니들 목록으로는 못 잡는 축이라 **파트 존재 자체**를 금한다
  {
    const zip = await JSZip.loadAsync(bytes)
    const left = Object.keys(zip.files).filter(n => n.includes('xl/externalLinks/'))
    if (left.length) fails.push(`외부링크 파트 잔존 ${left.length}개: ${left.slice(0, 3).join(', ')}`)
    const wbXml = await zip.file('xl/workbook.xml')!.async('string')
    if (/<externalReference/.test(wbXml)) fails.push('workbook.xml <externalReference> 잔존')
  }
  // ★ **재계산 축**(④g) — 판정 마크를 산출하는 수식이 하나도 없는가.
  //   캐시 검사(위 '판정 마크 잔존')는 `<f>`가 살아 있으면 **아무것도 지키지 못한다**: LibreOffice가
  //   열면서 재계산해 `/`·`○`를 만들어낸다. 캐시가 0이라는 사실과 인쇄물이 비어 있다는 사실은
  //   다른 명제다(2026-08-25 실측 — 종전 '판정 마크 0칸' 보고가 정확히 이 착각이었다).
  {
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    for (const [sheet, path] of files) {
      const xml = await zip.file(path)!.async('string')
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
        if (f && /&quot;[○×X/／]&quot;|"[○×X/／]"/.test(f))
          fails.push(`판정 산출 수식 잔존: ${sheet}!${m[1]} = ${f.slice(0, 60)}`)
      }
    }
  }
  // 셀 메모(④h) — 내부 업무 지시가 배포본에 실려 LibreOffice가 렌더하던 축. **파트 존재 자체**를 금한다
  {
    const zip = await JSZip.loadAsync(bytes)
    const parts = Object.keys(zip.files).filter(n =>
      /xl\/(threadedComments\/)?comments\d*\.xml$/.test(n) || /vmlDrawing/.test(n))
    if (parts.length) fails.push(`셀 메모 파트 잔존 ${parts.length}개: ${parts.slice(0, 4).join(', ')}`)
    const orphan: string[] = []
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue
      const raw = await zip.file(name)!.async('string')
      if (/<legacyDrawing\b/.test(raw)) orphan.push(name)
      if (/Target="[^"]*(?:comments\d*\.xml|vmlDrawing\d*\.vml)"/.test(raw)) orphan.push(`${name}(rel)`)
    }
    if (orphan.length) fails.push(`메모 고아 참조 잔존: ${orphan.slice(0, 4).join(', ')}`)
  }
  // 별지 4호 1쪽 표(xlsx-form4)의 자기 검사 — 코드 오타 하나가 '그 설비는 영원히 미설치'가 된다
  {
    const errs = form4CodeErrors()
    if (errs.length) fails.push(`xlsx-form4 표 오류: ${errs.join(' | ')}`)
    // 표의 좌표가 서식에 실재하는가 — 없는 셀엔 주입할 수 없다
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    const xml = await zip.file(files.get(FORM4_SHEET)!)!.async('string')
    const absent = [
      ...FORM4_ROWS.flatMap(r => [r.cell, r.labelCell, ...(r.verdictCell ? [r.verdictCell] : [])]),
      ...FORM4_UNWIRED.flatMap(u => [u.cell, u.verdictCell]),
    ].filter(c => !new RegExp(`<c r="${c}"[ />]`).test(xml))
    if (absent.length) fails.push(`xlsx-form4 좌표가 ${FORM4_SHEET}에 없음: ${absent.join(', ')}`)
  }
  // 개요 **닫힌 덮개**(S3-4) — 값 보유 비수식 칸이 전부 (앵커 | 입력 칸 | 라벨) 셋 중 하나로 분류되는가.
  // 어느 목록에도 없는 칸은 '아무도 안 보는 값'이라 표본 잔재가 그대로 배포된다(N15 실사고)
  {
    const zip = await JSZip.loadAsync(bytes)
    const files = await sheetFileMap(zip)
    const hubXml = await zip.file(files.get(HUB)!)!.async('string')
    const covered = new Set([...HUB_INPUT_CELLS, ...HUB_LABEL_CELLS,
      ...ANCHORS.filter(a => a.sheet === HUB).map(a => a.cell)])
    for (const m of hubXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const body = m[3] ?? ''
      if (/<f[ >]/.test(body)) continue                       // 수식 셀은 폐포(D-9) 담당
      if (!/<v>[\s\S]*?<\/v>|<is>/.test(body)) continue        // 값 없음
      if (!covered.has(m[1])) fails.push(`개요!${m[1]} 미분류 값 칸 — HUB_INPUT_CELLS/HUB_LABEL_CELLS 중 하나로 분류할 것`)
    }
  }
  if (fails.length) {
    for (const f of fails) console.error(`   ❌ ${f}`)
    process.exit(1)
  }
  console.log(`   시트 ${wb.SheetNames.length} · 병합 ${mergeCount(wb)} · 실고객 흔적 0 · 개요 입력 칸 전부 공란 · 닫힌 덮개 성립 · 외부링크 0 · 판정 수식 0 · 메모 파트 0`)
  console.log(`   별지4호 1쪽: 배선 ${FORM4_ROWS.length}행(점검결과 ${FORM4_ROWS.filter(r => r.verdictCell).length}칸) · 미배선 ${FORM4_UNWIRED.length}칸`
    + (FORM4_CODES_WITHOUT_ROW.length ? ` · 서식에 줄 없는 표준 설비: ${FORM4_CODES_WITHOUT_ROW.join(', ')}` : ''))
}

// ── 산출 ─────────────────────────────────────────────────────────────
mkdirSync('templates', { recursive: true })
writeFileSync(OUT, bytes)
const finalWb = XLSX.read(bytes)
const manifest = {
  source: basename(SRC),
  builtAt: new Date().toISOString().slice(0, 10),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sheetCount: finalWb.SheetNames.length,
  mergeTotal: mergeCount(XLSX.read(bytes, { cellStyles: true })),
  note: '갑지 서식 갱신 시 npx tsx scripts/build-workbook-template.mts 재실행(Q-4) — 지문이 바뀌면 test-xlsx-anchors가 먼저 붉어진다',
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`\n✅ ${OUT} (${(bytes.length / 1024).toFixed(0)}KB) · ${MANIFEST}`)
console.log(`   sha256 ${manifest.sha256.slice(0, 16)}… · 시트 ${manifest.sheetCount} · 병합 ${manifest.mergeTotal}`)
