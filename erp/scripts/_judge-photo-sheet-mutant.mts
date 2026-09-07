/** 「불량사진」 검사가 항진명제가 아님을 보이는 돌연변이 판정 (소방계획서_46)
 *  실행: npx tsx --conditions=react-server scripts/_judge-photo-sheet-mutant.mts
 *
 *  test-photo-sheet.mts가 61개를 초록으로 통과했다는 사실만으로는 **그 검사가 무언가를 지키고
 *  있다**는 증거가 되지 않는다. 산출물을 일부러 망가뜨렸을 때 해당 축이 **반드시 빨강**이 되는지
 *  본다 — 여기서 초록이 나오면 그 검사는 아무것도 안 지키고 있던 것이다.
 *
 *  세 축은 전부 "파일은 정상 개봉되는데 조용히 틀린" 부류다:
 *   M1 localSheetId 재번호 누락 → 남의 인쇄영역이 적용된다
 *   M2 <drawing>을 <pageSetup> 앞으로 → LibreOffice는 통과하고 Excel만 복구 대화상자
 *   M3 cellXfs count 미갱신 → 위와 같음 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { buildDefectPhotoSheet, type DefectPhotoRow, type PhotoStorage } from '../src/lib/defect-photo-embed.ts'
import { insertSheetAfter, localNameMap } from '../src/lib/xlsx-sheet-surgery.ts'
import { DEFECT_SHEET } from '../src/lib/xlsx-anchors.ts'

let pass = 0, fail = 0
/** 돌연변이는 **잡혀야** 통과다 — caught=false면 그 검사는 아무것도 안 지킨다 */
const mutant = (name: string, caught: boolean) => {
  console.log(`  ${caught ? '✅ 잡힘' : '❌ 놓침'} ${name}`)
  caught ? pass++ : fail++
}

const base = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const bucket = new Map<string, Uint8Array>()
const store: PhotoStorage = {
  storage: {
    from: () => ({
      download: async (p: string) => bucket.has(p)
        ? { data: new Blob([bucket.get(p)!]), error: null } : { data: null, error: { message: '없음' } },
    }),
  },
}
const defects: DefectPhotoRow[] = []
for (let i = 0; i < 3; i++) {
  const b = `d${i}/b.jpg`, a = `d${i}/a.jpg`
  for (const [p, w, h] of [[b, 1200, 900], [a, 900, 1200]] as const) {
    bucket.set(p, new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer()))
  }
  defects.push({ defect_code: `C${i}`, defect_name: `불량${i}`, defect_detail: null, action_taken: null, photo_url: b, after_photo_url: a })
}
const built = (await buildDefectPhotoSheet(store, defects, base))!
const out = await insertSheetAfter(base, DEFECT_SHEET, built.part)
const zip = await JSZip.loadAsync(out.bytes)
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const sheetXml = await zip.file('xl/worksheets/sheetPhoto.xml')!.async('string')
const stylesXml = await zip.file('xl/styles.xml')!.async('string')

// ── 검사 축을 함수로 뽑아 정상본/돌연변이본에 **같은 축**을 건다 ──
const axisLocalSheetId = (xml: string) =>
  localNameMap(xml).filter(r => r.name === '_xlnm.Print_Area').every(r => r.sheet === r.refSheet)
const axisOrder = (xml: string) => {
  const at = ['<pageSetup', '<rowBreaks', '<drawing '].map(t => xml.indexOf(t)).filter(i => i >= 0)
  return at.every((v, i) => i === 0 || v > at[i - 1])
}
const axisXfCount = (xml: string) => {
  const m = /<cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/cellXfs>/.exec(xml)!
  const real = [...m[1].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].length
  return Number(/count="(\d+)"/.exec(m[0])![1]) === real
}

console.log('\n[0] 정상본에서는 세 축이 전부 초록이어야 한다(대조군)')
mutant('정상: localSheetId 축', axisLocalSheetId(wbXml))
mutant('정상: 요소 순서 축', axisOrder(sheetXml))
mutant('정상: cellXfs count 축', axisXfCount(stylesXml))

console.log('\n[1] 돌연변이 — 잡혀야 통과')
// M1: 재번호를 안 한 상태 = 삽입 전 lsi를 그대로 쓴 workbook.xml
{
  const noRenum = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, block =>
    block.replace(/(\blocalSheetId=")(\d+)(")/g, (_m, a: string, n: string, b: string) => {
      const v = Number(n)
      return v > out.index ? `${a}${v - 1}${b}` : `${a}${n}${b}`   // 증분을 되돌린다
    }))
  mutant('M1 localSheetId 재번호 누락', !axisLocalSheetId(noRenum))
}
// M2: <drawing>을 <pageSetup> 앞으로 옮긴다(스키마 위반 — Excel만 복구)
{
  const dr = /<drawing [^>]*\/>/.exec(sheetXml)![0]
  const moved = sheetXml.replace(dr, '').replace('<pageSetup', () => `${dr}<pageSetup`)
  mutant('M2 <drawing>이 <pageSetup> 앞', !axisOrder(moved))
}
// M3: count 속성만 옛 값으로 되돌린다
{
  const stale = stylesXml.replace(/<cellXfs count="(\d+)">/, (_m, n: string) => `<cellXfs count="${Number(n) - 3}">`)
  mutant('M3 cellXfs count 미갱신', !axisXfCount(stale))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
