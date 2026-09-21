/** HWP 5.0 문서 **앞머리 문단의 글꼴·크기·정렬** 실측 — 「표지를 원본과 같게」의 근거를 댄 자.
 *
 *  왜 필요했나: 표지가 원본과 어떻게 다른지는 글자만 봐서는 모른다(글자는 이미 같았다).
 *  다른 건 **글꼴·크기·정렬**이고, 그건 본문이 아니라 DocInfo에 있다 —
 *    FACE_NAME(19) 글꼴 이름표 · CHAR_SHAPE(21) 크기·굵기 · PARA_SHAPE(25) 정렬
 *  을 풀고, BodyText의 PARA_HEADER(66)/PARA_TEXT(67)/PARA_CHAR_SHAPE(68)로 문단에 잇는다.
 *  CHAR_SHAPE의 크기는 오프셋 42의 INT32이고 단위는 HWPUNIT(1/100 pt)이다.
 *
 *  이 도구가 찍은 답(강순기건물 납품본):
 *    "[ 강순기 건물 ] 소방계획서"  가운데 · HY헤드라인M 32pt
 *    "용도"                       가운데 · 맑은 고딕 11pt
 *  → `build-fire-plan-template.mts`의 `COVER_TITLE_FONT`가 그 값을 그대로 들고 있다.
 *
 *  🚨 **읽기 전용이고, 대상은 실고객 문서다.** 그래서 표지·머리글에 해당하는 **앞 4문단만**
 *    찍는다 — 뒤로 가면 대표자·연락처 같은 PII가 곧바로 나온다(서식 1.1이 5번째 표다).
 *    산출물을 저장소에 커밋하지 말 것(R-2).
 *
 *  실행: node scripts/_probe-hwp-cover-fmt.mjs <파일.hwp>
 */
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { inflateRawSync } from 'node:zlib'

const PATH = process.argv[2]
const cfb = CFB.read(readFileSync(PATH), { type: 'buffer' })
const hb = Buffer.from(CFB.find(cfb, 'FileHeader').content)
const compressed = (hb.readUInt32LE(36) & 1) === 1
const unz = (b) => (compressed ? inflateRawSync(b) : b)
const stream = (n) => unz(Buffer.from(CFB.find(cfb, n).content))

function walk(bytes) {
  const out = []; let i = 0
  while (i + 4 <= bytes.length) {
    const v = bytes.readUInt32LE(i)
    const tag = v & 0x3ff, level = (v >> 10) & 0x3ff
    let size = (v >> 20) & 0xfff, at = i + 4
    if (size === 0xfff) { size = bytes.readUInt32LE(at); at += 4 }
    if (at + size > bytes.length) break
    out.push({ tag, level, size, payload: bytes.subarray(at, at + size) })
    i = at + size
  }
  return out
}

/* ── DocInfo: FACE_NAME(19) · CHAR_SHAPE(21) · PARA_SHAPE(25) ── */
const di = walk(stream('DocInfo'))
const faces = []
for (const r of di) {
  if (r.tag !== 19) continue
  const p = r.payload
  const prop = p.readUInt8(0)
  const len = p.readUInt16LE(1)
  faces.push(p.subarray(3, 3 + len * 2).toString('utf16le'))
}
const charShapes = di.filter(r => r.tag === 21).map((r, i) => {
  const p = r.payload
  const faceIds = Array.from({ length: 7 }, (_, k) => p.readUInt16LE(k * 2))
  const relSize = Array.from({ length: 7 }, (_, k) => p.readUInt8(28 + k))
  const base = p.readInt32LE(42)            // HWPUNIT = 1/100 pt
  const prop = p.readUInt32LE(46)
  return { i, face: faces[faceIds[0]], faceEn: faces[faceIds[1]], relSize: relSize[0],
           pt: base / 100, italic: !!(prop & 1), bold: !!(prop & 2), color: p.readUInt32LE(52) }
})
const ALIGN = ['양쪽', '왼쪽', '오른쪽', '가운데', '배분', '나눔']
const paraShapes = di.filter(r => r.tag === 25).map((r, i) => {
  const p1 = r.payload.readUInt32LE(0)
  return { i, align: ALIGN[(p1 >> 2) & 7] }
})
console.log(`글꼴 ${faces.length}종 · charShape ${charShapes.length} · paraShape ${paraShapes.length}\n`)

/* ── BodyText: 문단 순회 ── */
const WIDE = new Set([1,2,3,11,12,14,15,16,17,18,21,22,23,4,5,6,7,8,19,20])
const dec = (p) => { const o = []; for (let i = 0; i < p.length / 2; i++) { const c = p.readUInt16LE(i*2)
  if (c < 32) { if (WIDE.has(c)) { i += 7; continue } if (c === 13 || c === 10) o.push('\n'); continue } o.push(String.fromCharCode(c)) } return o.join('') }

const bt = walk(stream('/BodyText/Section0'))
let cur = null, shown = 0
for (const r of bt) {
  if (r.tag === 66) {                                    // PARA_HEADER
    cur = { paraShapeId: r.payload.readUInt16LE(8), text: '', cs: [] }
    continue
  }
  if (r.tag === 67 && cur) { cur.text = dec(r.payload); continue }
  if (r.tag === 68 && cur) {                             // PARA_CHAR_SHAPE
    for (let i = 0; i + 8 <= r.payload.length; i += 8)
      cur.cs.push({ start: r.payload.readUInt32LE(i), id: r.payload.readUInt32LE(i + 4) })
    const t = cur.text.trim()
    // 🚨 4문단까지 — 그 뒤는 실고객 PII다(위 머리주석)
    if (t && shown < 4) {
      shown++
      const runs = cur.cs.map(c => { const s = charShapes[c.id]; return s ? `@${c.start} ${s.face}/${s.pt}pt${s.bold?'/굵게':''}${s.relSize!==100?`/상대${s.relSize}%`:''}` : `@${c.start} id=${c.id}?` })
      console.log(`${String(shown).padStart(2)}| "${t.slice(0,40)}"\n    정렬=${paraShapes[cur.paraShapeId]?.align ?? '?'} · ${runs.join(' | ')}`)
    }
    cur = null
  }
}
