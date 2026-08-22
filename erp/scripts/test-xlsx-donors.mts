/** 설비별 점검표 이식 자산·선별 수술 검증 (소방계획서_27 Phase 5 / S10 — 무서버)
 *  실행: npx tsx scripts/test-xlsx-donors.mts
 *
 *  고정하는 것:
 *  ① 자산 지문 — manifest(sha256·시트 수·baseSha256)와 실물·기저 manifest 일치. 갑지·전체 보고서가
 *     갱신되면 여기가 먼저 붉어진다(Q-4: build-workbook-template.mts → build-workbook-full.mts 순 재실행)
 *  ② 매핑 완결성 — facility 그룹의 matchKey가 전부 SHEET_FACILITY_MAP 실키(어휘가 갈라지면 선별이
 *     조용히 어긋난다) · 도너 시트 전수 실재 · 목차 본문 칸(DONOR_TOC_BODY_CELLS) 전수 XML 실재 +
 *     칸 밖 잔여 항목 없음(스테일 목차 가드) · verifyToc 라벨이 템플릿 목차 실값과 일치
 *  ③ 🚨 표본 흔적 0 — 도너에 박혀 있던 점검결과 마크(범례 세로 ○→/→X 3연속만 보존)·갑지 니들·
 *     전화/주민 패턴
 *  ④ 제거 수술 — 전 도너 제거(목차 제외) 후에도 열리고, 목록 3곳에 고아 항목이 없다
 *  ⑤ 선별 규칙 — 기타는 상시, 스프링클러 설치가 간이스프링클러를 끌어오지 않는다(오검 방지 축),
 *     다중이용업소는 설비가 아니라 multiUse 플래그 축 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { DONOR_GROUPS, DONOR_TOC_SHEET, DONOR_TOC_BODY_CELLS, allDonorSheets, donorGroupsToKeep } from '../src/lib/xlsx-donors.ts'
import { SHEET_FACILITY_MAP, sheetMatchesFacilities } from '../src/lib/sheet-facility-map.ts'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'
import donorManifest from '../src/lib/xlsx-donor-manifest.json' with { type: 'json' }
import baseManifest from '../src/lib/xlsx-template-manifest.json' with { type: 'json' }

const FULL = 'templates/report-workbook-full.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const bytes = new Uint8Array(readFileSync(FULL))
const wb = XLSX.read(bytes, { cellStyles: true })
const DONORS = allDonorSheets()                       // 목차 + 그룹 시트 전부
const GROUP_SHEETS = DONOR_GROUPS.flatMap(g => g.sheets)

console.log('[1] 자산 지문(manifest 대조)')
check('sha256 일치', createHash('sha256').update(bytes).digest('hex') === donorManifest.sha256)
check('baseSha256 = 기저 manifest sha256(짝 고정)', donorManifest.baseSha256 === baseManifest.sha256)
check('시트 수', wb.SheetNames.length === donorManifest.sheetCount, `${wb.SheetNames.length}`)
check('기저 + 도너(목차 포함)', wb.SheetNames.length === baseManifest.sheetCount + DONORS.length,
  `${baseManifest.sheetCount}+${DONORS.length}`)
check('donorSheetCount 정합', donorManifest.donorSheetCount === DONORS.length,
  `${donorManifest.donorSheetCount}/${DONORS.length}`)

console.log('[2] 매핑 완결성')
{
  const missing = DONORS.filter(n => !wb.SheetNames.includes(n))
  check('도너 시트 전수 실재', missing.length === 0, missing.join(', '))
  const badKey = DONOR_GROUPS.filter(g => g.kind === 'facility' && !(g.matchKey in SHEET_FACILITY_MAP)).map(g => g.matchKey)
  check('facility matchKey 전수가 SHEET_FACILITY_MAP 실키', badKey.length === 0, badKey.join(', '))
  const dup = GROUP_SHEETS.filter((n, i) => GROUP_SHEETS.indexOf(n) !== i)
  check('도너 시트명 중복 없음', dup.length === 0, dup.join(', '))

  // 목차 본문 칸 — 없는 셀 삽입은 불가(S0-5)라 상수의 전 칸이 XML에 실재해야 주입이 성립한다
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  const tocXml = await zip.file(files.get(DONOR_TOC_SHEET)!)!.async('string')
  const absent = DONOR_TOC_BODY_CELLS.filter(c => !new RegExp(`<c r="${c}"[ />]`).test(tocXml))
  check(`목차 본문 칸 ${DONOR_TOC_BODY_CELLS.length}칸 전수 XML 실재`, absent.length === 0, absent.join(', '))
  // 칸 밖 A열 잔여 항목 = 런타임 재작성이 못 지우는 스테일 목차 — 있으면 상수 재실측
  const tocWs = wb.Sheets[DONOR_TOC_SHEET]
  const bodySet = new Set(['A1', ...DONOR_TOC_BODY_CELLS])
  const stale = Object.keys(tocWs).filter(k => /^A\d+$/.test(k) && !bodySet.has(k)
    && String((tocWs[k] as XLSX.CellObject).v ?? '').trim())
  check('본문 칸 밖 A열 잔여 항목 0(스테일 가드)', stale.length === 0, stale.join(', '))
  // verifyToc 라벨 = 템플릿 목차 실값(도너 원본 그대로) — 상수가 어긋나면 재작성 목차가 원문과 갈라진다
  const tocVals = new Set(Object.keys(tocWs).filter(k => !k.startsWith('!'))
    .map(k => String((tocWs[k] as XLSX.CellObject).v ?? '').trim()))
  const badLabel = DONOR_GROUPS.filter(g => g.verifyToc && !tocVals.has(g.tocLabel.trim())).map(g => g.tocLabel)
  check('verifyToc 라벨 전수가 목차 실값과 일치', badLabel.length === 0, badLabel.join(' | '))
  check('넘침은 최대 1건(그룹 수 - 본문 칸)', DONOR_GROUPS.length - DONOR_TOC_BODY_CELLS.length <= 1,
    `${DONOR_GROUPS.length}/${DONOR_TOC_BODY_CELLS.length}`)
}

console.log('[3] 표본 흔적 0(마크·니들·전화/주민 패턴)')
{
  const MARK_RE = /^[○×X/／]$/     // 빌드(build-workbook-full ④)와 같은 축
  const leaks: string[] = []
  for (const n of GROUP_SHEETS) {
    const ws = wb.Sheets[n]
    const val = (k: string) => String((ws[k] as XLSX.CellObject | undefined)?.v ?? '').trim()
    // 범례(세로 ○→/→X 3연속, 시트당 ≤1곳)는 양식의 일부라 보존 대상
    const legend = new Set<string>()
    for (const k of Object.keys(ws).filter(k => !k.startsWith('!'))) {
      const { c, r } = XLSX.utils.decode_cell(k)
      if (val(k) === '○'
        && val(XLSX.utils.encode_cell({ c, r: r + 1 })) === '/'
        && val(XLSX.utils.encode_cell({ c, r: r + 2 })) === 'X') {
        for (const dr of [0, 1, 2]) legend.add(XLSX.utils.encode_cell({ c, r: r + dr }))
      }
    }
    if (legend.size > 3) leaks.push(`${n} 범례 후보 복수(${legend.size / 3}곳)`)
    for (const k of Object.keys(ws).filter(k => !k.startsWith('!'))) {
      const v = val(k)
      if (MARK_RE.test(v) && !legend.has(k)) leaks.push(`${n}!${k} 마크 '${v}'`)
    }
  }
  for (const n of DONORS) {
    const ws = wb.Sheets[n]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      for (const nd of SCRUB_NEEDLES) if (v.includes(nd)) leaks.push(`${n}!${k} 니들`)
      if (/\d{2,3}-\d{3,4}-\d{4}|\d{6}-[1-4]\d{6}/.test(v)) leaks.push(`${n}!${k} 전화·주민 의심`)
    }
  }
  check('도너 전 시트 흔적 0(범례만 잔존)', leaks.length === 0, leaks.slice(0, 5).join(' · '))
  // 도너 서식이 강등되지 않았다 — '소' 시트의 병합·스타일 다양성으로 실증
  const styledKinds = new Set(Object.keys(wb.Sheets['소']).filter(k => !k.startsWith('!'))
    .map(k => (wb.Sheets['소'][k] as XLSX.CellObject & { s?: unknown }).s).filter(Boolean)).size
  check('도너 시트 병합 실재(서식 생존 방증)', (wb.Sheets['소']['!merges'] ?? []).length >= 5,
    `병합 ${(wb.Sheets['소']['!merges'] ?? []).length} · 스타일 표본 ${styledKinds}`)
}

console.log('[4] 제거 수술 — 전 그룹 시트 제거(목차 제외) 후 정합')
{
  const { bytes: cut } = await removeSheets(bytes, GROUP_SHEETS)
  const wbCut = XLSX.read(cut)
  check('기저+목차만 남음', wbCut.SheetNames.length === baseManifest.sheetCount + 1, `${wbCut.SheetNames.length}`)
  check('기저 시트 생존 — 개요·공문·위임장', ['개요', '공문', '위임장'].every(n => wbCut.SheetNames.includes(n)))
  const zip = await JSZip.loadAsync(cut)
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const ctXml = await zip.file('[Content_Types].xml')!.async('string')
  const danglingRel = [...relsXml.matchAll(/Target="(worksheets\/[^"]+)"/g)].filter(m => !zip.file(`xl/${m[1]}`)).map(m => m[1])
  check('rels 고아 0', danglingRel.length === 0, danglingRel.join(', '))
  const danglingCt = [...ctXml.matchAll(/PartName="\/(xl\/worksheets\/[^"]+)"/g)].filter(m => !zip.file(m[1])).map(m => m[1])
  check('[Content_Types] 고아 0', danglingCt.length === 0, danglingCt.join(', '))
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  // ⚠ definedName에도 name="자탐1" 같은 것이 있다(기저 갑지의 깨진 이름 981건 부류 — 무해 실측).
  //   유령 판정은 <sheet> 항목 축으로만 본다
  const ghost = GROUP_SHEETS.filter(n => wbXml.includes(`<sheet name="${n}"`))
  check('workbook.xml 유령 시트 0', ghost.length === 0, ghost.join(', '))
}

console.log('[5] 선별 규칙(donorGroupsToKeep)')
{
  const by = (codes: string[], multiUse = false) =>
    donorGroupsToKeep(k => sheetMatchesFacilities(k, codes), multiUse)
  const none = by([])
  check('설비 0·비다중 → 기타만(상시)', none.length === 1 && none[0].kind === 'always')
  const ext = by(['소화기구 및 자동소화장치'])
  check('소화기구 → 소 그룹 + 기타', ext.length === 2 && ext[0].sheets[0] === '소')
  // 명시 매핑 축 — 퍼지였다면 '스프링클러설비'가 간이·조기진압까지 끌어오던 오검(2026-07-25 실측)
  const sp = by(['스프링클러설비'])
  check('스프링클러가 간이스프링클러를 끌어오지 않음',
    sp.some(g => g.sheets[0] === '스1') && !sp.some(g => g.sheets[0] === '간1'))
  const mu = by([], true)
  check('multiUse → 다중 그룹 편입(설비 축 아님)', mu.some(g => g.sheets[0] === '다중1')
    && !by([], false).some(g => g.kind === 'multiUse'))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
