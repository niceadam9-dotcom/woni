/** 판정자 C — 대조군: **내가 직접 표본 답을 서식에 심어** 닫힌 덮개가 붉어지는지 본다.
 *  저장소 자산은 건드리지 않는다 — 격리 디렉터리에 복사본을 만들고, 그 안에서
 *  **구현자의 진짜 검사 바이너리**(scripts/test-xlsx-anchors.mts)를 cwd만 바꿔 돌린다.
 *  (판정기를 내가 다시 짜면 그건 내 로직을 검사하는 것이지 그들의 덮개를 검사하는 게 아니다)
 *
 *  실행: node node_modules/tsx/dist/cli.mjs scripts/_judge27g-c-c-plant.mts <케이스>
 *  케이스: none | mark | mark-mb | boxed | vletter | bare | paren */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'

const CASE = process.argv[2] ?? 'none'
const DEST = 'F:/AI/ERP/_g27c-ctl'
mkdirSync(`${DEST}/templates`, { recursive: true })
copyFileSync('templates/report-workbook.xlsx', `${DEST}/templates/report-workbook.xlsx`)

const PLANTS: Record<string, { sheet: string; text: string }> = {
  // 서식이 갱신돼 '아무도 목록에 안 적은 칸'에 표본 답이 새로 생긴 상황
  mark:    { sheet: '정보',       text: ' [√]철근콘크리트구조, [  ]철골구조' },
  'mark-mb': { sheet: '다수동일때', text: ' [√]직통(또는 피난계단) ( 1 개소 )' },
  // 같은 답이되 **표기가 다른** 경우 — 덮개의 마크 상수가 이 표기를 아는가
  boxed:   { sheet: '정보',       text: ' ☑철근콘크리트구조, ☐철골구조' },
  vletter: { sheet: '정보',       text: ' [V]철근콘크리트구조, [ ]철골구조' },
  bare:    { sheet: '정보',       text: ' √철근콘크리트구조,  철골구조' },
  paren:   { sheet: '정보',       text: ' (√)철근콘크리트구조, ( )철골구조' },
}

const src = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
if (CASE === 'none') {
  writeFileSync(`${DEST}/templates/report-workbook-full.xlsx`, src)
  console.log('무변경 복사(대조군 기준선)')
} else {
  const p = PLANTS[CASE]
  if (!p) throw new Error(`알 수 없는 케이스: ${CASE}`)
  const zip = await JSZip.loadAsync(src)
  // 시트 경로
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rels = new Map<string, string>()
  for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
    rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
  let path = ''
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const name = (/name="([^"]*)"/.exec(m[1])?.[1] ?? '').replace(/&amp;/g, '&')
    if (name === p.sheet) path = rels.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? ''
  }
  let xml = await zip.file(path)!.async('string')

  // 심을 자리 — **비어 있는 셀**을 고른다(라벨·앵커·수식을 건드리지 않으려고).
  // 값도 수식도 없는 <c r="..."/> 형태를 뒤에서부터 찾는다
  const anchored = new Set(ANCHORS.filter(a => a.sheet === p.sheet).flatMap(a => [a.cell, a.labelCell]))
  const empties = [...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)\/>/g)]
    .filter(m => !anchored.has(m[1]))
  if (!empties.length) throw new Error('빈 셀을 못 찾았다')
  const victim = empties[empties.length - 1]
  const esc = p.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  xml = xml.replace(victim[0], `<c r="${victim[1]}"${victim[2]} t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`)
  zip.file(path, xml)
  writeFileSync(`${DEST}/templates/report-workbook-full.xlsx`, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })))
  console.log(`심음: ${p.sheet}!${victim[1]} = ${JSON.stringify(p.text)}`)
}
