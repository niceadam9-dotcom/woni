/** 외관점검표(별지 6호) **원문** 대조 — 소화용수/상수도 항목이 서식에 있는가. 읽기 전용.
 *  원천: erp_goal/_form/외관점검표-placeholder.hwpx (hwpx = zip + Contents/section*.xml)
 *  파생 요약본(_doc01/*.MD)이 아니라 원문을 본다(별지10호에서 요약본 믿고 고칠 뻔한 전례). */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { EXTERIOR_SECTIONS } from '../src/lib/doc-templates/exterior'

const SRC = '../erp_goal/_form/외관점검표-placeholder.hwpx'
const zip = await JSZip.loadAsync(readFileSync(SRC))

const parts = Object.keys(zip.files).filter(n => /Contents\/section\d+\.xml$/i.test(n)).sort()
const out: string[] = []
const say = (s: string) => out.push(s)
say(`원천 = ${SRC}`)
say(`section 파트 = ${parts.length}개 [${parts.join(', ')}]`)

let text = ''
for (const p of parts) text += await zip.file(p)!.async('string')
// <hp:t>…</hp:t> 안이 본문 텍스트다. 태그를 걷어내고 이어붙인다.
const runs = [...text.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map(m => m[1]
  .replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
const body = runs.join('')
say(`텍스트 런 ${runs.length}개 · 총 ${body.length}자`)

const KEYS = ['소화용수', '상수도', '저수조', '단독경보형감지기', '소화전']
say('\n=== 원문 키워드 검색 ===')
for (const k of KEYS) {
  const n = body.split(k).length - 1
  say(`  ${k} : ${n}회${n === 0 ? '   <== 원문에 없음' : ''}`)
  if (n > 0) {
    // 주변 문맥 60자
    let idx = body.indexOf(k)
    for (let c = 0; c < Math.min(n, 2); c++) {
      say(`      …${body.slice(Math.max(0, idx - 30), idx + 40).replace(/\s+/g, ' ')}…`)
      idx = body.indexOf(k, idx + 1)
    }
  }
}

// 섹션 제목이 원문에 있는가 — 구현이 원문을 얼마나 덮는지
//
// ⚠ 공백만 지우면 안 된다. 멀쩡한 sec2가 MISS로 찍혀 '섹션 누락'처럼 보였다.
//   실측한 정체(추측 두 번이 틀렸다 — 코드포인트를 찍고서야 알았다):
//     구현 exterior.ts '옥내·외' 가운뎃점 = U+00B7
//     원문 hwpx        '옥내?외' 가운뎃점 = **U+F0A0 — 사설 사용 영역(PUA)**
//   한글 문서가 심볼 폰트로 찍은 글자라 일반 구분자 목록(·ㆍ‧∙•)으로는 영원히 안 걸린다.
//   PUA 구간(U+E000~U+F8FF)을 통째로 지워야 원문과 구현이 같은 문자열이 된다.
//   ※ 이 저장소의 다른 원문 대조 프로브도 같은 함정을 밟을 수 있다([[risk_tofu_detection]]의
//     'PUA' 축과 같은 뿌리 — 한글 문서는 기호를 PUA로 흘린다).
const norm = (s: string) => s.replace(/[\s·ㆍ‧∙•\u{E000}-\u{F8FF}]/gu, '')
say('\n=== 구현 섹션 제목 14종이 원문에 실재하는가 ===')
const normBody = norm(body)
let missing = 0
for (const s of EXTERIOR_SECTIONS) {
  const head = norm(s.title).slice(0, 8)
  const found = normBody.includes(head)
  if (!found) missing++
  say(`  ${found ? 'OK  ' : 'MISS'} sec${s.sec} ${s.title.slice(0, 40)}`)
  if (!found) {
    // 추측하지 말고 글자를 찍는다 — 구분자 변종은 자리마다 다르다(U+00B7·U+318D·…)
    const cps = [...s.title.slice(0, 12)].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
    say(`       구현 제목 앞 12자 = ${cps.join(' ')}`)
    say(`       norm 후 head    = "${head}"`)
    const anchor = norm('소화전 설비')
    const at = normBody.indexOf(anchor)
    say(`       원문에서 "${anchor}" 위치 = ${at}`)
    if (at >= 0) {
      const around = normBody.slice(Math.max(0, at - 12), at + 12)
      say(`       원문 주변 = "${around}"`)
      say(`       원문 주변 cps = ${[...around].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')}`)
    }
  }
}
say(`\n구현 섹션 ${EXTERIOR_SECTIONS.length}개 중 원문 미발견 ${missing}개`)
say(`구현 총 항목 수 = ${EXTERIOR_SECTIONS.reduce((a, s) => a + s.items.length, 0)}`)

writeFileSync('scripts/_out/ext-form-source.txt', out.join('\n'), 'utf8')
console.log('wrote scripts/_out/ext-form-source.txt')
