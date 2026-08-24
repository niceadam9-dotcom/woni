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
import { HUB_INPUT_CELLS, HUB_LABEL_CELLS, SCRUB_NEEDLES, ANCHORS, MARK_CHECKED_RE } from '../src/lib/xlsx-anchors.ts'

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
  ...['C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'].map(cell => ({
    sheet: '현5', cell, to: () => null, why: '점검 소견(이상없음·별첨참조) — 표본 고객의 판단',
  })),
  { sheet: '완료보고서', cell: 'B20', to: () => null, why: '이행조치 결과 별첨참조 — 표본 답' },
]

/** LibreOffice가 파괴한 수식 복원 — NUMBERSTRING(한국어 Excel 전용)은 LO가 몰라 #REF!로
 *  바꿔 버린다(2026-08-21 실측: 원본 .xls엔 멀쩡히 있었다). 사용자의 실제 도구는 Excel이므로
 *  원본 수식을 되살린다 — J11·J14에 금액을 넣으면 한글 금액("일금 … 원정")이 자동으로 산다. */
const RESTORE_FORMULAS: Array<{ sheet: string; cell: string; formula: string }> = [
  { sheet: '계약서', cell: 'E11', formula: 'NUMBERSTRING(J11,1)&" 원정"' },
  { sheet: '계약서', cell: 'E14', formula: 'NUMBERSTRING(J14,1)&" 원정"' },
]

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

// ── ④f 표본 답에 딸린 복합 수식 캐시 소거 ────────────────────────────
// ④e가 고친 칸을 참조하는 **복합** 수식(현황!S7 = `IF(C6="[  ]","/","○")` 등)은 단일 참조
// 폐포 밖이라 옛 캐시 '○'(양호)·'/'가 그대로 남는다. LibreOffice는 재계산하지 않으므로
// 그 캐시가 곧 인쇄물이다 — 비운다(<f> 보존: Excel에서 열면 제대로 계산된다). ④c와 같은 수법,
// 다른 씨앗(허브가 아니라 ④e 대상)
console.log('④f 표본 답 파생 복합 수식 캐시 소거')
{
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  const full = await buildFullRefGraph(zip, files)
  const affected = new Map<string, { sheet: string; cell: string }>()
  for (const s of SAMPLE_ANSWERS)
    for (const d of transitiveClosure(full, s.sheet, s.cell)) affected.set(`${d.sheet}!${d.cell}`, d)
  const stale: Array<{ sheet: string; cell: string; value: null }> = []
  for (const [sheet, path] of files) {
    const xml = await zip.file(path)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (!affected.has(`${sheet}!${m[1]}`)) continue
      if (/<v>[\s\S]*?<\/v>|<is>/.test(m[2] ?? '')) stale.push({ sheet, cell: m[1], value: null })
    }
  }
  if (stale.length) {
    console.log(`   잔존 캐시 ${stale.length}칸 소거`)
    const rc = await injectWorkbook(bytes, stale)
    if (rc.missed.length) throw new Error(`④f 캐시 소거 실패: ${rc.missed.join(', ')}`)
    bytes = rc.bytes
  } else console.log('   잔존 캐시 0칸')
}

// ── ④g 점검 판정 마크 캐시 전수 소거 ─────────────────────────────────
// 별지 4호 1쪽의 점검결과 칸은 `IF(설치칸="[  ]","/","○")` 부류의 수식이고, 그 **캐시**가 곧
// 인쇄물이다(LibreOffice는 재계산하지 않는다). ④f는 ④e가 고친 칸에서 닿는 것만 비우는데,
// 표본이 **설치하지 않은** 설비의 칸은 이미 `[  ]`라 씨앗에 없고 캐시 '/'(해당없음)가 남는다.
// 그 결과 **실제로 설치한 고객에게도 '해당없음'이 인쇄**된다(2026-08-24 판정 실측).
// 설비 설치 여부는 이 파이프라인이 해석하지 않으므로(Phase 3) 판정 칸은 전부 비운다 —
// 백지 서식이 남의 판정보다 낫다. <f>는 보존하므로 Excel에서 열면 제대로 계산된다.
// ⚠ 이 단계는 갑지 26시트에만 돈다(도너 이식 전). 도너의 세로 3연속 ○/×/／ 범례는
//    build-workbook-full의 몫이고 거기서 보존된다 — 축이 겹치지 않는다.
console.log('④g 점검 판정 마크 캐시 소거(설치 여부 미해석 → 백지)')
{
  const w = XLSX.read(bytes, { cellFormula: true })
  const VERDICT = new Set(['○', '×', 'X', '/', '／'])
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
    console.log(`   판정 캐시 ${stale.length}칸 소거`)
    const rg = await injectWorkbook(bytes, stale)
    if (rg.missed.length) throw new Error(`④g 소거 실패: ${rg.missed.join(', ')}`)
    bytes = rg.bytes
  } else console.log('   판정 캐시 0칸')
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
        if (c.f) continue                       // 수식 캐시는 폐포(④e·④f)가 담당
        if (!MARK_CHECKED_RE.test(String(c.v ?? ''))) continue
        if (!anchored.has(`${s}!${k}`)) fails.push(`표본 답(√) 잔존: ${s}!${k} = ${String(c.v).slice(0, 60)}`)
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
      for (const n of ['이상없음', '별첨참조', '직원실']) if (v.includes(n)) fails.push(`표본 소견 잔존: ${s}!${k} ⊃ '${n}'`)
    }
  }
  // 점검 판정 마크 — 리터럴이든 캐시든 갑지 26시트에 남으면 안 된다(④g). 남으면 설치 여부와
  // 무관하게 '해당없음'·'양호'가 전 고객 문서에 인쇄된다
  for (const s of wb.SheetNames) {
    const ws = wb.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const t = String((ws[k] as XLSX.CellObject).v ?? '').trim()
      if (t === '○' || t === '×' || t === '/' || t === '／') fails.push(`판정 마크 잔존: ${s}!${k} = '${t}'`)
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
  console.log(`   시트 ${wb.SheetNames.length} · 병합 ${mergeCount(wb)} · 실고객 흔적 0 · 개요 입력 칸 전부 공란 · 닫힌 덮개 성립 · 외부링크 0`)
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
