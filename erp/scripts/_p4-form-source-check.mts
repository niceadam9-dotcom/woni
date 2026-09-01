/** 별지 원문 대조 — 고가수조 칸이 '유효수량(㎥)'인가 '유효낙차(m)'인가.
 *
 *  왜: 갑지 엑셀 `현1!G25`는 `◦ 유효수량: (   )㎥`인데 PDF `renderS32`는 `◦ 유효낙차: {}m`다.
 *  라벨도 단위도 달라 어느 쪽이 정본인지 원문으로 정해야 한다 — 법정 서식이라 추측 금지.
 *  ⚠ `_doc01/*.MD`는 파생 요약본이라 못 믿는다(feedback_legal_form_source). hwpx 원문만 본다.
 *  ⚠ hwpx는 zip이고 본문은 Contents/section*.xml에 있다.
 *  ⚠ 출력은 파일로 — 콘솔 한글은 CP949에서 뭉개진다. 호출부가 -Encoding UTF8로 읽는다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

const OUT: string[] = []
const say = (s: string) => { OUT.push(s) }

// ── ① 별지 9호 hwpx 원문 ──
{
  const zip = await JSZip.loadAsync(readFileSync('../erp_goal/_form/별지9호-placeholder.hwpx'))
  const names = Object.keys(zip.files).filter(n => /Contents\/section\d+\.xml$/i.test(n)).sort()
  say(`별지9호 hwpx — section 파트 ${names.length}개: ${names.join(', ')}`)
  let text = ''
  for (const n of names) text += await zip.file(n)!.async('string')
  // 본문 글자는 <hp:t> 안에 있다. 태그를 걷어 평문으로.
  const plain = text.replace(/<hp:t>/g, '').replace(/<\/hp:t>/g, '')
    .replace(/<[^>]+>/g, '').replace(/[]/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  say(`본문 길이 ${plain.length}자`)
  for (const kw of ['유효낙차', '유효수량', '고가수조', '압력수조', '가압수조']) {
    const hits = [...plain.matchAll(new RegExp(kw, 'g'))].length
    say(`  '${kw}' ${hits}건`)
  }
  // 고가수조 주변 문맥
  let i = plain.indexOf('고가수조')
  let seen = 0
  while (i >= 0 && seen < 3) {
    say(`  [고가수조 문맥 ${++seen}] ${JSON.stringify(plain.slice(i, i + 160))}`)
    i = plain.indexOf('고가수조', i + 1)
  }
}

// ── ② 별지 4호 현행판 추출본(같은 3-2를 공유한다) ──
{
  const t = readFileSync('../erp_goal/_form/_별지4호_현행판_추출.txt', 'utf8')
  say('')
  say(`별지4호 현행판 추출본 ${t.length}자`)
  for (const kw of ['유효낙차', '유효수량']) {
    say(`  '${kw}' ${[...t.matchAll(new RegExp(kw, 'g'))].length}건`)
  }
  let i = t.indexOf('고가수조')
  let seen = 0
  while (i >= 0 && seen < 3) {
    say(`  [고가수조 문맥 ${++seen}] ${JSON.stringify(t.slice(Math.max(0, i - 20), i + 200))}`)
    i = t.indexOf('고가수조', i + 1)
  }
}

writeFileSync('../_p4-form-source.txt', OUT.join('\n') + '\n', 'utf8')
console.log('written')
