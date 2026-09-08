/** sj_계획서.xlsx의 시트 XML에 **값 칸이 스타일과 함께 실재하는지** 확인 (읽기 전용).
 *  없으면 값만 꽂았을 때 테두리·글꼴이 빠진다 — 바이트 패치 전에 반드시 먼저 볼 것. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const zip = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx')))

console.log('── 엔트리 ──')
for (const n of Object.keys(zip.files)) console.log('  ' + n)

const wbXml = await zip.file('xl/workbook.xml')!.async('string')
console.log('\n── workbook.xml sheets ──')
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)) console.log(`  ${m[1]}  ${m[2]}`)
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
console.log('\n── rels ──')
for (const m of rels.matchAll(/Id="([^"]*)"[^>]*Target="([^"]*)"/g)) console.log(`  ${m[1]} -> ${m[2]}`)

/* 마지막 시트(소방안전관리계획 (3))를 찾는다 */
const target = process.argv[2] ?? 'xl/worksheets/sheet5.xml'
const xml = await zip.file(target)!.async('string')
console.log(`\n── ${target} (${xml.length}바이트) ──`)

const PROBE = ['I6', 'I8', 'Q10', 'AG10', 'O16', 'AJ16', 'I22', 'AD24', 'I36', 'AJ36', 'AD50', 'AG52']
for (const a of PROBE) {
  const re = new RegExp(`<c r="${a}"([^>]*)(/>|>)`)
  const m = xml.match(re)
  console.log(`  ${a.padEnd(5)} ${m ? `실재  속성:${m[1].trim() || '(없음)'}  ${m[2] === '/>' ? '빈칸' : '내용있음'}` : '❌ XML에 없다'}`)
}

/* 한 행 통째로 보여 실제 생김새 확인 */
const row6 = xml.match(/<row r="6"[\s\S]*?<\/row>/)
console.log(`\n── row 6 원문 (앞 700자) ──\n${row6 ? row6[0].slice(0, 700) : '없다'}`)
console.log(`\ninlineStr 사용 여부: ${xml.includes('t="inlineStr"')} · sharedStrings 존재: ${!!zip.file('xl/sharedStrings.xml')}`)
