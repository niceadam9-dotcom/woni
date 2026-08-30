/** S10-3 사전 실측 — 도너 시트의 결과칸 좌표축과 DB 응답의 매칭률
 *
 *  **세 축**을 각각 뽑아 교차 검증한다(한 축만 믿으면 손목록이 된다):
 *   ①A열 item_code 정규식  ②시트의 「점검결과」 헤더가 있는 **열**  ③dataValidation sqref
 *  두 축이 어긋나는 행이 곧 사각이다. 마지막에 실제 점검 건의 응답이 몇 칸에 닿는지 센다.
 *
 *  ⚠ 2026-08-29 교정 — 종전에는 결과열을 `C`로 **하드코딩**했다. 실측하면 넓은 서식 **4시트**
 *  (옥3·스4·옥외3·다중1)는 `A=번호, C=점검항목, J=점검결과(J:K 병합)`이라 C가 아니라 **J**다.
 *  (2026-08-30 정정: 종전 주석의 '5시트 … 간4'는 틀렸다. `간4`는 **실재하는 시트**이고 J3에
 *   「점검결과」 헤더도 있지만 A열 item_code가 0행이라 매핑에서 빠진다 — 결과열 축의 실측은 4시트다.
 *   32.json D2의 '간4는 존재하지 않는 시트' 문장도 같은 이유로 거짓이었다.)
 *  그 맵대로 주입하면 30칸의 **점검항목 문구를 마크로 덮어쓴다** — 파일은 정상 개봉되고
 *  missed=0이라 조용히 통과한다. 결과열은 반드시 헤더에서 도출할 것(소방계획서_32 C-1). */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

/** 서림사 2026-1차 (응답 243건) — 2026-08-29 사용자 신고 재현 대상 */
const INSP = process.env.INSP ?? '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'
const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(x => [x[1], x[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(x => ({ name: x[1], path: 'xl/' + relMap.get(x[2])!.replace(/^\/?xl\//, '') }))

const sst = await (async () => {
  const f = zip.file('xl/sharedStrings.xml'); if (!f) return [] as string[]
  const xml = await f.async('string')
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
})()

const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }
/** ⚠ 2열 이상 범위를 버리면 안 된다 — 결과칸이 `J4:K9`처럼 병합돼 있는 시트가 5개다.
 *  종전의 `if (m[1] !== m[3]) continue`가 그 시트들의 dv를 통째로 '결손'으로 만들었다(C-2 유령). */
const expandSqref = (sq: string): Set<string> => {
  const out = new Set<string>()
  for (const part of sq.trim().split(/\s+/)) {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(part)
    if (!m) continue
    if (!m[3]) { out.add(`${m[1]}${m[2]}`); continue }
    for (let c = colNum(m[1]); c <= colNum(m[3]); c++)
      for (let r = +m[2]; r <= +m[4]; r++) out.add(`${colName(c)}${r}`)
  }
  return out
}

let totalCells = 0, totalDv = 0, codeNoDv = 0, dvOnly = 0
const codeToCell = new Map<string, { sheet: string; cell: string }>()
const dupes: string[] = []
const resultCols = new Map<string, string>()
console.log('[도너 시트별 — ①A열 코드 · ②「점검결과」 헤더열 · ③dv sqref]')
for (const s of sheets) {
  const xml = await zip.file(s.path)!.async('string')
  // ⚠ 속성 순서를 가정하지 말 것 — LibreOffice 산출은 `<c s=".." r="A4" ..>`처럼 r=가 첫째가
  //   아닌 경우가 있어, `<c r="` 고정 정규식은 대부분의 셀을 조용히 놓친다(2026-08-29 실측)
  // ⚠ 자기닫힘(`<c r="C16" s="734"/>`)을 안 받으면 뒤 셀의 </c>를 먹어 값이 밀린다
  const val = new Map<string, string>()
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /(?:^|\s)r="([A-Z]+\d+)"/.exec(m[1])?.[1]
    if (!ref) continue
    const body = m[2] ?? ''
    let v: string
    // 도너는 빌드가 공유문자열을 **인라인 전개**했다(t="inlineStr") — <v> 축만 보면 전부 놓친다
    if (/t="inlineStr"/.test(m[1])) {
      v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
    } else {
      const vm = /<v>([^<]*)<\/v>/.exec(body)
      if (!vm) continue
      v = /t="s"/.test(m[1]) ? (sst[+vm[1]] ?? '') : vm[1]
    }
    val.set(ref, v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
  }

  // ① A열 코드행
  const aCodes: Array<[row: number, code: string]> = []
  for (const [ref, v] of val) {
    if (!/^A\d+$/.test(ref)) continue
    if (CODE_RE.test(v.trim())) aCodes.push([+ref.slice(1), v.trim()])
  }
  if (!aCodes.length) continue

  // ② 결과열 — 「점검결과」 헤더 셀의 열. 시트마다 정확히 1개여야 한다
  const heads = [...val].filter(([, v]) => v.trim() === '점검결과').map(([ref]) => ref)
  if (heads.length !== 1) {
    console.log(`  ${s.name.padEnd(10)} ⛔ 「점검결과」 헤더 ${heads.length}개 — 결과열을 정할 수 없다 (${heads.join(',')})`)
    continue
  }
  const rcol = /^([A-Z]+)/.exec(heads[0])![1]
  resultCols.set(s.name, rcol)

  // ③ dv 축 (결과열에 걸린 것만)
  const dvCells = new Set<string>()
  let brokenDv = 0
  for (const d of xml.matchAll(/<dataValidation[^>]*sqref="([^"]+)"[^>]*type="list"[^>]*>([\s\S]*?)<\/dataValidation>/g)) {
    const f1 = /<formula1>([\s\S]*?)<\/formula1>/.exec(d[2])?.[1] ?? ''
    if (f1.includes('#REF!')) { brokenDv++; continue }
    for (const c of expandSqref(d[1])) if (new RegExp(`^${rcol}\\d+$`).test(c)) dvCells.add(c)
  }
  const aCells = new Set(aCodes.map(([r]) => `${rcol}${r}`))
  const onlyA = [...aCells].filter(c => !dvCells.has(c))
  const onlyDv = [...dvCells].filter(c => !aCells.has(c))
  totalCells += aCells.size; totalDv += dvCells.size; codeNoDv += onlyA.length; dvOnly += onlyDv.length
  for (const [r, code] of aCodes) {
    if (codeToCell.has(code)) dupes.push(`${code} (${codeToCell.get(code)!.sheet} ↔ ${s.name}!${rcol}${r})`)
    else codeToCell.set(code, { sheet: s.name, cell: `${rcol}${r}` })
  }
  const flag = (onlyA.length || brokenDv) ? '  ⚠' : ''
  console.log(`  ${s.name.padEnd(10)} 결과열 ${rcol.padEnd(2)} · 코드행 ${String(aCells.size).padStart(3)} · dv칸 ${String(dvCells.size).padStart(3)}`
    + ` · 코드인데dv없음 ${onlyA.length} · dv만 ${onlyDv.length}${brokenDv ? ` · dv깨짐 ${brokenDv}` : ''}${flag}`
    + (onlyA.length ? `   =${onlyA.slice(0, 6).join(',')}` : ''))
}
const byCol = new Map<string, string[]>()
for (const [sheet, c] of resultCols) (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(sheet)
console.log(`\n결과열 분포: ${[...byCol].map(([c, ss]) => `${c}열 ${ss.length}시트`).join(' · ')}`)
for (const [c, ss] of byCol) if (ss.length <= 8) console.log(`   ${c}열: ${ss.join(', ')}`)
console.log(`합계: 코드행 ${totalCells} · dv칸 ${totalDv} · 코드인데dv없음 ${codeNoDv} · dv만(수기표 등) ${dvOnly}`)
console.log(`고유 item_code ${codeToCell.size}개${dupes.length ? ` · ⚠중복 귀속 ${dupes.length}건: ${dupes.slice(0, 5).join(' / ')}` : ' · 중복 귀속 0'}`)

// 실제 점검 건의 응답이 몇 칸에 닿는가
const { data } = await raw.from('inspection_sheet_responses')
  .select('item_code, result').eq('inspection_id', INSP).limit(2000)
const rows = (data ?? []) as Array<{ item_code: string; result: string }>
const hit = rows.filter(r => codeToCell.has(r.item_code))
const miss = rows.filter(r => !codeToCell.has(r.item_code))
console.log(`\n실제 점검 건 응답 ${rows.length}건 → 자산에 좌표 있는 것 ${hit.length} · 없는 것 ${miss.length}`)
if (miss.length) {
  const byPrefix = new Map<string, number>()
  for (const m of miss) { const p = m.item_code.split('-')[0]; byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1) }
  console.log(`  미착지 접두 분포: ${[...byPrefix].map(([p, n]) => `${p}번 ${n}건`).join(', ')}`)
  console.log(`  표본: ${miss.slice(0, 8).map(m => m.item_code).join(', ')}`)
}
const bySheet = new Map<string, number>()
for (const h of hit) { const s = codeToCell.get(h.item_code)!.sheet; bySheet.set(s, (bySheet.get(s) ?? 0) + 1) }
console.log(`  착지 시트: ${[...bySheet].map(([s, n]) => `${s} ${n}`).join(', ')}`)
