/** 조사 — 「안전시설등」·「기타」가 별지 서식 **원문**의 용어인가 (소방계획서_43 S7 제안 근거).
 *  ⚠ `_doc01/*.MD`는 파생 요약본이라 틀린다 — 판정은 `_form/*-placeholder.hwpx` 본문으로만
 *    한다([[feedback_legal_form_source]]).
 *  실행: npx tsx scripts/_probe-43-legal-terms.mts */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const FORMS = ['별지9호', '별지10호', '별지11호']
const NEEDLES = ['안전시설등', '다중이용업소', '소방시설등', '기타']
const dir = path.resolve('../erp_goal/_form')

for (const name of FORMS) {
  const file = path.join(dir, `${name}-placeholder.hwpx`)
  if (!fs.existsSync(file)) { console.log(`${name}: 파일 없음 (${file})`); continue }
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  let text = ''
  for (const p of Object.keys(zip.files)) {
    if (!/\.xml$/i.test(p)) continue
    const xml = await zip.file(p)!.async('string')
    // hwpx 본문 텍스트는 <hp:t> 안에 있다
    text += [...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map(m => m[1]).join('')
  }
  const plain = text.replace(/&#x?[0-9a-fA-F]+;|&[a-z]+;/g, '')
  console.log(`\n── ${name} (본문 ${plain.length}자) ──`)
  for (const n of NEEDLES) {
    const count = plain.split(n).length - 1
    console.log(`   ${n.padEnd(8)} ${count}회${count ? '  ← 서식 원문 용어' : ''}`)
  }
  // 「안전시설등」 주변 문맥 — 어떤 표의 어떤 칸인지 보려고
  const i = plain.indexOf('안전시설등')
  if (i >= 0) console.log(`   문맥: …${plain.slice(Math.max(0, i - 45), i + 45)}…`)
}
