/** S9-1 대응표 **확정 단계** — `_scope30-spec-map.mts`가 낸 후보 114건을 등급으로 가른다.
 *
 *  초안은 '라벨이 spec 필드명과 닮았다'까지만 봤다. 그대로 앵커를 달면 두 가지로 틀린다:
 *   ① **부분일치**로 엮인 것(라벨 '수량'이 여러 spec의 '수량'에 다 걸린다) — 존재를 부분일치로
 *      판정하지 말 것([[feedback_exhaustive_has_an_axis]]).
 *   ② **값 칸이 하나가 아닌 것**(한 라벨 아래 수량·용량·단위가 나란히 온다).
 *
 *  그래서 등급을 매긴다:
 *    A 확정  — 라벨 **완전일치** + 매칭 spec **유일** + 같은 행 오른쪽 빈칸이 **정확히 1개**
 *    B 검토  — 위 셋 중 하나라도 어긋남(사람이 봐야 한다)
 *  A만 앵커 초안으로 내보낸다. B는 목록으로 남겨 다음 사람이 손으로 확정한다.
 *
 *  실행: node node_modules\tsx\dist\cli.mjs scripts\_scope31-spec-confirm.mts
 *  산출: F:/AI/ERP/_scope31-spec-confirm.txt
 */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import { FACILITY_SPEC_SECTIONS } from '../src/lib/facility-spec-schema.ts'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rid = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = rid.get(m[2]); if (t) sheets.set(m[1], 'xl/' + t.replace(/^\/?xl\//, ''))
}
const sst = [...(await zip.file('xl/sharedStrings.xml')!.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))

const colNum = (c: string) => [...c].reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0)
type Cell = { ref: string; col: string; cn: number; row: number; text: string; hasF: boolean }

const readSheet = async (name: string) => {
  const xml = await zip.file(sheets.get(name)!)!.async('string')
  const cells: Cell[] = []
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const r = /r="([A-Z]+)(\d+)"/.exec(m[1] ?? ''); if (!r) continue
    const inner = m[2] ?? ''
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    const ty = /\st="([^"]+)"/.exec(m[1] ?? '')?.[1]
    const text = ty === 's' && v !== undefined ? (sst[Number(v)] ?? '')
      : (inner.includes('<is>') ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') : (v ?? ''))
    cells.push({ ref: r[1] + r[2], col: r[1], cn: colNum(r[1]), row: Number(r[2]), text, hasF: /<f[^>]*[>/]/.test(inner) })
  }
  // 병합 — 값 칸이 병합의 좌상단이면 그 칸 하나가 정답이고, 병합 내부 칸은 후보에서 뺀다
  const merged = new Set<string>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const [c1, r1] = [/[A-Z]+/.exec(m[1])![0], Number(/\d+/.exec(m[1])![0])]
    const [c2, r2] = [/[A-Z]+/.exec(m[2])![0], Number(/\d+/.exec(m[2])![0])]
    for (let rr = r1; rr <= r2; rr++) for (let cc = colNum(c1); cc <= colNum(c2); cc++)
      if (!(rr === r1 && cc === colNum(c1))) merged.add(`${cc}:${rr}`)   // 좌상단 제외
  }
  return { cells, merged }
}

const specs: Array<{ section: string; key: string; label: string }> = []
{
  const walk = (n: unknown, section: string) => {
    if (Array.isArray(n)) { for (const x of n) walk(x, section); return }
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const sec = typeof o.label === 'string' && Array.isArray(o.blocks) ? o.label : section
    if (typeof o.key === 'string' && typeof o.label === 'string' && typeof o.type === 'string')
      specs.push({ section: sec, key: o.key, label: o.label })
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, sec)
  }
  walk(FACILITY_SPEC_SECTIONS, '(최상위)')
}
const norm = (t: string) => t.replace(/[\s()[\]{}·・.,:;/\\|-]/g, '')

const OUT: string[] = []
const A: string[] = [], B: string[] = []
OUT.push(`spec 필드 ${specs.length}개 · 고유 라벨 ${new Set(specs.map(s => norm(s.label))).size}개`)

for (const name of ['현1', '현2', '현3', '현4']) {
  const { cells, merged } = await readSheet(name)
  const byRow = new Map<number, Cell[]>()
  for (const c of cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row)!.push(c) }
  let a = 0, b = 0
  for (const c of cells.filter(x => x.text && norm(x.text).length >= 2)) {
    const n = norm(c.text)
    const exact = specs.filter(s => norm(s.label) === n)
    const partial = exact.length ? [] : specs.filter(s => norm(s.label).length >= 3 && n.includes(norm(s.label)))
    if (!exact.length && !partial.length) continue
    // 같은 행에서 라벨 오른쪽의 **입력 가능한** 빈칸(값·수식 없음, 병합 내부 아님)
    const blanks = (byRow.get(c.row) ?? [])
      .filter(x => x.cn > c.cn && !x.text && !x.hasF && !merged.has(`${x.cn}:${x.row}`))
      .sort((p, q) => p.cn - q.cn)
    const gradeA = exact.length === 1 && blanks.length === 1
    const line = `${name}!${c.ref} '${c.text.slice(0, 22)}' → ${
      (exact[0] ?? partial[0]).key}(${(exact[0] ?? partial[0]).section}) · 값칸 ${blanks[0]?.ref ?? '(없음)'}`
    if (gradeA) { A.push(line); a++ }
    else {
      const why = !exact.length ? '부분일치' : exact.length > 1 ? `spec ${exact.length}개 경합` : `빈칸 ${blanks.length}개`
      B.push(`${line}   [${why}]`); b++
    }
  }
  OUT.push(`\n===== ${name} — A확정 ${a} · B검토 ${b} =====`)
}

OUT.push(`\n──────── A 확정 ${A.length}건 (앵커 초안) ────────`)
OUT.push(...A)
OUT.push(`\n──────── B 검토 ${B.length}건 (사람 확정 필요) ────────`)
OUT.push(...B.slice(0, 60))
if (B.length > 60) OUT.push(`  … 외 ${B.length - 60}건`)
OUT.push(`\n합계 A ${A.length} / B ${B.length} (초안 후보 ${A.length + B.length})`)
writeFileSync('F:/AI/ERP/_scope31-spec-confirm.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.filter(l => l.startsWith('spec') || l.startsWith('=====') || l.startsWith('\n=====') || l.startsWith('합계') || l.includes('────')).join('\n'))
console.log(`\n합계 A ${A.length} / B ${B.length}`)
