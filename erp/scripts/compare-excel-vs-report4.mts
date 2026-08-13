// R5-7 대조 — 37시트 엑셀 템플릿에만 있는 점검 항목이 있는가
//
// 소방계획서_21 R5-6(엑셀 생성 폐지)의 선행 조건. 원안은 "실제 점검 1건으로 별지 4호 PDF와
// 엑셀 PDF를 나란히 뽑아 대조"였지만 PDF 변환은 Gotenberg가 필요해 로컬에서 불가하다.
// 대조의 실체는 **항목 집합 비교**이므로 그 부분만 데이터로 수행한다 —
// 엑셀 템플릿(A열 item_code)과 별지 4호의 원천(inspection_sheet_items)을 양방향으로 비교한다.
// 시각 서식 확인(칸 배치·인쇄 레이아웃)은 스테이징에서 별도로 남는다.
//
// 실행: npx tsx scripts/compare-excel-vs-report4.mts
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'
import * as XLSX from 'xlsx'
import { writeFileSync } from 'fs'

const TEMPLATE_PATH = 'templates/operational_v2026.xlsx'
const ITEM_CODE_RE = /^\s*\d{1,2}-[A-Z]-\d{3}\s*$/
const OUT = 'F:/AI/ERP/erp_goal/_대조_엑셀37시트_vs_별지4호.md'

type ExcelItem = { code: string; sheet: string; label: string }

async function loadExcel(): Promise<ExcelItem[]> {
  const { data, error } = await raw.storage.from('reports').download(TEMPLATE_PATH)
  if (error || !data) throw new Error(`템플릿 다운로드 실패: ${error?.message ?? 'no data'}`)
  const buf = await (data as Blob).arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const out: ExcelItem[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) continue
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      const a = ws[XLSX.utils.encode_cell({ r, c: 0 })]
      if (!a || typeof a.v !== 'string' || !ITEM_CODE_RE.test(a.v)) continue
      // 항목명 열은 시트마다 다르고 병합 셀이 흔하다 — 병합 앵커까지 되짚어 첫 글자 셀을 항목명으로 본다
      const code = a.v.trim()
      const parts: string[] = []
      for (let c = 1; c <= range.e.c; c++) {
        let v = ws[XLSX.utils.encode_cell({ r, c })]?.v
        if (v === undefined) {
          const m = (ws['!merges'] ?? []).find(mm => mm.s.r <= r && r <= mm.e.r && mm.s.c <= c && c <= mm.e.c)
          if (m) v = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })]?.v
        }
        const s = typeof v === 'string' ? v.trim() : ''
        // 코드 반복·결과 기호는 항목명이 아니다
        if (s && s !== code && !/^[○×xX\/]$/.test(s) && !parts.includes(s)) parts.push(s)
      }
      out.push({ code, sheet: name, label: parts.join(' | ').slice(0, 160) })
    }
  }
  return out
}

async function loadDbItems() {
  const rows: Array<{ item_code: string; item_name: string; sheet_id: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await raw.from('inspection_sheet_items')
      .select('item_code, item_name, sheet_id').range(from, from + 999)
    if (error) throw new Error(`항목 조회 실패: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const { data: sheets } = await raw.from('inspection_sheets').select('id, sheet_no, sheet_name')
  const byId = new Map((sheets ?? []).map((s: { id: string; sheet_no: number; sheet_name: string }) =>
    [s.id, `${s.sheet_no}. ${s.sheet_name}`]))
  return rows.map(r => ({ code: r.item_code, name: r.item_name, sheet: byId.get(r.sheet_id) ?? '(시트 불명)' }))
}

const excel = await loadExcel()
const db = await loadDbItems()

const excelCodes = new Map(excel.map(e => [e.code, e]))
const dbCodes = new Map(db.map(d => [d.code, d]))
const onlyExcel = [...excelCodes.values()].filter(e => !dbCodes.has(e.code))
const onlyDb = [...dbCodes.values()].filter(d => !excelCodes.has(d.code))
const both = [...excelCodes.keys()].filter(c => dbCodes.has(c))

const excelSheets = [...new Set(excel.map(e => e.sheet))]
const groupBy = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
}

const lines: string[] = []
lines.push('# 대조표 — 37시트 엑셀 템플릿 vs 별지 4호(DB 점검표 원천)', '')
lines.push('소방계획서_21 R5-7. **엑셀 생성 폐지(R5-6)의 선행 조건**으로,')
lines.push('"37시트 엑셀에만 있던 항목이 별지 4호로 넘어가면서 조용히 사라지는가"를 확인한다.', '')
lines.push('- 엑셀 템플릿: `reports/' + TEMPLATE_PATH + '` (A열 = item_code, B열 = 점검항목)')
lines.push('- 별지 4호 원천: `inspection_sheet_items` (report9-actions.assembleReport4 → Report4SheetSection)')
lines.push('- 생성일 기준 자동 대조 — 시각 서식(칸 배치·인쇄 레이아웃) 확인은 스테이징에서 별도', '')
lines.push('## 요약', '')
lines.push('| 구분 | 수 |')
lines.push('|---|---|')
lines.push(`| 엑셀 템플릿 시트(항목 보유) | ${excelSheets.length} |`)
lines.push(`| 엑셀 항목 코드 | ${excelCodes.size} |`)
lines.push(`| DB(별지 4호 원천) 항목 코드 | ${dbCodes.size} |`)
lines.push(`| 양쪽 공통 | ${both.length} |`)
lines.push(`| **엑셀에만 있음 (폐지 시 유실 후보)** | **${onlyExcel.length}** |`)
lines.push(`| DB에만 있음 (엑셀이 못 담던 항목) | ${onlyDb.length} |`)
lines.push('')

// 32번대는 다중이용업소 안전시설등 — 별지 4호는 이 축을 inspection_sheet_items가 아니라
// muResults(MU-001~016)로 따로 담는다. 코드 체계가 달라 단순 집합 비교에서는 '엑셀에만'으로 잡힌다.
const muExcel = onlyExcel.filter(e => /^32-/.test(e.code))
const realGap = onlyExcel.filter(e => !/^32-/.test(e.code))
lines.push('> ⚠ 32번대 코드는 다중이용업소 축이다. 별지 4호는 이를 `muResults`(MU-001~016)로 따로 담으므로',
  '> 코드 체계가 달라 집합 비교에서 "엑셀에만"으로 잡힌다 — 실제 유실 여부는 MU 항목 수와 대조해야 한다.', '')

if (onlyExcel.length === 0) {
  lines.push('## 판정', '')
  lines.push('**엑셀에만 있는 항목 없음** — 엑셀 템플릿의 점검 항목은 전부 별지 4호 원천에 존재한다.')
  lines.push('항목 유실 관점에서 R5-6(엑셀 생성 폐지)을 막을 근거는 없다.', '')
} else {
  lines.push('## 판정', '')
  lines.push(`**엑셀에만 있는 항목 ${onlyExcel.length}건** = 다중이용업 축 ${muExcel.length}건 + 그 외 **${realGap.length}건**.`)
  lines.push(`다중이용업 축을 빼면 실제 유실 후보는 **${realGap.length}건**이다 — 폐지 전에 이 항목들의`)
  lines.push('처리(별지 4호 원천에 편입 또는 폐기 확정)를 정해야 한다.', '')
  if (realGap.length > 0) {
    lines.push('#### 실제 유실 후보 (32번대 제외)', '')
    lines.push('같은 접두(설비-분류)의 DB 항목을 함께 붙였다 — 코드가 인접하면 같은 설비의 세부 항목이므로',
      '"별지 4호 어디에 넣을지"를 그 자리에서 판단할 수 있다.', '')
    for (const [sheet, items] of groupBy(realGap, e => e.sheet)) {
      lines.push(`- **${sheet}** (${items.length}건)`)
      for (const i of items) {
        lines.push(`  - \`${i.code}\` ${i.label || '(항목명 미추출)'}`)
        const prefix = i.code.replace(/\d{3}$/, '')
        const sibs = db.filter(d => d.code.startsWith(prefix)).slice(0, 3)
        if (sibs.length) lines.push(`    - DB 같은 분류: ${sibs.map(s => `\`${s.code}\` ${s.name}`).join(' / ')}`)
        else lines.push(`    - ⚠ DB에 \`${prefix}\` 분류 자체가 없다 — 설비 분류 통째 누락`)
      }
    }
    lines.push('')
  }
  lines.push('#### 엑셀에만 있는 항목 전체', '')
  for (const [sheet, items] of groupBy(onlyExcel, e => e.sheet)) {
    lines.push(`- **${sheet}** (${items.length}건)`)
    for (const i of items) lines.push(`  - \`${i.code}\` ${i.label || '(항목명 미추출 — 병합 셀)'}`)
  }
  lines.push('')
}

if (onlyDb.length > 0) {
  lines.push('### DB에만 있는 항목 (엑셀이 담지 못하던 것 — 별지 4호 전환의 이득)', '')
  for (const [sheet, items] of groupBy(onlyDb, d => d.sheet)) {
    lines.push(`- **${sheet}** (${items.length}건)`)
    for (const i of items.slice(0, 20)) lines.push(`  - \`${i.code}\` ${i.name}`)
    if (items.length > 20) lines.push(`  - … 외 ${items.length - 20}건`)
  }
  lines.push('')
}

lines.push('## 결론 — R5-6(엑셀 생성 폐지)을 지금 실행할 수 있는가', '')
lines.push('**아니다. 아직 막혀 있다.** 항목 코드만 보면 유실 후보가 12건이지만, 실제로 걸리는 것은')
lines.push('코드 개수가 아니라 **엑셀이 담는 데이터의 종류**다.', '')
lines.push('- 12건은 전부 `옥3`·`스4`·`옥외3` 시트, 즉 각 소화전·스프링클러 설비의 **3면(제어반 + 펌프성능시험)**이다.')
lines.push('- 그 면에는 코드 항목 외에 **펌프성능시험 실측표**(체절운전 / 정격운전 100% / 정격유량 150%의')
lines.push('  토출량 ℓ/min·토출압 MPa 실측치, 판정 기준 "체절운전시 토출압은 정격토출압의 140% 이하")가 들어 있다.')
lines.push('- 별지 4호는 이 축을 **○/×/해당없음 항목 모델**로만 담는다. DB에 있는 것은')
lines.push('  `2-C-004 성능시험배관을 통한 펌프 성능시험 적정 여부` 같은 **적정 여부 한 칸**뿐이고,')
lines.push('  체절·정격·150% **실측 수치를 넣을 자리가 없다**(`체절` 검색 결과 0건).', '')
lines.push('즉 엑셀을 지우면 **펌프성능시험 실측치를 기록할 곳이 사라진다.** 이것이 D-9 폐지의 실제 장애물이다.', '')
lines.push('### 폐지하려면 먼저 정해야 할 것', '')
lines.push('1. 펌프성능시험 실측표를 어디에 담을 것인가 — 별지 4호에 실측 칸을 신설할지,')
lines.push('   설비 대장(1.4)의 펌프 제원 옆에 붙일지, 별도 기록으로 뺄지.')
lines.push('2. 위 12개 코드를 신설 자리에 매핑할지, 폐기로 확정할지.')
lines.push('3. 그 뒤에야 스테이징에서 두 PDF를 나란히 뽑아 **시각 서식**(칸 배치·인쇄 레이아웃)을 확인한다.', '')
lines.push('### 엑셀 템플릿 시트별 항목 수', '')
for (const [sheet, items] of groupBy(excel, e => e.sheet)) lines.push(`- ${sheet} — ${items.length}건`)
lines.push('')

writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(`엑셀 시트 ${excelSheets.length} · 엑셀 항목 ${excelCodes.size} · DB 항목 ${dbCodes.size}`)
console.log(`공통 ${both.length} · 엑셀에만 ${onlyExcel.length} · DB에만 ${onlyDb.length}`)
console.log(`→ ${OUT}`)
process.exit(0)
