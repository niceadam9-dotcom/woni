// 소방계획서_29 S2 — hex 클래스 센서스 (읽기 전용)
// (유틸리티 접두사, hex)별 건수 — 토큰 매핑 표의 원천. 실행: node scripts/_census-29-hex.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const ROOT = 'src'
const EXCLUDE = [join('src', 'lib', 'doc-templates')]   // 문서 HTML — 다크 제외 축(D-4)

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (EXCLUDE.some(e => p.startsWith(e))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.push(p)
  }
})(ROOT)

// util-[#hex] — 변형(hover: 등)은 별도 캡처, /불투명도 접미 포함
const RE = /((?:[a-z-]+:)*)([a-z]+(?:-[a-z]+)*)-\[#([0-9a-fA-F]{6})\](\/\d{1,3})?/g
const byPair = new Map()   // `${util}|${hex}` -> count
const byVariantPair = new Map()
let total = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(RE)) {
    const [, variants, util, hexRaw, opacity] = m
    const hex = '#' + hexRaw.toLowerCase()
    total++
    const k = `${util}|${hex}`
    byPair.set(k, (byPair.get(k) ?? 0) + 1)
    if (variants || opacity) {
      const vk = `${variants}${util}|${hex}${opacity ?? ''}`
      byVariantPair.set(vk, (byVariantPair.get(vk) ?? 0) + 1)
    }
  }
}

const rows = [...byPair.entries()].sort((a, b) => b[1] - a[1])
const out = [
  `total=${total} files=${files.length}`,
  '',
  '== util|hex counts (desc) ==',
  ...rows.map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
  '',
  '== variant/opacity samples ==',
  ...[...byVariantPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
]
writeFileSync('scripts/_census-29-hex.txt', out.join('\n'), 'utf8')

// hex별 합계 상위 40
const byHex = new Map()
for (const [k, n] of byPair) { const hex = k.split('|')[1]; byHex.set(hex, (byHex.get(hex) ?? 0) + n) }
const hexRows = [...byHex.entries()].sort((a, b) => b[1] - a[1])
console.log(`total=${total} distinct_hex=${byHex.size}`)
for (const [hex, n] of hexRows.slice(0, 40)) {
  const utils = rows.filter(([k]) => k.endsWith('|' + hex)).map(([k, c]) => `${k.split('|')[0]}:${c}`).join(' ')
  console.log(`${String(n).padStart(5)}  ${hex}  ${utils}`)
}
const tail = hexRows.slice(40).reduce((s, [, n]) => s + n, 0)
console.log(`tail(41+): ${hexRows.length - 40} colors, ${tail} occurrences`)
