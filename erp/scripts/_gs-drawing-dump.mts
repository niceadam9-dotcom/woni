/** sj 템플릿의 도형 5개(사용자 말로는 **체크박스**)의 정체·위치·모양을 뜯어본다.
 *  재현 가능성을 판단하려면 '무엇을 재현해야 하는지'부터 알아야 한다. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const z = await JSZip.loadAsync(readFileSync('F:/AI/ERP/erp_goal/_doc01/sj_계획서.xlsx'))
const x = await z.file('xl/drawings/drawing1.xml')!.async('string')

console.log(`drawing1.xml ${x.length}바이트\n`)
console.log('── 네임스페이스/루트 ──')
console.log(x.slice(0, 300).replace(/></g, '>\n<'))

/* 앵커별로 뜯는다 */
const anchors = [...x.matchAll(/<xdr:(twoCell|oneCell|absolute)Anchor[\s\S]*?<\/xdr:\1Anchor>/g)]
console.log(`\n── 앵커 ${anchors.length}개 ──`)
for (const [i, a] of anchors.entries()) {
  const s = a[0]
  const name = s.match(/name="([^"]*)"/)?.[1] ?? '?'
  const from = s.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/)?.[1] ?? ''
  const to = s.match(/<xdr:to>([\s\S]*?)<\/xdr:to>/)?.[1] ?? ''
  const num = (blk: string, tag: string) => blk.match(new RegExp(`<xdr:${tag}>(-?\\d+)</xdr:${tag}>`))?.[1] ?? '?'
  const fc = +num(from, 'col'), fr = +num(from, 'row'), tc = +num(to, 'col'), tr = +num(to, 'row')
  const prst = s.match(/prstGeom prst="([^"]*)"/)?.[1] ?? '(없음)'
  const fill = s.match(/<a:solidFill>[\s\S]*?val="([0-9A-Fa-f]{6})"/)?.[1] ?? (/<a:noFill\/>/.test(s) ? 'noFill' : '?')
  const line = s.match(/<a:ln[^>]*>[\s\S]*?val="([0-9A-Fa-f]{6})"/)?.[1] ?? '?'
  const lnW = s.match(/<a:ln w="(\d+)"/)?.[1] ?? '(기본)'
  const txt = [...s.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1]).join('')
  const addrF = Number.isFinite(fc) && Number.isFinite(fr) ? XLSX.utils.encode_cell({ r: fr, c: fc }) : '?'
  const addrT = Number.isFinite(tc) && Number.isFinite(tr) ? XLSX.utils.encode_cell({ r: tr, c: tc }) : '?'
  console.log(`\n[${i}] ${name}  ${a[1]}Anchor`)
  console.log(`     ${addrF} → ${addrT}   도형=${prst}  채움=${fill}  선=${line} w=${lnW}  글자=${JSON.stringify(txt)}`)
  console.log(`     from: ${from.replace(/\s+/g, ' ').trim()}`)
  console.log(`     to  : ${to.replace(/\s+/g, ' ').trim()}`)
}

/* 진짜 폼 컨트롤(체크박스)인지 — ctrlProps / vmlDrawing 흔적 */
console.log('\n── 폼 컨트롤 흔적 ──')
const names = Object.keys(z.files)
console.log('ctrlProps:', names.filter(n => n.includes('ctrlProp')).join(', ') || '없음')
console.log('vmlDrawing:', names.filter(n => n.includes('vmlDrawing')).join(', ') || '없음')
console.log('activeX:', names.filter(n => n.toLowerCase().includes('activex')).join(', ') || '없음')
console.log('\n→ 판정:', names.some(n => n.includes('ctrlProp') || n.includes('vmlDrawing'))
  ? '엑셀 **폼 컨트롤 체크박스**(클릭 가능)'
  : '단순 **도형(직사각형)** — 클릭 상태값 없음, 눈으로만 체크박스')
