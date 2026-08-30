// 현5!A4:C10(결함 행 앵커)이 HEAD 자산과 내 재빌드 자산에서 어떻게 다른가 — 500 원인 규명.
// 실행: cd F:\AI\ERP\erp; node scripts/_probe-defect-anchor-diff.mjs
import { readFileSync } from 'fs'
import JSZip from 'jszip'

const A = { label: 'HEAD 자산', path: 'templates/report-workbook.xlsx' }
const B = { label: '내 재빌드', path: 'F:/AI/ERP/_32-assetbak/report-workbook.xlsx' }

async function dump(src) {
  const zip = await JSZip.loadAsync(readFileSync(src.path))
  const wb = await zip.file('xl/workbook.xml').async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
  const target = new Map()
  for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
  let part = null
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    if (m[1] === '현5') part = `xl/${target.get(m[2]).replace(/^\/?xl\//, '')}`
  }
  if (!part) return { label: src.label, err: '현5 시트 없음' }
  const x = await zip.file(part).async('string')
  const out = []
  for (let r = 3; r <= 11; r++) {
    for (const col of ['A', 'B', 'C']) {
      const m = new RegExp(`<c r="${col}${r}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(x)
      out.push({ ref: `${col}${r}`, exists: !!m, inner: m ? (m[2] ?? '(자기닫힘)').slice(0, 70).replace(/\s+/g, ' ') : '—' })
    }
  }
  return { label: src.label, part, rows: out }
}

const a = await dump(A), b = await dump(B)
console.log(`${a.label}: ${a.part ?? a.err}`)
console.log(`${b.label}: ${b.part ?? b.err}\n`)
console.log('셀       HEAD존재 재빌드존재  HEAD내용 / 재빌드내용')
for (let i = 0; i < a.rows.length; i++) {
  const x = a.rows[i], y = b.rows[i]
  const diff = x.exists !== y.exists || x.inner !== y.inner
  if (!diff) continue
  console.log(`${x.ref.padEnd(6)} ${String(x.exists).padEnd(8)} ${String(y.exists).padEnd(9)}  ${x.inner}\n${''.padEnd(26)}${y.inner}`)
}
console.log('\n(위에 아무것도 없으면 두 자산의 현5 결함행이 동일하다)')
