/* 소스에 섞인 NUL 바이트 제거 — git이 텍스트 파일을 바이너리로 잡는 원인.
 * 어디였는지 보여주고 지운다(조용히 고치면 왜 생겼는지 못 배운다). */
import { readFileSync, writeFileSync } from 'node:fs'

for (const p of process.argv.slice(2)) {
  const b = readFileSync(p)
  const idx = []
  for (let i = 0; i < b.length; i++) if (b[i] === 0) idx.push(i)
  if (!idx.length) { console.log(`${p}: NUL 없음`); continue }
  for (const i of idx.slice(0, 5)) {
    const around = b.subarray(Math.max(0, i - 40), Math.min(b.length, i + 40)).toString('utf8')
    console.log(`${p} @${i}:  …${JSON.stringify(around)}…`)
  }
  const out = Buffer.from(b.filter(x => x !== 0))
  writeFileSync(p, out)
  console.log(`${p}: NUL ${idx.length}개 제거 (${b.length} → ${out.length}바이트)`)
}
