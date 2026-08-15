// 소방계획서_22 S4 — 점검표 꼬리 각주 4줄이 현행판 원문과 축자 일치하는지 고정.
// 원천: erp_goal/_form/_별지4호_현행판_추출.txt:507-513 (비고 · ※ 4줄 · 용지 푸터).
// 함정: 따옴표는 U+201C/201D·U+2018/2019, '위치․구조․용도'의 구분자는 U+2024(ONE DOT LEADER)다.
// 전역 치환·눈대중 비교로는 못 잡으므로 코드포인트 단위로 비교한다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, '../erp_goal/_form/_별지4호_현행판_추출.txt'), 'utf8').split(/\r?\n/)
const tpl = readFileSync(join(root, 'src/lib/doc-templates/report4.ts'), 'utf8')

let fail = 0
const check = (name, expected, ok) => {
  if (ok) console.log(`OK   ${name}`)
  else { fail++; console.log(`FAIL ${name}\n     기대: ${JSON.stringify(expected)}`) }
}

// 원문 각주 4줄(507~512) — 4번째 줄은 셀 내 줄바꿈으로 2행에 걸쳐 있다
const lines = src.slice(507 - 1, 513 - 1)  // ['비고', '※…', '※…', '※…', '※…기재하기', '곤란하거나…']
check('원문 앵커(비고)', '비고', lines[0] === '비고')

// 템플릿에서 sheetTail 블록의 텍스트만 추출
const tail = tpl.match(/function sheetTail\(\): string \{[\s\S]*?\n\}/)?.[0] ?? ''
const text = tail.replace(/<br>/g, '\n').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '')

for (const ln of [lines[1], lines[2], lines[3]]) {
  check(`각주 축자: ${ln.slice(0, 24)}…`, ln, text.includes(ln))
}
// 4번째 각주 — 원문의 두 물리행이 모두 존재해야 한다(개행 위치는 조판 재량, 내용은 축자)
check(`각주 축자: ${lines[4].slice(0, 24)}…`, lines[4], text.includes(lines[4]))
check(`각주 축자(이어짐): ${lines[5].slice(0, 24)}…`, lines[5], text.includes(lines[5].trim()))

// U+2024 함정 — 마침표(.)나 가운뎃점(·)으로 바뀌면 원문 축자가 깨진다
check('U+2024 구분자(위치․구조․용도)', 'U+2024', tail.includes('위치․구조․용도'))
// 용지 푸터 — 점검표 전용 문안
check('용지 푸터', '210mm×297mm [백상지(80g/㎡)]', tpl.includes("'<div class=\"footnote\">210mm×297mm [백상지(80g/㎡)]</div>'"))

console.log(fail === 0 ? '\n전건 통과' : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
