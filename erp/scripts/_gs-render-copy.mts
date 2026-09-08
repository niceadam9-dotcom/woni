/** 렌더 전용 사본 — 대상 시트만 남긴다(그래야 PDF 1쪽이 곧 그 서식이다).
 *
 *  workbook.xml의 <sheet> 목록에서 대상만 남긴다. 시트 XML 파일과 rels는 **지우지 않는다** —
 *  목록에서 빠지면 열리지 않을 뿐이고, 지웠다가 rels가 고아가 되는 쪽이 더 위험하다.
 *  스타일·병합은 손대지 않으므로 모양은 원본 그대로다. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import JSZip from 'jszip'

const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교'

async function keepOnly(src: string, sheetName: string, dst: string) {
  const zip = await JSZip.loadAsync(readFileSync(src))
  const wbx = await zip.file('xl/workbook.xml')!.async('string')
  const all = [...wbx.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0])
  const keep = all.filter(s => new RegExp(`name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(s))
  if (keep.length !== 1) throw new Error(`시트 «${sheetName}» 를 ${keep.length}개 찾음 (전체 ${all.length}개)`)
  let out = wbx
  for (const s of all) if (s !== keep[0]) out = out.replace(s, '')
  // 활성 탭이 지워진 시트를 가리키면 열 때 경고가 뜬다 — 0으로 되돌린다
  out = out.replace(/activeTab="\d+"/, 'activeTab="0"').replace(/firstSheet="\d+"/, 'firstSheet="0"')
  zip.file('xl/workbook.xml', out)
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  console.log(`  ${sheetName} 만 남김 (원래 ${all.length}시트) → ${dst}`)
}

await keepOnly(join(OUT, 'A_sj격자_강순기_서식1.1.xlsx'), '소방안전관리계획 (3)', join(OUT, 'render_A.xlsx'))
await keepOnly(join(OUT, 'B_리포형식_강순기_서식1.1.xlsx'), '1.1 건축물 일반현황', join(OUT, 'render_B.xlsx'))
await keepOnly(join(OUT, 'C_체크박스생성_강순기_서식1.1.xlsx'), '소방안전관리계획 (3)', join(OUT, 'render_C.xlsx'))
