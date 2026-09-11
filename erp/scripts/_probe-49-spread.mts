/** §9-2 전제 검증 — 「respondedNotInstalled를 그대로 자동 체크 트리거로 쓴다」가 성립하는가
 *
 *  🚨 의심: `rollUpForm3Results:391`이 **설치된 형제가 하나도 없으면** 응답을 그 중분류가 덮는
 *  항목 **전체로 전개**한다(`installedHere.length > 0 ? installedHere : items`).
 *  그리고 `form3ItemsForSheetGroup:198-201`의 폴백(미등재 시트 = STD-15·EXT 계열)은
 *  **시트가 덮는 항목 전부**를 준다. 이 기능이 노리는 시나리오가 정확히 **1.4가 완전히 빈 상태**라,
 *  하필 그때만 트리거 배열이 부풀 수 있다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-49-spread.mts */
import fmap from '../src/lib/sheet-facility-map.ts'
import r9 from '../src/lib/doc-templates/report9.ts'

const { rollUpForm3Results, form3ItemsForSheet, form3ItemsForSheetGroup, SHEET_GROUP_FORM3_MAP } =
  fmap as unknown as typeof import('../src/lib/sheet-facility-map.ts')
const { FORM3_ITEMS } = r9 as unknown as typeof import('../src/lib/doc-templates/report9.ts')

const items = FORM3_ITEMS
console.log(`별지 3쪽 항목 수 = ${items.length}`)

// 매핑에 등재된 시트 이름(정규화 전 원본 키)
const registered = new Set(Object.keys(SHEET_GROUP_FORM3_MAP))
console.log(`중분류 매핑 등재 시트 = ${registered.size}개: ${[...registered].join(' · ')}`)

// 시트 후보 — form3 항목명 자체가 시트명과 겹치는 구조라 항목명을 시트명으로 써서 커버리지를 잰다
const sheetNames = [...new Set([...items, ...registered])]
const multi: Array<{ sheet: string; covers: string[]; reg: boolean }> = []
for (const s of sheetNames) {
  const covers = form3ItemsForSheet(s, items)
  if (covers.length > 1) multi.push({ sheet: s, covers, reg: registered.has(s) })
}
console.log(`\n한 시트가 form3 항목 2개 이상을 덮는 경우 = ${multi.length}건`)
multi.slice(0, 8).forEach(m =>
  console.log(`   ${m.reg ? '[등재]' : '[미등재]'} ${m.sheet} → ${m.covers.length}개: ${m.covers.slice(0, 5).join(' · ')}`))

const unreg = multi.filter(m => !m.reg)
console.log(`\n그중 **미등재**(폴백 = 시트 전개) = ${unreg.length}건`)

if (unreg.length === 0) {
  console.log('\n✅ 미등재이면서 여러 항목을 덮는 시트가 없다 — 이 표본에서는 전개가 안 일어난다')
  process.exit(0)
}

// 실증 — 그 시트에 ○ 응답 1건만 주고, 대장이 빈 경우 트리거가 몇 건이 되는지
const t = unreg[0]
const entries = [{ sheet: t.sheet, group: null, stat: { any: true, o: true, x: false } }]
const gCovers = form3ItemsForSheetGroup(t.sheet, null, items)
const empty = rollUpForm3Results(entries as never, items, []).axisWarnings.respondedNotInstalled
const withOne = rollUpForm3Results(entries as never, items, [t.covers[0]]).axisWarnings.respondedNotInstalled

console.log(`\n── 표본: 「${t.sheet}」 시트에 ○ 응답 1건 (중분류 미상)`)
console.log(`   그 시트가 덮는 항목 = ${gCovers.length}개`)
console.log(`   ① 1.4가 완전히 빈 경우  → 트리거 ${empty.length}건: ${empty.slice(0, 6).join(' · ')}`)
console.log(`   ② 형제 하나가 이미 설치 → 트리거 ${withOne.length}건: ${withOne.slice(0, 6).join(' · ')}`)

console.log('\n=== 판정 ===')
if (empty.length > 1) {
  console.log(`❌ **전제가 깨진다.** 응답 1건이 설비 ${empty.length}개를 자동 체크 대상으로 만든다.`)
  console.log('   respondedNotInstalled를 그대로 쓰면 §9-3 규칙 ②(형제 전파 금지)를 어긴다 = 서림사 사고의 자동화판.')
  console.log(`   ⭐ 대조군이 원인을 가른다 — 형제 하나만 설치돼 있어도 ${withOne.length}건으로 줄어든다.`)
  console.log('      즉 전개는 「전부 미설치」일 때만 일어나고, 그게 바로 이 기능의 대상 상황이다.')
  process.exit(1)
}
console.log('✅ 전제 성립')
process.exit(0)
