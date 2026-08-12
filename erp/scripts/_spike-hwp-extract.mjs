// 현행 개정판 별지4호(.hwp) 본문 추출 — A4-4·A4-7 판정용 (소방계획서_19 Q-6)
// 실행: node scripts/_spike-hwp-extract.mjs [파일경로]
//
// .hwp 5.0 = OLE 복합문서. BodyText/SectionN 스트림이 zlib(raw deflate)로 압축돼 있고,
// 그 안은 레코드 스트림(헤더 4바이트에 tag·level·size 비트필드)이다.
// 필요한 건 두 가지뿐이라 최소만 판다:
//   HWPTAG_PARA_TEXT(67)  — 문단 텍스트(UTF-16LE, 제어문자는 인라인/확장 구분)
//   HWPTAG_TABLE(76)      — 표 시작(행·열 수) — 쪽 경계·칸 수 판정 단서
import { readFileSync, writeFileSync } from 'fs'
import { inflateRawSync, inflateSync } from 'zlib'
import XLSX from 'xlsx'

const path = process.argv[2] ?? 'F:/AI/ERP/erp_goal/_form/[별지 4] 소방시설등(작동점검¸ 종합점검(최초점검¸ 그 밖의 점검) 점검표(소방시설 자체점검사항 등에 관한 고시).hwp'
const cfb = XLSX.CFB.read(readFileSync(path), { type: 'buffer' })

const entries = cfb.FullPaths.map((p, i) => ({ path: p, content: cfb.FileIndex[i].content, size: cfb.FileIndex[i].size }))
console.log('=== 스트림 목록 ===')
for (const e of entries) if (e.size > 0) console.log(`  ${e.path}  (${e.size} bytes)`)

// FileHeader의 압축 플래그(오프셋 36의 비트0)를 본다
const fh = entries.find(e => /FileHeader$/.test(e.path))
const compressed = fh ? (Buffer.from(fh.content)[36] & 1) === 1 : true
console.log(`\n압축: ${compressed ? '예' : '아니오'}`)

const HWPTAG_BEGIN = 0x10
const TAG_PARA_TEXT = HWPTAG_BEGIN + 51   // 67
const TAG_TABLE = HWPTAG_BEGIN + 60       // 76

function inflateStream(buf) {
  if (!compressed) return buf
  try { return inflateRawSync(buf) } catch { /* fallthrough */ }
  return inflateSync(buf)
}

/** 레코드 스트림에서 문단 텍스트·표 구조를 순서대로 뽑는다 */
function parseSection(buf) {
  const out = []
  let pos = 0
  while (pos + 4 <= buf.length) {
    const header = buf.readUInt32LE(pos)
    const tag = header & 0x3ff
    let size = (header >> 20) & 0xfff
    pos += 4
    if (size === 0xfff) { size = buf.readUInt32LE(pos); pos += 4 }
    const body = buf.subarray(pos, pos + size)
    pos += size

    if (tag === TAG_PARA_TEXT) {
      // UTF-16LE, 단 제어문자(0~31)는 의미가 다르다: 확장(8바이트 소비)·인라인(8)·문자(2)
      let s = ''
      for (let i = 0; i + 1 < body.length;) {
        const c = body.readUInt16LE(i)
        if (c < 32) {
          if ([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23].includes(c)) { i += 16; s += ' ' }
          else if ([4, 5, 6, 7, 8, 9, 19, 20].includes(c)) { i += 16 }
          else { i += 2; if (c === 10 || c === 13) s += '\n' }
        } else { s += String.fromCharCode(c); i += 2 }
      }
      const t = s.replace(/\s+/g, ' ').trim()
      if (t) out.push({ kind: 'text', text: t })
    } else if (tag === TAG_TABLE && body.length >= 10) {
      out.push({ kind: 'table', rows: body.readUInt16LE(4), cols: body.readUInt16LE(6) })
    }
  }
  return out
}

const sections = entries.filter(e => /BodyText\/Section/.test(e.path) && e.size > 0)
console.log(`\n=== 본문 섹션 ${sections.length}개 ===`)
let all = []
for (const s of sections) {
  const items = parseSection(inflateStream(Buffer.from(s.content)))
  console.log(`  ${s.path}: 텍스트 ${items.filter(i => i.kind === 'text').length}줄 · 표 ${items.filter(i => i.kind === 'table').length}개`)
  all = all.concat(items)
}

const outPath = process.argv[3] ?? 'F:/AI/ERP/erp_goal/_form/_별지4호_현행판_추출.txt'
const dump = all.map(i => i.kind === 'table' ? `[표 ${i.rows}행×${i.cols}열]` : i.text).join('\n')
writeFileSync(outPath, dump, 'utf8')
console.log(`\n추출 결과 → ${outPath} (${dump.length}자)`)
console.log('\n=== 앞부분 미리보기 ===')
console.log(dump.slice(0, 1200))
