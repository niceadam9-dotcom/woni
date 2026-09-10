/** HWP 5.0(.hwp) 본문 텍스트 추출 — 법정 서식 원문을 **파생 MD가 아니라 원본에서** 읽기 위한 일회용 도구.
 *  LibreOffice가 이 파일을 못 여는 게 확인돼(source file could not be loaded) 직접 푼다.
 *  실행: node scripts/_hwp5-text.mjs <파일.hwp>
 */
import { readFileSync } from 'node:fs'
import { inflateRawSync, inflateSync } from 'node:zlib'
import CFB from 'cfb'

const path = process.argv[2]
if (!path) { console.error('usage: node _hwp5-text.mjs <file.hwp>'); process.exit(1) }

const cfb = CFB.read(readFileSync(path), { type: 'buffer' })
const find = (name) => cfb.FileIndex.find((f, i) => cfb.FullPaths[i].endsWith(name))
const idxOf = (name) => cfb.FullPaths.findIndex(p => p.endsWith(name))

const fh = find('FileHeader')
if (!fh) { console.error('FileHeader 없음 — HWP 5.0이 아닐 수 있다'); process.exit(1) }
const hdr = Buffer.from(fh.content)
const sig = hdr.slice(0, 17).toString('latin1')
const flags = hdr.readUInt32LE(36)
const compressed = (flags & 1) === 1
console.error(`sig="${sig}" compressed=${compressed}`)

/** 압축 해제 — hwp는 raw deflate가 표준이나 zlib 헤더가 붙는 판도 있어 둘 다 시도 */
function unpack(buf) {
  if (!compressed) return buf
  try { return inflateRawSync(buf) } catch { return inflateSync(buf) }
}

/* 제어문자 분류 — 잘못 세면 뒤 텍스트가 통째로 어긋난다 */
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31])
const WIDE_CTRL = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])

function paraText(buf) {
  let out = ''
  for (let i = 0; i + 1 < buf.length;) {
    const c = buf.readUInt16LE(i)
    if (CHAR_CTRL.has(c)) { if (c === 13 || c === 10) out += '\n'; i += 2; continue }
    if (WIDE_CTRL.has(c)) { i += 16; continue }   // 8 wchar
    out += String.fromCharCode(c); i += 2
  }
  return out
}

const HWPTAG_PARA_TEXT = 67
let all = []
for (let k = 0; k < cfb.FullPaths.length; k++) {
  const p = cfb.FullPaths[k]
  if (!/BodyText\/Section\d+$/.test(p)) continue
  const data = unpack(Buffer.from(cfb.FileIndex[k].content))
  let pos = 0
  while (pos + 4 <= data.length) {
    const h = data.readUInt32LE(pos); pos += 4
    const tag = h & 0x3ff
    let size = (h >> 20) & 0xfff
    if (size === 0xfff) { size = data.readUInt32LE(pos); pos += 4 }
    const body = data.slice(pos, pos + size); pos += size
    if (tag === HWPTAG_PARA_TEXT) {
      const t = paraText(body).replace(/\x00/g, '').trim()
      if (t) all.push(t)
    }
  }
}
all.forEach((t, i) => console.log(`${String(i + 1).padStart(3)}| ${t.replace(/\n/g, ' ⏎ ')}`))
