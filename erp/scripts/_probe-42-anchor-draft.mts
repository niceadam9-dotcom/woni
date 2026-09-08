/** 소방계획서_42 S4-2 앵커 초안 생성기 — **사람이 재승인할 재료**를 뽑는다.
 *
 *  자동 생성만 믿으면 안 되는 이유가 실측으로 있다(R-1): 양식의 `{{owner_phone}}`이 **두 번**
 *  쓰였고 `{{manager_phone}}`은 아예 없다. 씨앗을 그대로 배선하면 소방안전관리자 연락처 칸에
 *  대표자 전화가 인쇄된다. 그래서 이 스크립트는 앵커를 **쓰지 않고** 후보만 보여준다.
 *
 *  실행: npx tsx scripts/_probe-42-anchor-draft.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json')

interface Sheet {
  name: string; labels: Record<string, string>; tokenCells: Record<string, string>
  rows: number; cols: number; bannerRows: number[]
}
const man = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { sheets: Sheet[] }

const LINES: string[] = []
const say = (s: string) => LINES.push(s)

const dec = (ref: string) => XLSX.utils.decode_cell(ref)
const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c })

let n = 0
const tokenUse = new Map<string, string[]>()

for (const s of man.sheets) {
  const entries = Object.entries(s.tokenCells)
  if (!entries.length) continue
  say(`\n══ ${s.name} (${s.rows}x${s.cols}) ══`)
  for (const [ref, tpl] of entries) {
    n++
    const { r, c } = dec(ref)
    for (const m of tpl.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)) {
      ;(tokenUse.get(m[1]) ?? tokenUse.set(m[1], []).get(m[1])!).push(`${s.name}!${ref}`)
    }

    // 후보 ① 같은 행에서 왼쪽으로 가장 가까운 라벨
    let left: string | null = null
    for (let k = c - 1; k >= 0 && !left; k--) if (s.labels[enc(r, k)]) left = enc(r, k)
    // 후보 ② 같은 열에서 위로 가장 가까운 라벨
    let up: string | null = null
    for (let k = r - 1; k >= 0 && !up; k--) if (s.labels[enc(k, c)]) up = enc(k, c)

    const show = (x: string | null) => x ? `${x}='${s.labels[x].replace(/\s+/g, ' ').slice(0, 26)}'` : '(없음)'
    say(`  ${ref.padEnd(5)} ${JSON.stringify(tpl).padEnd(34)}  ←왼쪽 ${show(left).padEnd(38)} ↑위 ${show(up)}`)
  }
}

say(`\n══ 토큰 사용 횟수 — 2회 이상이면 오배정 의심(R-1) ══`)
for (const [t, where] of [...tokenUse].sort((a, b) => b[1].length - a[1].length)) {
  say(`  ${t.padEnd(28)} ×${where.length}  ${where.join(' · ')}`)
}
say(`\n토큰 칸 ${n}개`)

writeFileSync(join(HERE, '_out-42-anchor-draft.txt'), LINES.join('\n'), 'utf8')
console.log(`wrote ${LINES.length} lines`)
