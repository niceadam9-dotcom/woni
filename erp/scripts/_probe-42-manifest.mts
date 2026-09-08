/** 소방계획서_42 S3 산출물 점검 — manifest 요약 + LibreOffice 실개봉.
 *  실행: npx tsx scripts/_probe-42-manifest.mts
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const MANIFEST = resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json')

const LINES: string[] = []
const say = (s: string) => { LINES.push(s); }

interface Sheet {
  name: string; no: string | null; tables: number[]
  rows: number; cols: number; merges: number; bannerRows: number[]
  labels: Record<string, string>; boxes: Record<string, string>
  restoredBoxes: Record<string, string>; tokenCells: Record<string, string>
  scrubbed: Record<string, string[]>; numberedRuns: { startRow: number; rows: number }[]
}
const man = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  source: { sha256: string; tables: number; cells: number }
  asset: { sha256: string; bytes: number; styles: number }
  sheets: Sheet[]
}

say(`원천 ${man.source.tables}표 ${man.source.cells}셀 sha=${man.source.sha256.slice(0, 12)}`)
say(`자산 ${man.asset.bytes} bytes · xf ${man.asset.styles} · sha=${man.asset.sha256.slice(0, 12)}`)

say('\n[1] 시트 요약')
for (const s of man.sheets) {
  say(`  ${s.name.padEnd(30)} ${String(s.rows).padStart(3)}x${String(s.cols).padStart(2)}`
    + ` 병합${String(s.merges).padStart(4)} 라벨${String(Object.keys(s.labels).length).padStart(4)}`
    + ` 상자${String(Object.keys(s.boxes).length).padStart(3)} 토큰${String(Object.keys(s.tokenCells).length).padStart(3)}`
    + ` 되돌림${String(Object.keys(s.restoredBoxes).length).padStart(3)}`
    + (s.numberedRuns.length ? `  반복행 ${s.numberedRuns.map(r => `r${r.startRow}×${r.rows}`).join(',')}` : ''))
}

say('\n[2] ■ 되돌림 판정 축 분포 — 추측이 어디서 왔는가')
{
  const axis = new Map<string, number>()
  for (const s of man.sheets) for (const a of Object.values(s.restoredBoxes)) axis.set(a, (axis.get(a) ?? 0) + 1)
  for (const [a, n] of axis) say(`  ${a} — ${n}칸`)
}

say('\n[3] 되돌린 칸 전수 (원본 글자 추론 결과를 눈으로 본다)')
for (const s of man.sheets) {
  for (const [ref, ax] of Object.entries(s.restoredBoxes)) {
    say(`  ${s.name}!${ref} [${ax}] → ${JSON.stringify((s.labels[ref] ?? '(공란)').slice(0, 46))}`)
  }
}

say('\n[4] 스크럽된 칸 전수')
for (const s of man.sheets) {
  for (const [ref, hits] of Object.entries(s.scrubbed)) {
    say(`  ${s.name}!${ref} ← ${hits.join(',')}  남은글=${JSON.stringify((s.labels[ref] ?? '(공란)').slice(0, 40))}`)
  }
}

say('\n[5] 토큰 씨앗 전수 (S4 앵커 초안의 재료)')
for (const s of man.sheets) {
  for (const [ref, tpl] of Object.entries(s.tokenCells)) say(`  ${s.name}!${ref}  ${JSON.stringify(tpl)}`)
}

say('\n[6] 빈 상자 어휘 — 시트별 □/☐ 혼용 실태(F-6)')
for (const s of man.sheets) {
  const c = new Map<string, number>()
  for (const g of Object.values(s.boxes)) c.set(g, (c.get(g) ?? 0) + 1)
  if (!c.size) continue
  say(`  ${s.name.padEnd(30)} ${[...c].map(([g, n]) => `${g}×${n}`).join(' ')}`)
}

say('\n[7] SheetJS 되읽기 — 시트·병합 보존')
{
  const wb = XLSX.read(readFileSync(XLSX_PATH), { cellStyles: false })
  const wantSheets = man.sheets.map(s => s.name)
  const missing = wantSheets.filter(n => !wb.SheetNames.includes(n))
  say(`  시트 ${wb.SheetNames.length}/${wantSheets.length} · 누락 ${missing.length ? missing.join(',') : '없음'}`)
  const gotMerges = wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]!['!merges'] as unknown[] | undefined)?.length ?? 0), 0)
  const wantMerges = man.sheets.reduce((n, s) => n + s.merges, 0)
  say(`  병합 ${gotMerges}/${wantMerges} ${gotMerges === wantMerges ? 'ok' : 'MISMATCH'}`)
}

say('\n[8] LibreOffice 실개봉 (프로필 격리)')
{
  const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.com'
  if (!existsSync(SOFFICE)) say('  (soffice 없음 — 건너뜀)')
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'p42m-'))
    const r = spawnSync(SOFFICE, [
      `-env:UserInstallation=file:///${join(tmp, 'loprofile').replace(/\\/g, '/')}`,
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, XLSX_PATH,
    ], { encoding: 'utf8', timeout: 300_000 })
    const pdf = join(tmp, 'fire-plan-workbook.pdf')
    say(`  exit=${r.status} ${(r.stderr ?? '').slice(0, 160)}`)
    say(`  pdf=${existsSync(pdf) ? statSync(pdf).size + ' bytes' : '없음'}`)
    say(`  tmp=${tmp}`)
  }
}

writeFileSync(join(HERE, '_out-42-manifest.txt'), LINES.join('\n'), 'utf8')
console.log(`wrote ${LINES.length} lines`)
