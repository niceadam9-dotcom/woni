/** 초안 인쇄 HTML에 미입력 노란 하이라이트가 남지 않는지 실측 (읽기 전용, DB 불필요)
 *  실행: npx tsx scripts/_probe-print-no-highlight.mts
 *
 *  왜 이 검증이 필요한가: BASE_CSS가 `print-color-adjust: exact`라 .missing 노란 배경이
 *  **인쇄에서 의도적으로 살아난다**. 화면 미리보기 HTML(highlight:true)을 그대로 인쇄하면
 *  법정 서식에 노란 칠이 찍힌다 — 그래서 인쇄 경로는 highlight:false로 다시 렌더한다.
 *  하이라이트를 만드는 지점은 base.ts의 val() 하나뿐이므로 여기를 고정한다. */
import { val, BASE_CSS } from '../src/lib/doc-templates/base'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} — ${d}`) } }

// 1. 하이라이트 분기 — 인쇄 경로(false)에서 .missing이 사라져야 한다
check('빈 값 + highlight:true → .missing 삽입 (미리보기)', val('', { highlight: true }).includes('class="missing"'), val('', { highlight: true }))
check('빈 값 + highlight:false → .missing 없음 (인쇄)', !val('', { highlight: false }).includes('missing'), val('', { highlight: false }))
check('빈 값 + 옵션 없음(기본) → .missing 없음', !val('').includes('missing'), val(''))
check('공백만 있는 값도 미입력 취급', val('   ', { highlight: true }).includes('class="missing"'), val('   ', { highlight: true }))
check('값이 있으면 하이라이트 무관', val('홍길동', { highlight: true }) === '홍길동', val('홍길동', { highlight: true }))

// 2. 이 검증이 성립하는 전제 — CSS가 실제로 배경을 인쇄에 강제하고 .missing이 노란색이다
check('BASE_CSS가 배경을 인쇄에 강제(print-color-adjust:exact)', BASE_CSS.includes('print-color-adjust: exact'), '')
check('.missing이 노란 배경', /\.missing\s*\{\s*background:\s*#fff7cc/.test(BASE_CSS), '')
check('@page A4 여백 고정 — 브라우저 인쇄도 이 규격을 따른다', BASE_CSS.includes('@page { size: A4; margin: 15mm 13mm; }'), '')

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
