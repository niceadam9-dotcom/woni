/** 모바일 AI 불량 분류 결과 검증(2026-10-06) — 심각도 세 값 밖이면 「보통」·이름 없는 항목 버림 + 라우트·앱 배선
 *  실행: npx tsx scripts/test-classify-defects-normalize.mts */
import { readFileSync } from 'node:fs'
import { normalizeClassifiedDefects } from '../src/lib/classify-defects-normalize.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const j = (v: unknown) => JSON.stringify(v)

console.log('── 정규화 ──')
check('배열 아님 → 빈 목록', j(normalizeClassifiedDefects({ a: 1 })) === '[]' && j(normalizeClassifiedDefects(null)) === '[]')
check('정상 셋은 그대로', j(normalizeClassifiedDefects([
  { defect_name: '소화기 압력 미달', defect_detail: '게이지 적색', severity: '중대' },
  { defect_name: '유도등 점등 불량', defect_detail: '', severity: '경미' },
])) === j([
  { defect_name: '소화기 압력 미달', defect_detail: '게이지 적색', severity: '중대' },
  { defect_name: '유도등 점등 불량', defect_detail: null, severity: '경미' },
]))
const odd = normalizeClassifiedDefects([{ defect_name: ' 감지기 탈락 ', severity: '높음' }, { defect_name: 'x', severity: 3 }, { defect_name: 'y' }])
check('★ 세 값 밖 심각도 → 보통(「높음」·숫자·누락)', odd.every(d => d.severity === '보통') && odd.length === 3, j(odd.map(d => d.severity)))
check('이름은 trim', odd[0].defect_name === '감지기 탈락')
check('이름 없는 항목 버림(빈 문자열·공백·숫자·null)', normalizeClassifiedDefects([
  { defect_name: '' }, { defect_name: '   ' }, { defect_name: 7 }, null, { defect_name: 'ok' },
]).length === 1)

console.log('── 배선 ──')
const route = readFileSync('src/app/api/mobile/classify-defects/route.ts', 'utf8')
check('라우트가 정규화를 거쳐 돌려준다', /normalizeClassifiedDefects\(JSON\.parse\(/.test(route) && !/return NextResponse\.json\(\{ defects: JSON\.parse/.test(route))
const modal = readFileSync('../mobile/components/DefectFormModal.tsx', 'utf8')
check('앱 제안 적용도 세 값 밖이면 보통', /\['경미', '보통', '중대'\] as const\)\.includes\(item\.severity\) \? item\.severity : '보통'/.test(modal))
check('앱 제안 적용이 값을 지우지 않는다(reset·onSaved 호출 없음)', (() => {
  const body = modal.slice(modal.indexOf('function applySuggestion'), modal.indexOf('async function handleSave'))
  return body.length > 0 && !/reset\(\)|onSaved\(\)/.test(body)
})())

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
