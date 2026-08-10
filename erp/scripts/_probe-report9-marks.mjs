// 별지 9호 3쪽 점검결과(○/×/／) 인쇄 재점검 프로브 (2026-08-10, 소방계획서_14_점검업무 기안 검증)
// 서버·DB 불필요 — 순수 렌더 대조 (test-spec-derive.mts 패턴). 실행: npx tsx scripts/_probe-report9-marks.mjs
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

// 점검표 롤업 결과를 그대로 흉내: 옥내소화전=양호○, 소화기구=불량×, 스프링클러=해당없음／, 유도등=미입력(공란)
const d = {
  customerName: 'T', purpose: '', address: '', repName: '', repPhone: '', managerName: '', managerPhone: '',
  facilityChecks: ['소화기구 및 자동소화장치', '옥내소화전설비'],
  resultMarks: {
    '옥내소화전설비': 'O',
    '소화기구 및 자동소화장치': 'X',
    '스프링클러설비': 'N',
  },
  muResults: {}, defectRows: [], assistants: [], main: {}, multiUseCounts: {},
  ledgerCodes: [], specs: {},
}

const html = renderReport9(d)

// 3쪽 표 행 = <tr>…<td class="pre">설비명</td><td class="center">기호</td> — 행 조각 안에서 기호를 판정한다
const rows = html.split(/<tr[^>]*>/)
const rowOf = (label) => rows.find(r => r.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))) ?? ''
const markIn = (label) => {
  const m = rowOf(label).match(/class="center"[^>]*>([^<]*)</)
  return (m?.[1] ?? '').trim()
}

check('옥내소화전설비 = ○(양호) 인쇄', markIn('옥내소화전설비') === '○', `실제: "${markIn('옥내소화전설비')}"`)
check('소화기구 = ×(불량) 인쇄', markIn('소화기구 및 자동소화장치') === '×', `실제: "${markIn('소화기구 및 자동소화장치')}"`)
check('스프링클러 = /(해당없음) 인쇄', markIn('스프링클러설비') === '/', `실제: "${markIn('스프링클러설비')}"`)
check('유도등 = 미입력 공란', markIn('유도등') === '', `실제: "${markIn('유도등')}"`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
