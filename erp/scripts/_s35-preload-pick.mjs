/** 소방계획서_35 S1-5 — preload 대상 서브셋 조각을 실측으로 고른다.
 *
 *  Pretendard dynamic-subset은 92조각이고 각 조각은 unicode-range로 갈린다.
 *  전부 preload하면 2.82MB를 통째로 받아 dynamic-subset의 의미가 없어지고,
 *  아무것도 안 하면 FOUT(맑은 고딕 → Pretendard 리플로우)가 밀집 표에서 보인다.
 *  → **실제 소방계획서 화면에 뜨는 한글**을 세어 상위 조각만 preload한다.
 *
 *  '추측하지 말고 세라'가 요점이다. 한글 상용 음절이 어느 조각에 있는지는
 *  코드포인트 내림차순 분할이라 직관과 다르다.
 *
 *  실행: node scripts/_s35-preload-pick.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CSS = 'src/app/pretendard.css'
const SRC = 'src/components/customers'

// ── 1. pretendard.css에서 조각별 unicode-range를 판독
const css = readFileSync(CSS, 'utf8')
const blocks = [...css.matchAll(/subset\.(\d+)\.woff2\)[^}]*?unicode-range:\s*([^;]+);/gs)]
if (blocks.length !== 92) {
  console.error(`FAIL: @font-face 조각이 92개가 아님 (${blocks.length}) — CSS 형식이 바뀌었다`)
  process.exit(1)
}
/** [{ idx, ranges: [[lo,hi], ...] }] */
const subsets = blocks.map(m => ({
  idx: Number(m[1]),
  ranges: m[2].split(',').map(s => {
    const t = s.trim().replace(/^U\+/i, '')
    const [a, b] = t.split('-')
    return [parseInt(a, 16), parseInt(b ?? a, 16)]
  }),
}))

function subsetOf(cp) {
  for (const s of subsets) for (const [lo, hi] of s.ranges) if (cp >= lo && cp <= hi) return s.idx
  return -1   // 어느 조각에도 없음 = Pretendard가 그리지 못한다
}

// ── 2. 소방계획서 화면 16파일의 한글 리터럴을 긁는다
const TARGETS = [
  ...readdirSync(SRC).filter(f => /^plan-form.*\.tsx$/.test(f)).map(f => join(SRC, f)),
  join(SRC, 'fire-plan-info-panel.tsx'),
  join(SRC, 'plan-ch2.tsx'),
  join(SRC, 'plan-ch3.tsx'),
  join(SRC, 'plan-tab-view.tsx'),
]
const counts = new Map()      // subsetIdx -> 등장 문자 수
const uncovered = new Set()
let totalHangul = 0
let files = 0
for (const f of TARGETS) {
  let txt
  try { txt = readFileSync(f, 'utf8') } catch { continue }
  files++
  for (const ch of txt) {
    const cp = ch.codePointAt(0)
    // 한글 음절 + 자모 + 호환자모만 센다(라틴은 PJS/Inter가 잡으므로 무관)
    const isHangul = (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0x1100 && cp <= 0x11ff)
    if (!isHangul) continue
    totalHangul++
    const s = subsetOf(cp)
    if (s < 0) { uncovered.add(ch); continue }
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
}

// ── 3. 보고
console.log(`스캔 파일 ${files}개 / 한글 문자 ${totalHangul}자 / 쓰인 조각 ${counts.size}개`)
if (files !== 16) console.log(`⚠ 대상이 16파일이 아니다 (${files}) — 범위 전제 재확인 필요`)
if (uncovered.size) console.log(`⚠ Pretendard가 못 그리는 문자: ${[...uncovered].join('')}`)

const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
const cum = []
let acc = 0
for (const [idx, n] of ranked) { acc += n; cum.push([idx, n, (acc / totalHangul * 100).toFixed(1)]) }

console.log('\n조각\t문자수\t누적%')
for (const [idx, n, pct] of cum.slice(0, 12)) console.log(`${idx}\t${n}\t${pct}%`)

const top3 = ranked.slice(0, 3).map(([i]) => i)
console.log(`\npreload 권장 3조각: ${top3.join(', ')}  (누적 ${cum[2]?.[2] ?? '?'}%)`)
console.log(top3.map(i => `<link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous" href="/fonts/pretendard/woff2/PretendardVariable.subset.${i}.woff2" />`).join('\n'))
