/** 기저 시트 제거 수술 — 「다수동일때」·「다수동」을 빼도 남의 인쇄영역이 붙지 않는다 (2026-10-06)
 *
 *  사용자: 「보고서엑셀 > 다수동 일때 다수동 탭 입력값이 없으면 엑셀탭이 만들필요없어」.
 *  두 시트는 기저 26장 안(3번·6번)이라 지우면 definedName@localSheetId(순서 인덱스) 수백 건이
 *  밀린다. 재번호를 빠뜨리면 파일은 멀쩡히 열리고 **다른 시트에 남의 인쇄영역**이 붙는다.
 *
 *  단언: ①두 시트가 사라진다 ②그 시트 소속 이름(12+13)만 사라진다 ③**남은 모든 이름이 원래
 *  시트에 그대로 붙어 있다**(전수 — 옛 인덱스의 시트명 = 새 인덱스의 시트명) ④Print_Area 자기검증
 *  (ref 앞 시트명 = 소속 시트) ⑤인덱스 범위 밖 0 ⑥도너만 빼면 definedNames 바이트 불변(종전 동작)
 *  ⑦SheetJS로 다시 열린다
 *  실행: npx tsx --conditions=react-server scripts/test-remove-base-sheets.mts */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery.ts'
import { allDonorSheets, DONOR_TOC_SHEET } from '../src/lib/xlsx-donors.ts'

const bytes = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

type Name = { lsi: number; name: string; ref: string }
async function read(b: Uint8Array) {
  const wb = await (await JSZip.loadAsync(b)).file('xl/workbook.xml')!.async('string')
  const sheets = [...wb.matchAll(/<sheet\s[^>]*\/>/g)].map(m => /\sname="([^"]*)"/.exec(m[0])![1])
  const block = /<definedNames>[\s\S]*?<\/definedNames>/.exec(wb)?.[0] ?? ''
  const names: Name[] = [...block.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
    .filter(m => /localSheetId=/.test(m[1]))
    .map(m => ({ lsi: Number(/localSheetId="(\d+)"/.exec(m[1])![1]), name: /\bname="([^"]*)"/.exec(m[1])![1], ref: m[2] }))
  return { sheets, names, block }
}

const before = await read(bytes)
const TARGETS = ['다수동', '다수동일때']
console.log('── 전제 ──')
check('두 시트가 기저에 있다(3·6번)', before.sheets.indexOf('다수동일때') === 3 && before.sheets.indexOf('다수동') === 6,
  `${before.sheets.indexOf('다수동일때')}·${before.sheets.indexOf('다수동')}`)
const own = before.names.filter(n => TARGETS.includes(before.sheets[n.lsi]))
const after6 = before.names.filter(n => n.lsi > 3)
check('지울 시트 소속 이름이 실재한다(공허 통과 방지)', own.length >= 20, `${own.length}건`)
check('밀릴 이름이 실재한다(재번호 대상)', after6.length >= 400, `${after6.length}건`)

console.log('── 기저 시트 2장 제거 ──')
const out = (await removeSheets(bytes, TARGETS)).bytes
const aft = await read(out)
check('두 시트가 사라졌다', TARGETS.every(t => !aft.sheets.includes(t)) && aft.sheets.length === before.sheets.length - 2)
check('그 시트 소속 이름만 사라졌다', aft.names.length === before.names.length - own.length, `${before.names.length}→${aft.names.length} (−${own.length})`)
// ③ 전수 — 문서 순서가 보존되므로 소속 이름을 뺀 before 목록과 after 목록을 줄 맞춤한다
const kept = before.names.filter(n => !TARGETS.includes(before.sheets[n.lsi]))
const moved = kept.filter((n, i) => {
  const a = aft.names[i]
  return !a || a.name !== n.name || a.ref !== n.ref || aft.sheets[a.lsi] !== before.sheets[n.lsi]
})
check('🚨 남은 이름 전부가 원래 시트에 붙어 있다(전수)', kept.length === aft.names.length && moved.length === 0,
  moved.length ? `어긋남 ${moved.length}건 예: ${moved[0].name}@${before.sheets[moved[0].lsi]}` : `${kept.length}건`)
const pa = aft.names.filter(n => n.name === '_xlnm.Print_Area' && !n.ref.startsWith('#REF'))
check('Print_Area 자기검증 — ref 앞 시트명 = 소속 시트', pa.length > 0
  && pa.every(n => n.ref.replace(/^'|'?!.*$/g, '') === aft.sheets[n.lsi]),
  pa.map(n => `${aft.sheets[n.lsi]}:${n.ref.slice(0, 12)}`).join(' '))
check('인덱스 범위 밖 0', aft.names.every(n => n.lsi >= 0 && n.lsi < aft.sheets.length))
{
  const x = XLSX.read(out, { type: 'array' })
  check('SheetJS로 다시 열린다·두 시트 없음', !x.SheetNames.includes('다수동') && !x.SheetNames.includes('다수동일때') && x.SheetNames.includes('보고서'))
}

console.log('── 도너만 제거 = 종전 동작 ──')
{
  const donors = allDonorSheets().filter(s => s !== DONOR_TOC_SHEET).slice(0, 10)
  const d = await read((await removeSheets(bytes, donors)).bytes)
  check('definedNames 블록 바이트 불변', d.block === before.block, `도너 ${donors.length}장 제거`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
