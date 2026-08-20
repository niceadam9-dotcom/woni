// '설치 설비만' 필터 단일 규칙 프로브 (2026-08-20)
//   배경: 같은 규칙이 네 곳에 복사돼 있어 STD-31(기타사항) 예외가 인쇄에만 들어갔다.
//         인쇄는 항상 대상으로 잡으면서 입력 화면은 숨겨, 별지 9호 3쪽 '기타' 3칸이 채워질 길이 없었다.
//   ① 규칙 자체가 옳은가  ② 네 호출부가 전부 그 규칙을 쓰는가(복사본이 다시 생기면 여기서 걸린다)
// 서버·DB 불필요. 실행: npx tsx scripts/_probe-sheet-visibility.mjs
import { readFileSync } from 'node:fs'
const { sheetShownWhenInstalledOnly, ALWAYS_SHOWN_SHEET_CODES } = await import('../src/lib/sheet-facility-map.ts')
const { pickAutoOpenSheet } = await import('../src/lib/inspection-step-links.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
const S = (sheetCode, installed, responded) => ({ sheetCode, installed, responded })

console.log('\n── ① 규칙 ──')
check('설치된 설비 시트는 보인다', sheetShownWhenInstalledOnly(S('STD-02', true, 0)))
check('미설치 + 무응답 설비 시트는 숨는다 (필터의 본래 목적)', !sheetShownWhenInstalledOnly(S('STD-13', false, 0)))
check('미설치라도 이미 입력이 있으면 숨기지 않는다 (숨기면 유령 입력이 된다)',
  sheetShownWhenInstalledOnly(S('STD-13', false, 3)))
check('기타사항(STD-31)은 미설치·무응답이어도 항상 보인다 — 설비가 아니라 모든 대상물 공통',
  sheetShownWhenInstalledOnly(S('STD-31', false, 0)))
check('다중이용업소(STD-32)는 상시 노출 목록에 넣지 않는다 — 비대상에까지 띄우면 안 된다',
  !ALWAYS_SHOWN_SHEET_CODES.includes('STD-32') && !sheetShownWhenInstalledOnly(S('STD-32', false, 0)))
check('상시 노출 목록은 STD-31 하나뿐', ALWAYS_SHOWN_SHEET_CODES.join(',') === 'STD-31',
  ALWAYS_SHOWN_SHEET_CODES.join(','))

console.log('\n── ② 자동 열기(첫 미완성)도 같은 축을 쓴다 ──')
{
  // 설치 설비가 하나라도 있는 정상 고객 — 전부 미설치면 noFacility 예외로 필터가 통째로 풀린다
  const list = [
    { sheetId: 'z', sheetCode: 'STD-01', installed: true, responded: 9, total: 9 },    // 설치·완료 — 열 필요 없음
    { sheetId: 'a', sheetCode: 'STD-13', installed: false, responded: 0, total: 55 },  // 숨는 시트 — 열면 안 된다
    { sheetId: 'b', sheetCode: 'STD-31', installed: false, responded: 0, total: 4 },   // 상시 노출 — 열려야 한다
  ]
  const picked = pickAutoOpenSheet(list)
  check('화면에 안 보이는 시트를 열지 않는다', picked?.sheetId !== 'a', `열린 시트: ${picked?.sheetCode}`)
  check('기타사항이 미완성이면 자동 열기 후보가 된다', picked?.sheetId === 'b', `열린 시트: ${picked?.sheetCode}`)
}
{
  const done = [
    { sheetId: 'z', sheetCode: 'STD-01', installed: true, responded: 9, total: 9 },
    { sheetId: 'c', sheetCode: 'STD-31', installed: false, responded: 4, total: 4 },
  ]
  check('다 채운 시트는 자동으로 열지 않는다', pickAutoOpenSheet(done) === null)
}
{
  // 설치 정보가 아예 없는 고객은 보드가 전체를 보여준다(Q-12) — 자동 열기도 함께 풀려야 한다
  const noFac = [{ sheetId: 'd', sheetCode: 'STD-13', installed: false, responded: 0, total: 55 }]
  check('설치 정보가 없는 고객은 필터가 풀린다', pickAutoOpenSheet(noFac)?.sheetId === 'd')
}

console.log('\n── ③ 네 호출부가 같은 함수를 쓰는가 (규칙 복사본 재발 방지) ──')
const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
for (const [label, p] of [
  ['점검표 보드', 'src/components/inspections/sheet-group-board.tsx'],
  ['별지 시트 트리', 'src/components/customers/plan-annex-sheet-tree.tsx'],
  ['자동 열기(스텝 링크)', 'src/lib/inspection-step-links.ts'],
  ['인쇄 번들 공란 리포트', 'src/app/(dashboard)/inspections/bundle-actions.ts'],
]) check(`${label} — 공용 규칙 사용`, src(p).includes('sheetShownWhenInstalledOnly'))

// 손으로 쓴 복사본이 남아 있지 않은가 — 'installed || responded > 0' 꼴을 전수로 센다
{
  const files = [
    'src/components/inspections/sheet-group-board.tsx',
    'src/components/customers/plan-annex-sheet-tree.tsx',
    'src/lib/inspection-step-links.ts',
    'src/app/(dashboard)/inspections/bundle-actions.ts',
  ]
  const copies = []
  for (const f of files) {
    for (const [i, line] of src(f).split(/\r?\n/).entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue   // 주석은 설명이라 통과
      if (/\.installed\s*\|\|.*responded\s*>\s*0/.test(line)) copies.push(`${f}:${i + 1}`)
    }
  }
  check('규칙을 손으로 다시 쓴 자리가 없다', copies.length === 0, copies.join('\n       '))
}
// STD-31 코드를 호출부에 다시 하드코딩하지 않았는가 (상수는 lib에만)
{
  const hard = ['src/components/inspections/sheet-group-board.tsx',
    'src/components/customers/plan-annex-sheet-tree.tsx',
    'src/app/(dashboard)/inspections/bundle-actions.ts']
    .filter(f => /sheetCode\s*===\s*'STD-31'/.test(src(f)))
  check("호출부에 'STD-31' 하드코딩이 남아 있지 않다", hard.length === 0, hard.join(', '))
}

console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
process.exit(fail ? 1 : 0)
