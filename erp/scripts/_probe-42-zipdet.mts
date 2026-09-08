/** 소방계획서_42 — 자산의 sha가 재빌드마다 바뀌는 이유가 내용인가 타임스탬프인가.
 *  실행: npx tsx scripts/_probe-42-zipdet.mts
 */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const p = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const raw = readFileSync(p)
const z = await JSZip.loadAsync(raw)
const names = Object.keys(z.files).filter(n => !z.files[n].dir).sort()

const h = createHash('sha256')
for (const n of names) { h.update(n); h.update(await z.file(n)!.async('nodebuffer')) }

console.log(`파일 sha        : ${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`)
console.log(`내용 지문(파트명+바이트, 타임스탬프 제외): ${h.digest('hex').slice(0, 16)}`)
console.log(`파트 ${names.length}개`)
console.log('zip 엔트리 date 표본:')
for (const n of names.slice(0, 3)) console.log(`  ${n}  ${z.files[n].date?.toISOString()}`)
