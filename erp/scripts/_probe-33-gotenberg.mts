/** 소방계획서_33 — 운영 Gotenberg 픽셀 육안용 HTML 생성.
 *  데이터는 _fixtures-doc-templates의 조작 픽스처(실고객 PII 없음).
 *  2차(작동)와 1차(종합) 두 벌을 뽑아 **대조**로 본다 — 한 벌만 보면
 *  '작동으로 찍힌다'와 '무엇을 넣든 작동으로 찍힌다'를 구별할 수 없다.
 *  실행: npx tsx scripts/_probe-33-gotenberg.mts
 */
import { mkdirSync, writeFileSync } from 'fs'
import { base9, coverOf } from './_fixtures-doc-templates.mts'

const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')
const { renderCover } = await import('../src/lib/doc-templates/cover.ts')
const cast = <T,>(v: unknown) => v as T

const out = 'scripts/_out33'
mkdirSync(out, { recursive: true })

// 2차 = 작동점검 (픽스처 기본값이 이미 작동)
const op9 = { ...base9, ckOp: true, ckInitial: false, ckCompEtc: false }
// 1차 = 종합점검 (대조군)
const comp9 = { ...base9, ckOp: false, ckInitial: false, ckCompEtc: true }

const docs = [
  { key: 'report9-2nd-operational', html: renderReport9(cast<Parameters<typeof renderReport9>[0]>(op9), { highlight: false }) },
  { key: 'report9-1st-comprehensive', html: renderReport9(cast<Parameters<typeof renderReport9>[0]>(comp9), { highlight: false }) },
  { key: 'cover-2nd-operational', html: renderCover(cast<Parameters<typeof renderCover>[0]>({ ...coverOf(null, null), typeLabel: '작동점검' })) },
  { key: 'cover-1st-comprehensive', html: renderCover(cast<Parameters<typeof renderCover>[0]>({ ...coverOf(null, null), typeLabel: '종합점검' })) },
]

for (const d of docs) {
  writeFileSync(`${out}/${d.key}.html`, d.html, 'utf8')
  const hangul = (d.html.match(/[가-힣]/g) || []).length
  console.log(`${d.key.padEnd(28)} ${String(d.html.length).padStart(7)}B  한글 ${String(hangul).padStart(5)}자`)
}
console.log(`\n출력: ${out}/`)
