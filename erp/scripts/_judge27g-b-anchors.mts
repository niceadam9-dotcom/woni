/** 판정자 B (원시 바이트/XML 축) — S0-5 앵커 실재 재측정 + 반증 가능성 변이 주입
 *  실행: npx tsx scripts/_judge27g-b-anchors.mts
 *  soffice 실행 금지 — 커밋된 자산과 원시 XML만 본다. 저장소 파일은 수정하지 않는다(TEMP만).
 *  결과는 UTF-8 파일로 직접 기록(PS 5.1 리다이렉트 모지바케 회피). */
import JSZip from 'jszip'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OUT: string[] = []
const say = (s = '') => { OUT.push(s); console.log(s) }
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const ROOT = 'F:/AI/ERP/erp'
const ASSET_FULL = `${ROOT}/templates/report-workbook-full.xlsx`
const ASSET_MIN = `${ROOT}/templates/report-workbook.xlsx`
const dir = mkdtempSync(join(tmpdir(), 'j27gb-'))

// ── 내 축의 좌표 도출 (게이트 코드를 재사용하지 않고 직접 짠다) ───────────────
type Req = { sheet: string; cell: string; why: string }
async function requiredCoords(opts?: { anchorFilter?: (a: any) => boolean; noHubInput?: boolean }) {
  const mod = await import('../src/lib/xlsx-anchors.ts')
  const anchors = (mod.ANCHORS as any[]).filter(opts?.anchorFilter ?? (() => true))
  const reqs: Req[] = []
  for (const a of anchors) {
    reqs.push({ sheet: a.sheet, cell: a.cell, why: `anchor.cell(${a.field})` })
    reqs.push({ sheet: a.sheet, cell: a.labelCell, why: `anchor.labelCell(${a.field})` })
  }
  if (!opts?.noHubInput) for (const c of mod.HUB_INPUT_CELLS as string[]) {
    reqs.push({ sheet: '개요', cell: c, why: 'HUB_INPUT_CELLS' })
  }
  // 시트별 유일 좌표 집합
  const bySheet = new Map<string, Set<string>>()
  for (const r of reqs) {
    const s = bySheet.get(r.sheet) ?? new Set<string>()
    s.add(r.cell); bySheet.set(r.sheet, s)
  }
  const total = [...bySheet.values()].reduce((n, s) => n + s.size, 0)
  return { bySheet, total, rawCount: reqs.length, anchorCount: anchors.length }
}

// ── 시트 이름 → 파일 매핑 (내 방식: 속성 순서 무관 파싱) ─────────────────────
async function sheetMap(zip: JSZip) {
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rel = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1]
    const tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1]
    if (id && tg) rel.set(id, tg)
  }
  const out = new Map<string, string>()
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[1])?.[1]
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1]
    if (!name || !rid) continue
    const t = rel.get(rid) ?? ''
    out.set(name, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
  }
  return out
}

/** 내 파서 — <c ...> 요소를 통째로 잡고 r= 속성을 어느 위치에서든 읽는다(자기닫힘 포함) */
const cellsMine = (xml: string) => {
  const s = new Set<string>()
  for (const m of xml.matchAll(/<c\s([^>]*?)\/?>/g)) {
    const r = /\br="([A-Za-z]+\d+)"/.exec(m[1])?.[1]
    if (r) s.add(r)
  }
  return s
}
/** 게이트가 쓰는 정규식 — 그대로 복제해 내 파서와 대조(구현자 검사의 사각 탐지용) */
const cellsGate = (xml: string) =>
  new Set([...xml.matchAll(/<c r="([A-Z]+\d+)"/g)].map(m => m[1]))

async function absent(zip: JSZip, files: Map<string, string>, bySheet: Map<string, Set<string>>,
                      parser: (x: string) => Set<string>) {
  const out: string[] = []
  for (const [sheet, cells] of bySheet) {
    const p = files.get(sheet)
    if (!p || !zip.file(p)) { out.push(`${sheet}!(시트없음)`); continue }
    const present = parser(await zip.file(p)!.async('string'))
    for (const c of cells) if (!present.has(c)) out.push(`${sheet}!${c}`)
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════════
say('=== 판정자 B / S0-5 앵커 실재 — 독립 재측정 ===')
say(`자산: ${ASSET_FULL} (${existsSync(ASSET_FULL) ? readFileSync(ASSET_FULL).length : 0} bytes)`)

const base = await requiredCoords()
say('')
say(`[1] 내 축의 요구 좌표 총계 = ${base.total}  (앵커 ${base.anchorCount}개 · 중복포함 ${base.rawCount})`)
say(`    시트 수 = ${base.bySheet.size}`)
for (const [s, set] of [...base.bySheet].sort((a, b) => b[1].size - a[1].size)) {
  say(`      ${s.padEnd(8)} ${String(set.size).padStart(4)}칸`)
}
say(`    ⇒ 구현자 주장 '176개(7시트)'와 비교: ${base.total === 176 ? '일치' : `**불일치** (내 실측 ${base.total}개 / ${base.bySheet.size}시트)`}`)

// ── 자산 실측 ─────────────────────────────────────────────────────────────
const zipFull = await JSZip.loadAsync(readFileSync(ASSET_FULL))
const mapFull = await sheetMap(zipFull)
say('')
say(`[2] 커밋 자산 report-workbook-full.xlsx — 시트 ${mapFull.size}개`)
const aMine = await absent(zipFull, mapFull, base.bySheet, cellsMine)
const aGate = await absent(zipFull, mapFull, base.bySheet, cellsGate)
check(`내 파서 — 요구 좌표 ${base.total}개 전부 실재`, aMine.length === 0,
  aMine.length ? `부재 ${aMine.length}: ${aMine.slice(0, 12).join(',')}` : 'OK')
check(`게이트 정규식 — 같은 결론`, aGate.length === aMine.length,
  `게이트 부재 ${aGate.length} / 내 부재 ${aMine.length}`)

if (existsSync(ASSET_MIN)) {
  const zipMin = await JSZip.loadAsync(readFileSync(ASSET_MIN))
  const mapMin = await sheetMap(zipMin)
  const aMin = await absent(zipMin, mapMin, base.bySheet, cellsMine)
  say(`    (참고) report-workbook.xlsx — 시트 ${mapMin.size} · 부재 ${aMin.length}${aMin.length ? `: ${aMin.slice(0, 6).join(',')}` : ''}`)
}

// ── 변이 A: 실재하는 앵커 좌표를 자산 XML에서 실제로 제거 ────────────────────
say('')
say('[3] 변이 A — 실재 앵커 좌표를 자산에서 물리적으로 제거(현실적 변이)')
/** 셀 요소 제거 — 자기닫힘/쌍 양쪽 */
function dropCell(xml: string, ref: string) {
  const re = new RegExp(`<c\\s[^>]*?\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`)
  const m = re.exec(xml)
  return { xml: m ? xml.replace(re, '') : xml, hit: !!m }
}
const MUTANTS: Array<[string, string, string]> = [
  ['개요', 'B14', '허브 상호(가장 많이 참조되는 칸)'],
  ['현황', 'S12', '별지4호 옥내소화전 점검결과 칸'],
  ['정보', 'B19', '정보 시트 건축물구조 √ 통문자열'],
  ['다수동일때', 'B16', '2동 블록 지붕구조'],
]
for (const [sheet, cell, why] of MUTANTS) {
  const z = await JSZip.loadAsync(readFileSync(ASSET_FULL))
  const p = mapFull.get(sheet)!
  const r = dropCell(await z.file(p)!.async('string'), cell)
  if (!r.hit) { check(`변이 ${sheet}!${cell} 제거 가능`, false, '원본에 없음(변이 자체가 성립 안 함)'); continue }
  z.file(p, r.xml)
  const mp = join(dir, `mut-${sheet}-${cell}.xlsx`)
  writeFileSync(mp, await z.generateAsync({ type: 'nodebuffer' }))
  const mz = await JSZip.loadAsync(readFileSync(mp))
  const mm = await sheetMap(mz)
  const am = await absent(mz, mm, base.bySheet, cellsMine)
  const ag = await absent(mz, mm, base.bySheet, cellsGate)
  const wantKey = `${sheet}!${cell}`
  check(`내 파서가 ${wantKey} 제거를 부재로 잡는다 (${why})`,
    am.length === 1 && am[0] === wantKey, `부재 ${am.length}: ${am.join(',') || '(없음 — 눈이 멀었다)'}`)
  check(`게이트 정규식도 ${wantKey} 제거를 잡는다`,
    ag.length === 1 && ag[0] === wantKey, `부재 ${ag.length}: ${ag.join(',') || '(없음)'}`)
}

// ── 변이 B: ANCHORS 목록을 줄이면 요구 좌표가 따라 줄어드는가(연동 확인) ──────
say('')
say('[4] 변이 B — ANCHORS 축소 시 요구 좌표가 따라 줄어드는가(검사가 앵커 목록에 연동되는가)')
const noMulti = await requiredCoords({ anchorFilter: a => a.sheet !== '다수동일때' })
check('다수동일때 앵커 제거 → 요구 좌표 감소',
  noMulti.total < base.total, `${base.total} → ${noMulti.total} (Δ${base.total - noMulti.total})`)
const noForm4 = await requiredCoords({ anchorFilter: a => a.sheet !== '현황' })
check('현황(별지4호) 앵커 제거 → 요구 좌표 감소',
  noForm4.total < base.total, `${base.total} → ${noForm4.total} (Δ${base.total - noForm4.total})`)
const emptyAnchors = await requiredCoords({ anchorFilter: () => false })
say(`    ANCHORS를 통째로 비우면 → 요구 좌표 ${emptyAnchors.total}개(HUB_INPUT_CELLS만) · 시트 ${emptyAnchors.bySheet.size}`)
const aEmpty = await absent(zipFull, mapFull, emptyAnchors.bySheet, cellsMine)
check('⚠ ANCHORS가 통째로 비어도 검사는 초록인가?(하한 단언 부재 확인)',
  true, aEmpty.length === 0 ? `부재 0 — **초록**. 게이트에 요구 좌표 하한 단언이 없다` : `부재 ${aEmpty.length}`)
const allEmpty = await requiredCoords({ anchorFilter: () => false, noHubInput: true })
say(`    ANCHORS+HUB_INPUT_CELLS 둘 다 비우면 → 요구 좌표 ${allEmpty.total}개 · 부재 0(공허참)`)

// ── 변이 C: 게이트의 카나리아(ZZ9999)를 내 축에서 재현 ───────────────────────
say('')
say('[5] 변이 C — 게이트 카나리아(ZZ9999) 재현')
const canary = new Map(base.bySheet)
canary.set('개요', new Set([...(base.bySheet.get('개요') ?? []), 'ZZ9999']))
const ac = await absent(zipFull, mapFull, canary, cellsMine)
check('없는 좌표를 부재로 잡는다', ac.length === 1 && ac[0] === '개요!ZZ9999', ac.join(',') || '(부재 0)')
// 카나리아가 못 잡는 부류 — 시트 자체가 사라진 경우
const noSheet = new Map(base.bySheet)
noSheet.set('없는시트XX', new Set(['A1']))
const ans = await absent(zipFull, mapFull, noSheet, cellsMine)
check('없는 시트를 부재로 잡는다', ans.some(x => x.startsWith('없는시트XX')), ans.filter(x => x.startsWith('없는시트XX')).join(','))

say('')
say(`결과: ${pass} PASS / ${fail} FAIL`)
say(`임시: ${dir}`)
writeFileSync(`${ROOT}/scripts/_judge27g-b-anchors.txt`, OUT.join('\n'), 'utf8')
process.exit(fail ? 1 : 0)
