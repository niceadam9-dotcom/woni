/** 현5 wrapText 자산 패치 — 두 갑지 자산의 styles.xml에 wrapText를 강제하고 매니페스트 지문을 갱신.
 *
 *  왜 소스 재빌드가 아닌가: `.xls` → LibreOffice 재변환은 LO 버전이 조금만 달라도 4.3MB 자산이
 *  통째로 바뀐다. 이 수리는 cellXfs 6칸짜리라 그 위험을 살 이유가 없다. 같은 변환을
 *  `build-workbook-template.mts`에도 넣어 **재빌드해도 살아남게** 한다(짝을 맞춘다).
 *
 *  --check 로 실행하면 쓰지 않고 진단만 한다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { forceWrapText, HYEON5_WRAP_XFS } from '../src/lib/xlsx-wrap-fix.ts'

const CHECK = process.argv.includes('--check')
const TARGETS = [
  { xlsx: 'templates/report-workbook.xlsx',      manifest: 'src/lib/xlsx-template-manifest.json', key: 'sha256' },
  { xlsx: 'templates/report-workbook-full.xlsx', manifest: 'src/lib/xlsx-donor-manifest.json',    key: 'sha256' },
] as const

for (const t of TARGETS) {
  const bytes = new Uint8Array(readFileSync(t.xlsx))
  const zip = await JSZip.loadAsync(bytes)
  const stylesPath = 'xl/styles.xml'
  const before = await zip.file(stylesPath)!.async('string')
  const { xml, changed } = forceWrapText(before, HYEON5_WRAP_XFS)
  console.log(`${t.xlsx}: wrapText 변경 ${changed}칸 (대상 xf ${HYEON5_WRAP_XFS.join(',')})`)
  if (changed > 0 && !CHECK) {
    zip.file(stylesPath, xml)
    // ⚠ 압축 옵션을 원본과 맞춘다 — 안 맞추면 무관한 파트까지 바이트가 흔들린다
    const out = new Uint8Array(await zip.generateAsync({
      type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 },
    }))
    writeFileSync(t.xlsx, out)
    const mf = JSON.parse(readFileSync(t.manifest, 'utf8'))
    mf.wrapFix = { date: '2026-09-01', xfs: [...HYEON5_WRAP_XFS], reason: '현5 불량 세부 줄바꿈이 두부로 렌더되던 것' }
    writeFileSync(t.manifest, JSON.stringify(mf, null, 2) + '\n')
  }
}

// ── 지문 동기화 — wrapText 변경 유무와 **독립**으로 항상 맞춘다 ──────────────
// 자산 지문은 네 곳에 흩어져 있다. 한 곳만 놓치면 그 검사만 붉어진다(itemmap에서 실제로 겪었다).
if (!CHECK) {
  const shaOf = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')
  const baseSha = shaOf('templates/report-workbook.xlsx')
  const fullSha = shaOf('templates/report-workbook-full.xlsx')
  const sync = (file: string, patch: Record<string, string>) => {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(patch)) {
      if (j[k] === v) continue
      console.log(`${file} ${k}: ${String(j[k]).slice(0, 12)}… → ${v.slice(0, 12)}…`)
      j[k] = v
    }
    writeFileSync(file, JSON.stringify(j, null, 2) + '\n')
  }
  sync('src/lib/xlsx-template-manifest.json', { sha256: baseSha })
  sync('src/lib/xlsx-donor-manifest.json', { sha256: fullSha, baseSha256: baseSha })
  // ⚠ itemmap은 '빌드 생성물 — 손으로 고치지 말 것'이지만, 여기서 바꾸는 건 **좌표가 아니라
  //   자산과의 짝(지문)뿐**이다. styles.xml만 건드렸으므로 항목 좌표는 그대로 유효하다.
  sync('src/lib/xlsx-donor-itemmap.json', { assetSha256: fullSha })
}
console.log('완료')
