/** 설비별 점검표 항목 좌표 매핑 검증 (소방계획서_32 D트랙 / 30 S5-5 — 무서버)
 *  실행: npx tsx scripts/test-xlsx-itemmap.mts
 *
 *  이 검사가 존재하는 이유: 점검표 응답이 엑셀에 **하나도 안 실리는데 기존 검사가 전부 초록**이었다
 *  (2026-08-29 사용자 신고). 앵커·주입·충실도·E2E 어느 것도 '넣었어야 할 것이 빠졌나'를 본 적이
 *  없었기 때문이다. 그래서 여기서는 **역방향**(자산에 줄이 없는 항목 수)을 핀으로 붙든다.
 *
 *  고정하는 것:
 *   [1] 커밋된 맵 == 배포 자산에서 재도출한 맵 (순서까지 — 집합 비교는 뒤바뀜을 못 본다)
 *   [2] 결과열 축 — J열 시트를 **이름으로** 명시 단언. 개수만 세면 다른 시트가 J가 돼도 통과한다
 *   [3] 매핑 좌표 전수가 자산에서 실재·공란 (표본 답이 남아 있으면 남의 점검결과를 인쇄한다)
 *   [4] 🔴 역방향 커버리지 — DB 점검표 항목 중 자산에 줄이 없는 코드 수가 핀과 일치
 *   [5] 항목명 3중 축 — 도너 행 문구 ↔ DB item_name. **정답을 몰라도** 좌표·코드 결속을 검증한다
 *   [6] 규약 — 런타임(src/app)이 추출기를 임포트하지 않는다(런타임 XML 파싱 금지) */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { extractDonorItemMap, readCells } from '../src/lib/xlsx-donor-itemmap-extract.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'
import itemmap from '../src/lib/xlsx-donor-itemmap.json' with { type: 'json' }
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const ASSET = 'templates/report-workbook-full.xlsx'
/** 2026-08-29 실측 핀 — 바꿀 일이 생기면 **의도적으로** 고칠 것(자동 갱신 금지) */
const PIN = {
  codes: 720, colC: 33, colJ: 4, jSheets: ['옥3', '스4', '옥외3', '다중1'],
  /** DB 카탈로그에 있는데 자산에 줄이 없는 항목 — 자산 확충(27 S10-2)이 되면 줄어든다 */
  uncovered: 428,
  /** 자산에만 있고 카탈로그엔 없는 코드 — 고시 서식이 더 넓은 것은 정상 */
  assetOnly: 213,
}

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const bytes = new Uint8Array(readFileSync(ASSET))
const zip = await JSZip.loadAsync(bytes)
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(x => [x[1], x[2]]))
const donorNames = new Set(allDonorSheets())
const sheets: Array<{ name: string; xml: string }> = []
for (const x of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (!donorNames.has(x[1])) continue
  sheets.push({ name: x[1], xml: await zip.file('xl/' + relMap.get(x[2])!.replace(/^\/?xl\//, ''))!.async('string') })
}

console.log('[1] 커밋된 맵 == 자산 재도출')
const ex = extractDonorItemMap(sheets)
{
  check('추출 실패 0건', ex.failures.length === 0, ex.failures.slice(0, 4).join(' · '))
  check(`assetSha256이 실물과 일치`, itemmap.assetSha256 === createHash('sha256').update(bytes).digest('hex'),
    '자산이 갱신됐다 — build-workbook-full.mts 재실행 필요')
  // 순서까지 대조 — 집합만 보면 두 좌표가 뒤바뀐 것을 못 본다
  const fromAsset = ex.entries.map(e => `${e.code}=${e.sheet}!${e.cell}`)
  const fromJson = Object.entries(itemmap.cells as Record<string, string[]>).map(([c, v]) => `${c}=${v[0]}!${v[1]}`)
  const firstDiff = fromAsset.findIndex((v, i) => v !== fromJson[i])
  check(`엔트리 ${fromAsset.length}건이 순서까지 동일`, fromAsset.length === fromJson.length && firstDiff === -1,
    firstDiff >= 0 ? `#${firstDiff} 자산=${fromAsset[firstDiff]} json=${fromJson[firstDiff]}` : `${fromAsset.length} vs ${fromJson.length}`)
  check(`코드 수 ${PIN.codes} (핀)`, ex.entries.length === PIN.codes, String(ex.entries.length))
}

console.log('[2] 결과열 축 — C로 고정하면 항목 문구를 덮어쓴다')
{
  const cols = ex.resultCols
  const js = Object.entries(cols).filter(([, c]) => c === 'J').map(([s]) => s).sort()
  const cs = Object.values(cols).filter(c => c === 'C').length
  check(`C열 ${PIN.colC}시트 (핀)`, cs === PIN.colC, String(cs))
  // ⚠ 개수가 아니라 **이름**으로 — 개수만 세면 다른 시트가 J가 돼도 통과한다
  check(`J열은 정확히 ${PIN.jSheets.join('·')}`, JSON.stringify(js) === JSON.stringify([...PIN.jSheets].sort()), js.join(','))
  const other = [...new Set(Object.values(cols))].filter(c => c !== 'C' && c !== 'J')
  check('예상 밖 결과열 0', other.length === 0, other.join(','))
}

console.log('[3] 매핑 좌표가 자산에서 실재·공란')
{
  // 추출기의 F-4·F-5가 이미 보지만, 커밋된 **json 좌표** 기준으로 다시 본다(맵이 썩었을 수 있다)
  const bad: string[] = []
  const byName = new Map(sheets.map(s => [s.name, s.xml]))
  for (const [code, [sh, cl]] of Object.entries(itemmap.cells as Record<string, string[]>)) {
    const xml = byName.get(sh)
    if (!xml) { bad.push(`${code}: 시트 ${sh} 없음`); continue }
    if (!new RegExp(`<c\\s[^>]*\\br="${cl}"`).test(xml)) bad.push(`${code}: ${sh}!${cl} 셀 부재`)
  }
  check('매핑 좌표 전수 실재', bad.length === 0, bad.slice(0, 4).join(' · '))
  // ⚠ 값 읽기는 반드시 readCells로. 임시 정규식 `<c …>([\s\S]*?)</c>`는 **자기닫힘 셀**
  //   (`<c r="C4" s="734"/>`)에서 다음 셀의 </c>를 먹어 남의 값을 이 칸 것으로 오탐한다 —
  //   첫 판이 정확히 그래서 소!C4~C7을 '표본 답 잔존'으로 잘못 붉혔다(2026-08-29 자책).
  const valBySheet = new Map(sheets.map(s => [s.name, readCells(s.xml).val]))
  const dirty = Object.entries(itemmap.cells as Record<string, string[]>)
    .filter(([, [sh, cl]]) => ((valBySheet.get(sh)?.get(cl) ?? '').trim() !== ''))
  check('매핑 좌표 전수 공란(표본 답 잔존 0)', dirty.length === 0,
    dirty.slice(0, 4).map(([c, [sh, cl]]) => `${c}@${sh}!${cl}='${valBySheet.get(sh)!.get(cl)}'`).join(' · '))
}

console.log('[4] 역방향 커버리지 — 자산에 줄이 없는 항목(“빠진 것”의 축)')
{
  const { data, error } = await raw.from('inspection_sheet_items').select('item_code, item_name').limit(5000)
  if (error) { check('점검표 항목 카탈로그 조회', false, error.message) }
  else {
    const items = (data ?? []) as Array<{ item_code: string; item_name: string }>
    const mapped = new Set(Object.keys(itemmap.cells as Record<string, unknown>))
    const std = items.filter(i => /^\d{1,2}-[A-Z]-\d{3}$/.test(i.item_code))
    const uncovered = std.filter(i => !mapped.has(i.item_code))
    console.log(`     카탈로그 표준 항목 ${std.length} · 매핑 있음 ${std.length - uncovered.length} · 자산에 줄 없음 ${uncovered.length}`)
    // 0을 요구하지 않는다 — 자산이 확충되면(27 S10-2) 이 수가 줄고, 그때 핀을 갱신하며 성과를 기록한다
    check(`자산 미보유 항목 ${uncovered.length}건 = 핀 ${PIN.uncovered}`, uncovered.length === PIN.uncovered,
      `${uncovered.length} — 자산이 확충됐거나(27 S10-2) 카탈로그가 바뀌었다. 확인 후 핀 갱신`)
    // 반대 방향: 자산에는 줄이 있는데 DB 카탈로그에 없는 코드. 고시 서식이 카탈로그보다 넓은 것은
    // **정상**이다(그 칸은 응답이 없어 공란으로 남는다). 0을 요구하지 않고 핀으로 붙든다 —
    // 이 수가 갑자기 늘면 카탈로그가 줄었다는(=화면에서 항목이 사라졌다는) 신호다.
    const codeSet = new Set(std.map(i => i.item_code))
    const orphan = [...mapped].filter(c => !codeSet.has(c))
    check(`자산에만 있는 코드 ${orphan.length}건 = 핀 ${PIN.assetOnly}`, orphan.length === PIN.assetOnly,
      `${orphan.length}건: ${orphan.slice(0, 6).join(',')}`)

    console.log('[5] 항목명 3중 축 — 도너 문구 ↔ DB item_name')
    const nameByCode = new Map(items.map(i => [i.item_code, i.item_name]))
    const norm = (s: string) => s.replace(/^[○●·\s]+/, '').replace(/\s+/g, ' ').trim()
    const mism: string[] = []
    for (const e of ex.entries) {
      const dbName = nameByCode.get(e.code)
      if (!dbName || !e.itemText) continue
      if (norm(e.itemText) !== norm(dbName)) mism.push(`${e.code} 자산«${norm(e.itemText).slice(0, 26)}» DB«${norm(dbName).slice(0, 26)}»`)
    }
    console.log(`     대조 가능 ${ex.entries.filter(e => nameByCode.has(e.code) && e.itemText).length}건 · 불일치 ${mism.length}건`)
    // R-1(스1 A5 코드 중복)은 이 축으로 **정답을 몰라도** 잡힌다 — 코드가 가리키는 DB 이름과
    // 도너 행 문구가 어긋나기 때문이다.
    // ⚠ 상한을 200으로 두었던 것은 사각이었다(2026-08-30 판정 지적) — 실측 불일치가 0인데
    //   199건이 어긋나도 초록이라, 이 축이 잡으라고 세워진 R-1급 회귀가 그대로 통과했다.
    //   실측이 0이므로 0을 요구한다. 표기 차이로 새 불일치가 생기면 norm()에 규칙을 더할 것이지
    //   상한을 올려 덮지 말 것 — 그 순간 이 검사는 다시 장식이 된다.
    check(`항목명 불일치 0건 (실측 ${mism.length})`, mism.length === 0, mism.slice(0, 3).join(' | '))
  }
}

console.log('[6] 규약 — 런타임이 추출기를 임포트하지 않는다')
{
  // ⚠ `git grep`을 쓰면 안 된다 — 이 환경의 PATH에 git이 없어 예외가 나고, catch로 삼키면
  //   '히트 0'과 구별되지 않아 **가짜 초록**이 된다(2026-08-29 자책). 파일을 직접 훑는다.
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
    return out
  }
  const files = walk('src/app')
  check(`src/app ${files.length}파일을 실제로 훑었다(0이면 검사가 눈이 먼 것)`, files.length > 50, String(files.length))
  const hits = files.filter(f => readFileSync(f, 'utf8').includes('xlsx-donor-itemmap-extract'))
  check('src/app에서 추출기 임포트 0(런타임 XML 파싱 금지)', hits.length === 0, hits.join(', '))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
