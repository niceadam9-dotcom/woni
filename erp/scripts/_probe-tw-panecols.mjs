/** 작업대 칸 폭 조절이 기대는 Tailwind 클래스가 **실제로 생성되는지** 확인한다.
 *
 *  `lg:grid-cols-[var(--wb-lg)]`가 생성되지 않으면 화면은 에러 없이 grid-cols-1로 남는다 —
 *  즉 lg 이상에서 3칸이 세로로 쌓이는데 콘솔에는 아무 말도 없다. tsc·eslint로는 절대 안 잡힌다.
 *  그래서 실제 PostCSS 파이프라인을 돌려 산출 CSS에서 규칙을 찾는다.
 *
 *  실행: node scripts/_probe-tw-panecols.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const root = path.resolve(import.meta.dirname, '..')
const entry = path.join(root, 'src/app/globals.css')

const out = await postcss([tailwind()]).process(fs.readFileSync(entry, 'utf8'), { from: entry })
const css = out.css

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log(`산출 CSS ${Math.round(css.length / 1024)}KB`)

// 1) 변수 기반 grid-template-columns 규칙이 생성됐는가
ok('grid-cols-[var(--wb-lg)] 규칙 생성', css.includes('var(--wb-lg)'),
  'lg 이상에서 3칸이 세로로 쌓인다')
ok('grid-cols-[var(--wb-2xl)] 규칙 생성', css.includes('var(--wb-2xl)'),
  '2xl 재배분이 사라진다')

// 2) 그 규칙이 grid-template-columns로 나가는가 (다른 속성으로 잘못 붙지 않았는지)
const tplRules = css.split('}').filter(b => b.includes('var(--wb-lg)') || b.includes('var(--wb-2xl)'))
ok('grid-template-columns 속성으로 출력', tplRules.length > 0
  && tplRules.every(b => b.includes('grid-template-columns')),
  tplRules.map(b => b.trim().slice(0, 120)).join(' | ') || '규칙 없음')

// 3) 미디어쿼리 안에 들어갔는가 — 좁은 화면 세로 스택(R6-10) 보존 확인
const lgIdx = css.indexOf('var(--wb-lg)')
const beforeLg = css.slice(0, lgIdx)
ok('반응형 변형으로 생성(미디어쿼리 안)', lgIdx > 0 && beforeLg.lastIndexOf('@media') > beforeLg.lastIndexOf('}\n}'),
  '미디어쿼리 밖이면 폰에서도 3칸이 된다')

// 4) 종전 고정 비율 클래스는 더 이상 안 쓰므로 남아 있지 않아야 정상(잔재 감지)
ok('종전 하드코딩 비율 클래스 미사용', !css.includes('minmax(0,1.15fr)'),
  '옛 클래스가 남아 있으면 어느 쪽이 이기는지 모호해진다')

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
