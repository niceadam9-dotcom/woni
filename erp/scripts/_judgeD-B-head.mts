/** 독립 판정 B 보조 — 작업트리 자산이 타 세션 재빌드로 바뀌었다(2026-08-30 07:27~07:29).
 *  판정의 기준은 **커밋된 자산**이어야 하므로 HEAD 블롭을 직접 읽어 E1·E2를 다시 잰다.
 *  실행: npx tsx --conditions=react-server scripts/_judgeD-B-head.mts   (읽기 전용, 트리 무변경) */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { planDonorInjection } from '../src/lib/xlsx-donor-inject'
import { injectWorkbook } from '../src/lib/xlsx-inject'
import { donorGroupsToKeep } from '../src/lib/xlsx-donors'
import wtMap from '../src/lib/xlsx-donor-itemmap.json' with { type: 'json' }

const GIT = 'F:\\AI\\tools\\MinGit\\cmd\\git.exe'
const blob = (p: string) => {
  const r = spawnSync(GIT, ['-C', 'F:\\AI\\ERP', 'show', `HEAD:${p}`], { maxBuffer: 1 << 28 })
  if (r.status !== 0) throw new Error(`git show 실패 ${p}: ${r.stderr?.toString()}`)
  return r.stdout as Buffer
}
let pass = 0, fail = 0
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  OK  ${l}`) } else { fail++; console.log(`  NG  ${l}${d ? ' -- ' + d : ''}`) } }

const headMap = JSON.parse(blob('erp/src/lib/xlsx-donor-itemmap.json').toString('utf8')) as { cells: Record<string, [string, string]> }
const wt = (wtMap as unknown as { cells: Record<string, [string, string]> }).cells
const hc = headMap.cells
const hKeys = Object.keys(hc), wKeys = Object.keys(wt)
console.log(`HEAD 매핑 ${hKeys.length}코드 · 작업트리 ${wKeys.length}코드`)
const drift = hKeys.filter(k => !wt[k] || wt[k][0] !== hc[k][0] || wt[k][1] !== hc[k][1])
  .concat(wKeys.filter(k => !hc[k]).map(k => `+${k}`))
ck(`[H1] HEAD ↔ 작업트리 매핑 좌표 동일 (drift ${drift.length})`, drift.length === 0, drift.slice(0, 8).join(','))

// HEAD 자산으로 전 좌표 실재 재측정
const tpl = new Uint8Array(blob('erp/templates/report-workbook-full.xlsx'))
const wtTpl = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
console.log(`HEAD 자산 ${tpl.length}바이트 · 작업트리 자산 ${wtTpl.length}바이트`)
const keptAll = new Set(donorGroupsToKeep(() => true, true).flatMap(g => g.sheets))
const resp = hKeys.map(c => ({ item_code: c, result: 'O' as const, month: 0 }))
const p = planDonorInjection(resp, keptAll)
ck(`[H2] HEAD 매핑 ${hKeys.length}코드 전건 착지 (${p.landed})`, p.landed === hKeys.length,
  JSON.stringify({ sr: p.notLanded.sheetRemoved.length, nd: p.notLanded.noDonorRow.length }))
const r = await injectWorkbook(tpl, p.targets, {})
ck(`[H3] HEAD 자산에 매핑 전 좌표 ${p.targets.length}칸 실재 — missed ${r.missed.length}`,
  r.missed.length === 0, r.missed.slice(0, 8).join(','))
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
