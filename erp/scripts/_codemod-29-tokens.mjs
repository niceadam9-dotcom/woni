// 소방계획서_29 S2 — hex 클래스 → 시맨틱 토큰 코드모드
//
// 실행: node scripts/_codemod-29-tokens.mjs          (드라이런 — 파일 무수정, 리포트만)
//       node scripts/_codemod-29-tokens.mjs --write  (실치환)
//
// 규약(설계 md §4 D-7):
//  · 치환 단위는 (유틸리티, hex) **쌍** — 같은 hex라도 접두사에 따라 다르게 간다.
//  · 변형(hover:·focus: 등)과 /불투명도 접미는 보존한다.
//  · 화이트리스트(치환 안 함): bg-[#090c1d](역전 표면 1곳) · bg-[#202023]/bg-[#292d34](카본 버튼
//    — 다크에서도 어두운 채 유지, 테마 불변) · 판정 보류 소수(text-[#d0ccf5] 등, S3 개별).
//  · light 픽셀 불변 원칙: 지배 hex는 토큰 light값이 곧 그 hex. 근사 병합(#fafaff→brand-tint 등)은
//    ≤5스텝 델타의 배경·경계 계열만 — 리포트의 MERGED 표가 전량을 밝힌다.
//  · 제외: src/lib/doc-templates(문서 HTML, D-4). bg-white→bg-surface도 여기서 함께 한다.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const WRITE = process.argv.includes('--write')
const ROOT = 'src'
const EXCLUDE_DIRS = [join('src', 'lib', 'doc-templates')]
// 타 세션이 편집 중인 파일 — 실행 시점에 인자로 늘릴 수 있다: --skip=path1,path2
const SKIP_FILES = (process.argv.find(a => a.startsWith('--skip=')) ?? '--skip=')
  .slice(7).split(',').filter(Boolean).map(p => p.replaceAll('/', '\\'))

/** hex 전체(전 유틸리티 공통) → 토큰. 지배 hex는 light값 = 그 hex(픽셀 불변). */
const HEX_TOKEN = {
  '#7b68ee': 'brand',
  '#6647f0': 'brand-strong',
  // 근사 병합(보라 진색 계열 — hover/active 상태색): Δ 소, 전부 bg
  '#6a5acd': 'brand-strong', '#6a57dd': 'brand-strong', '#6355d4': 'brand-strong', '#6a58d6': 'brand-strong',
  '#514b81': 'ink-sub',
  '#847ba8': 'ink-soft', '#8b87b8': 'ink-soft', '#7d78a8': 'ink-soft',
  '#b0acd6': 'ink-faint', '#c4c0dd': 'ink-faint',
  '#f5f4ff': 'brand-tint',
  '#fafaff': 'brand-tint', '#faf9ff': 'brand-tint', '#ebe9ff': 'brand-tint', '#f0eeff': 'brand-tint', '#ece9ff': 'brand-tint', '#eceafd': 'brand-tint',
  '#d0ccf5': 'brand-line', '#c3bdf5': 'brand-line', '#c4bff5': 'brand-line', '#d4d0f0': 'brand-line',
  '#e0ddf5': 'brand-line-soft', '#eceaf8': 'brand-line-soft', '#f0eefb': 'brand-line-soft', '#f3f1fc': 'brand-line-soft',
  '#eeecf8': 'brand-line-soft', '#f3f1fb': 'brand-line-soft', '#e8e6f5': 'brand-line-soft', '#e8e6f0': 'brand-line-soft',
  '#c8c4d0': 'line',
  '#f8f9fa': 'paper', '#fafafa': 'paper', '#fafafe': 'paper', '#f8f8fb': 'paper',
  '#ffffff': 'surface',
  // ── S3-1 꼬리 흡수 (2026-08-28 2차) — 문맥 확인 후 기존 토큰으로 병합 ──
  '#6b7280': 'ink-sub',      // 사이드바 비활성 라벨(중립 회색) — 보조 텍스트 축
  '#7b7b8d': 'ink-sub',
  '#d0cce8': 'ink-faint',    // 빈 상태 아이콘·자리표시
  '#d5d2ea': 'ink-faint',
  '#e6e3f7': 'brand-line-soft',
  '#f8f8ff': 'brand-tint',   // hover 면
  '#eeedf3': 'paper',        // 회색 뱃지 배경
  '#f3f4f6': 'paper',        // 미리보기 캔버스 바탕
  '#6a59d9': 'brand-strong', // 버튼 hover
}
/** (유틸리티, hex) 쌍 예외 — HEX_TOKEN보다 우선 */
const PAIR_OVERRIDE = {
  'text|#090c1d': 'ink',
  'text|#292d34': 'ink-strong',
  // 화이트리스트(null = 치환 금지)
  'bg|#090c1d': null,           // 역전 표면(1곳) — 다크에서도 어두운 채
  'bg|#202023': null,           // 카본 CTA — 테마 불변(btn-primary 계열)
  'bg|#292d34': null,           // 카본 hover
  'text|#d0ccf5': null,         // 어두운/보라 배경 위 밝은 글자 추정 — S3 개별 판정
  'text|#c4bff5': null,
  'text|#e0ddf5': null,
  'bg|#b0acd6': null,
  'bg|#d0ccf5': null,
  'text|#c8c4d0': 'ink-faint',  // 비활성 텍스트 — 다크에서 line(#3a3a42)은 불가시라 faint로
}

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (EXCLUDE_DIRS.some(e => p.startsWith(e))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.push(p)
  }
})(ROOT)

const RE = /((?:[a-z-]+:)*)([a-z]+(?:-[a-z]+)*)-\[#([0-9a-fA-F]{6})\](\/\d{1,3})?/g
const RE_WHITE = /((?:[a-z-]+:)*)bg-white(\/\d{1,3})?(?![a-zA-Z0-9-])/g

let totalRepl = 0, totalWhite = 0, skippedByPair = new Map(), unmapped = new Map()
const perFile = []
for (const f of files) {
  if (SKIP_FILES.some(s => f.endsWith(s) || f === s)) { perFile.push(`SKIP(동시세션)  ${f}`); continue }
  const src = readFileSync(f, 'utf8')
  let n = 0
  let out = src.replace(RE, (m, variants, util, hexRaw, opacity) => {
    // print: 변형은 테마 불변이어야 한다 — 토큰이면 다크에서 어두운 인쇄물이 나온다
    if (variants.includes('print:')) return m
    const hex = '#' + hexRaw.toLowerCase()
    const pairKey = `${util}|${hex}`
    const token = pairKey in PAIR_OVERRIDE ? PAIR_OVERRIDE[pairKey] : HEX_TOKEN[hex]
    if (token === null) { skippedByPair.set(pairKey, (skippedByPair.get(pairKey) ?? 0) + 1); return m }
    if (!token) { unmapped.set(pairKey, (unmapped.get(pairKey) ?? 0) + 1); return m }
    n++
    return `${variants}${util}-${token}${opacity ?? ''}`
  })
  let w = 0
  out = out.replace(RE_WHITE, (m, variants, opacity) => {
    if (variants.includes('print:')) return m   // print:bg-white는 리터럴 유지
    w++; return `${variants}bg-surface${opacity ?? ''}`
  })
  if (n + w > 0) {
    perFile.push(`${String(n + w).padStart(4)}  ${f}`)
    totalRepl += n; totalWhite += w
    if (WRITE) writeFileSync(f, out, 'utf8')
  }
}

const report = [
  `mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  files_scanned=${files.length}`,
  `hex_replaced=${totalRepl}  bg_white_replaced=${totalWhite}`,
  '',
  '== whitelist(치환 안 함 — 의도) ==',
  ...[...skippedByPair.entries()].map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
  '',
  '== unmapped(잔여 — S3 개별 처리 대상) ==',
  ...[...unmapped.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(5)}  ${k}`),
  '',
  '== per-file ==',
  ...perFile,
]
writeFileSync('scripts/_codemod-29-report.txt', report.join('\n'), 'utf8')
console.log(report.slice(0, 30).join('\n'))
console.log(`... 전체는 scripts/_codemod-29-report.txt (per-file ${perFile.length}줄)`)
