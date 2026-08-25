/** 지정 좌표를 참조하는 수식 전수(JSZip 축) — 인자: 파일 시트!셀 [시트!셀 …] */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'

const [file, ...targets] = process.argv.slice(2)
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(file)))
const files = await sheetFileMap(zip)
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
for (const t of targets) {
  const [ts, tc] = t.split('!')
  const hits: string[] = []
  for (const [sheet, path] of files) {
    const xml = await zip.file(path)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
      if (!raw) continue
      const f = unesc(raw)
      for (const r of f.matchAll(/(?:'?([^'!=,()"+\-*\/ ]+)'?!)?(\$?[A-Z]{1,3}\$?\d{1,5})/g)) {
        if ((r[1] ?? sheet) === ts && r[2].replace(/\$/g, '') === tc) hits.push(`${sheet}!${m[1]} = ${f}`)
      }
    }
  }
  console.log(`${t} ← ${hits.length}칸${hits.length ? `\n   ${hits.join('\n   ')}` : ''}`)
}
