/* 배포 실물 검증 — 운영 컨테이너에서 꺼낸 자산에 직접 판정 술어를 건다 (소방계획서_32 F-D1)
 *
 * 왜 로컬 파일이 아니라 이걸 보나: 해시 일치만으로도 논리적으로는 충분하지만, 그것은
 * '내가 빌드한 것과 같다'는 진술이지 '지금 서비스되는 파일이 옳다'는 직접 진술은 아니다.
 * 축을 하나 더 세운다 — **운영에서 꺼낸 바이트**를 열어 dv 어휘를 실제로 읽는다.
 *
 * 실행: cd F:\AI\ERP\erp; node scripts/_probe-prod-asset-dv.mjs [경로]
 *   기본 F:/AI/ERP/_prod-asset.xlsx (docker cp + scp로 받아온 것)
 */
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import JSZip from 'jszip'

const PATH = process.argv[2] ?? 'F:/AI/ERP/_prod-asset.xlsx'
const INJECT_MARKS = ['○', '×', '/']

let pass = 0, fail = 0
const ck = (l, ok, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

const bytes = readFileSync(PATH)
console.log(`대상: ${PATH} (${bytes.length}바이트)`)
console.log(`sha256: ${createHash('sha256').update(bytes).digest('hex')}`)

const zip = await JSZip.loadAsync(bytes)
const wb = await zip.file('xl/workbook.xml').async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const target = new Map()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1], m[2])
const nameByPart = new Map()
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = target.get(m[2]); if (t) nameByPart.set(`xl/${t.replace(/^\/?xl\//, '')}`, m[1])
}

const unquote = (inner) => {
  const t = inner.trim()
  for (const q of ['&quot;', '"']) {
    if (t.startsWith(q) && t.endsWith(q) && t.length > q.length * 2 - 1) return t.slice(q.length, -q.length).split(',')
  }
  return null
}
const isVerdict = (items) => items.includes('○') && items.includes('/')

const parts = Object.keys(zip.files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
let dvTotal = 0, inline = 0, verdict = 0
const bad = []
const found = []
for (const p of parts) {
  const x = await zip.file(p).async('string')
  const label = nameByPart.get(p) ?? p
  for (const m of x.matchAll(/<dataValidation\b([^>]*)>[\s\S]*?<formula1>([\s\S]*?)<\/formula1>/g)) {
    dvTotal++
    const items = unquote(m[2])
    if (!items) continue
    inline++
    if (!isVerdict(items)) continue
    verdict++
    const sq = /sqref="([^"]*)"/.exec(m[1])?.[1] ?? '?'
    const cells = sq.split(/\s+/).reduce((n, r) => {
      const mm = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(r)
      return n + (mm ? (mm[3] ? (+mm[4] - +mm[2] + 1) : 1) : 0)
    }, 0)
    found.push(`${label} sqref≈${cells}칸 목록=[${items.join(',')}] codepoints=[${items.map(i => [...i].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')).join(' ')}]`)
    const missing = INJECT_MARKS.filter(k => !items.includes(k))
    if (missing.length) bad.push(`${label}(${sq}): 주입 어휘 ${missing.join(' ')} 없음`)
    if (items.includes('X')) bad.push(`${label}(${sq}): ASCII X(U+0058) 잔존`)
  }
}

console.log(`\n판정 목록 ${verdict}건:`)
for (const f of found) console.log(`   ${f}`)
console.log('')
// 눈멂 가드 먼저 — 무엇을 몇 개 보았는가
ck(`dv ${dvTotal}건을 실제로 훑었다`, dvTotal >= 40, String(dvTotal))
ck(`인라인 목록 ${inline}건·판정 목록 ${verdict}건 발견`, inline >= 2 && verdict >= 1, `inline=${inline} verdict=${verdict}`)
ck('배포 실물의 판정 목록이 주입 어휘(○ × /)를 전부 담는다 — ASCII X 0', bad.length === 0, bad.join(' | '))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
