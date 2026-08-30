/** S9-1 잔여 착수의 선행 조건 — `현1`~`현4`의 **셀↔spec 필드 대응표 초안**.
 *
 *  탐색 에이전트 견적('새로 배선할 칸 2,120개')은 빈 셀을 전부 센 수라 기각했다(현5 선례:
 *  빈 칸은 많았지만 실제 배선은 14칸). 여기서는 **라벨 축**으로 좁힌다: 시트에 실제로 적힌
 *  라벨 문자열을 뽑고, PDF 정본(`facility-spec-schema.ts`)의 필드 라벨과 대조해
 *  '어느 칸이 무엇을 받아야 하는가'의 후보를 만든다.
 *
 *  ⚠ 이건 **초안**이다. 자동 매칭이 곧 대응표는 아니다 — 라벨이 같아도 열이 다를 수 있고,
 *  서식은 한 라벨 아래 여러 칸(수량·용량·단위)을 두기도 한다. 사람이 확정해야 한다.
 *
 *  실행: node node_modules\tsx\dist\cli.mjs scripts\_scope30-spec-map.mts
 *  산출: F:/AI/ERP/_scope30-spec-map.txt
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

type Cell = { ref: string; col: string; row: number; text: string; hasF: boolean }
const readSheet = async (name: string): Promise<Cell[]> => {
  const xml = await zip.file(sheets.get(name)!)!.async('string')
  const out: Cell[] = []
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /r="([A-Z]+)(\d+)"/.exec(m[1] ?? '')
    if (!ref) continue
    const inner = m[2] ?? ''
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    const ty = /\st="([^"]+)"/.exec(m[1] ?? '')?.[1]
    const text = ty === 's' && v !== undefined ? (sst[Number(v)] ?? '')
      : (inner.includes('<is>') ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') : (v ?? ''))
    out.push({ ref: ref[1] + ref[2], col: ref[1], row: Number(ref[2]), text, hasF: /<f[^>]*[>/]/.test(inner) })
  }
  return out
}

// PDF 정본의 필드 라벨 — 이것이 '엑셀이 받아야 할 값'의 전체 목록이다
// ⚠ 구조가 `sections → blocks → fields` **중첩**이라 한 겹만 훑으면 0건이 나온다(실제로 겪었다).
//   중첩 깊이를 가정하지 말고 **재귀로** {key,label,type}을 가진 객체를 전부 거둔다 —
//   설계 JSON을 셀 때 `criteria[].criteria` 중첩을 놓쳤던 것과 같은 부류의 실수다.
const specLabels: Array<{ section: string; key: string; label: string }> = []
{
  const walk = (n: unknown, section: string) => {
    if (Array.isArray(n)) { for (const x of n) walk(x, section) ; return }
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const sec = typeof o.label === 'string' && Array.isArray(o.blocks) ? o.label : section
    if (typeof o.key === 'string' && typeof o.label === 'string' && typeof o.type === 'string')
      specLabels.push({ section: sec, key: o.key, label: o.label })
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, sec)
  }
  walk(FACILITY_SPEC_SECTIONS, '(최상위)')
}
const norm = (t: string) => t.replace(/[\s()[\]{}·・.,:;/\\-]/g, '')

const OUT: string[] = []
OUT.push(`spec 필드(PDF 정본) 총 ${specLabels.length}개 · 섹션 ${new Set(specLabels.map(s => s.section)).size}개`)

let totalCandidates = 0
for (const name of ['현1', '현2', '현3', '현4']) {
  const cells = await readSheet(name)
  const withText = cells.filter(c => c.text)
  const blank = cells.filter(c => !c.text && !c.hasF)
  OUT.push(`\n===== ${name} · 셀 ${cells.length} · 값 ${withText.length} · 수식 ${cells.filter(c => c.hasF).length} · 빈칸 ${blank.length} =====`)

  // 라벨 후보 = 텍스트가 있고 spec 라벨과 정규화 일치/포함하는 칸
  const hits: string[] = []
  for (const c of withText) {
    const n = norm(c.text)
    if (n.length < 2) continue
    const m = specLabels.find(s => norm(s.label) === n) ?? specLabels.find(s => n.includes(norm(s.label)) && norm(s.label).length >= 3)
    if (!m) continue
    // 그 라벨의 오른쪽 첫 빈칸 = 값 칸 후보
    const right = cells.filter(x => x.row === c.row && x.col > c.col && !x.text && !x.hasF)
      .sort((a, b) => a.col.length - b.col.length || a.col.localeCompare(b.col))[0]
    hits.push(`  ${c.ref} '${c.text.slice(0, 24)}' → spec ${m.key}(${m.section}) · 값칸 후보 ${right?.ref ?? '(없음)'}`)
  }
  totalCandidates += hits.length
  OUT.push(`라벨↔spec 일치 ${hits.length}건`)
  OUT.push(...hits.slice(0, 40))
  if (hits.length > 40) OUT.push(`  … 외 ${hits.length - 40}건`)
}

OUT.push(`\n──────── 결론 ────────`)
OUT.push(`라벨 축 대응 후보 합계: ${totalCandidates}건 (에이전트 견적 2,120은 빈 셀 전수라 기각)`)
OUT.push(`⚠ 초안이다 — 라벨이 같아도 열이 다를 수 있고, 한 라벨 아래 여러 칸(수량·용량·단위)이 올 수 있다.`)
writeFileSync('F:/AI/ERP/_scope30-spec-map.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.slice(0, 6).join('\n'))
console.log(`\n(전문 F:/AI/ERP/_scope30-spec-map.txt · 후보 ${totalCandidates}건)`)
