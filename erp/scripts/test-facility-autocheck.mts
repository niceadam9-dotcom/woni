/** 점검표 → 1.4 자동 체크 판정 — 소방계획서_49 §9 (2026-09-11)
 *
 *  🚨 등재 이유: 이 축을 단언하는 검사가 **0건**이었다(§8). 자동 체크는 **시스템이 법정 대장에
 *  쓰는 것**이라, 틀리면 아무도 모른 채 소방계획서·별지 9호에 없는 설비가 인쇄된다.
 *
 *  핵심은 「켜는가」가 아니라 **「켜면 안 될 때 안 켜는가」**다:
 *   [B] ／만 있으면 안 켠다 — 「해당 없다」는 진술이지 설치 근거가 아니다
 *   [C] **후보가 둘 이상이면 안 켠다** ← 설계서 §9-2를 뒤집은 그 자리(스프링클러/ESFR)
 *   [D] 이미 설치된 형제가 있으면 안 켠다
 *
 *  실행: npx tsx --conditions=react-server scripts/test-facility-autocheck.mts */
import { readFileSync } from 'node:fs'
import ac from '../src/lib/facility-autocheck.ts'
import fmap from '../src/lib/sheet-facility-map.ts'
import r9 from '../src/lib/doc-templates/report9.ts'

const { planFacilityAutoCheck } = ac as unknown as typeof import('../src/lib/facility-autocheck.ts')
const { form3ItemsForSheet } = fmap as unknown as typeof import('../src/lib/sheet-facility-map.ts')
const { FORM3_ITEMS } = r9 as unknown as typeof import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}  ${d}`) } }

const items = FORM3_ITEMS
type E = { sheet: string; group: string | null; stat: { any: boolean; o: boolean; x: boolean } }
const e = (sheet: string, s: Partial<{ o: boolean; x: boolean }>, group: string | null = null): E =>
  ({ sheet, group, stat: { any: true, o: !!s.o, x: !!s.x } })
const plan = (entries: E[], installedCodes: string[] = []) =>
  planFacilityAutoCheck({ entries: entries as never, form3Items: items, installedCodes })

// 표본을 실카탈로그에서 고른다 — 지어낸 이름은 폴백 경로를 안 타서 판정력이 없다
const SOLO = items.find(i => form3ItemsForSheet(i, items).length === 1)!
const MULTI = items.find(i => form3ItemsForSheet(i, items).length > 1)!
const MULTI_COVERS = form3ItemsForSheet(MULTI, items)
console.log(`표본 — 단독 커버: 「${SOLO}」 / 다중 커버: 「${MULTI}」 → ${MULTI_COVERS.join(' · ')}`)

console.log('\n── A. 양성 — 켜야 할 때 켠다 ──')
ok(plan([e(SOLO, { o: true })]).confirmed.includes(SOLO), '🎯 ○ 응답 → 그 설비를 켠다')
ok(plan([e(SOLO, { x: true })]).confirmed.includes(SOLO), '🎯 × 응답도 켠다 — ×도 점검했다는 증거다')
ok(plan([e(SOLO, { o: true, x: true })]).confirmed.length === 1, '○·× 섞여도 한 번만')
ok(plan([e(SOLO, { o: true }), e(SOLO, { o: true })]).confirmed.length === 1, '같은 설비가 두 시트에서 와도 중복 없음')

console.log('\n── B. ／는 트리거가 아니다 (규칙 ①) ──')
ok(plan([e(SOLO, {})]).confirmed.length === 0,
  '🚨 (음성) 전부 ／면 안 켠다 — 「해당 없다」는 진술로 「있다」를 적을 수 없다')
ok(plan([e(SOLO, {})]).ambiguous.length === 0, '  · ／만 있으면 물어보지도 않는다')
ok(plan([e(SOLO, {}), e(SOLO, { o: true })]).confirmed.includes(SOLO),
  '  · 같은 시트에 ／와 ○가 섞이면 ○가 이긴다(양성 대조)')

console.log('\n── C. 후보가 둘 이상이면 안 켠다 (규칙 ② — §9-2를 뒤집은 자리) ──')
const amb = plan([e(MULTI, { o: true })])
ok(amb.confirmed.length === 0,
  `🎯🚨 (음성) 「${MULTI}」 ○ 하나로 ${MULTI_COVERS.length}개를 켜지 않는다`, JSON.stringify(amb.confirmed))
ok(amb.ambiguous.length === 1 && amb.ambiguous[0].candidates.length === MULTI_COVERS.length,
  '🎯 대신 갈래를 남겨 사람에게 묻는다', JSON.stringify(amb.ambiguous))
ok(!amb.confirmed.some(c => !MULTI_COVERS.includes(c)), '  · 엉뚱한 설비가 섞이지 않는다')
// 같은 갈래가 여러 번 와도 한 번만 묻는다
ok(plan([e(MULTI, { o: true }), e(MULTI, { x: true })]).ambiguous.length === 1, '  · 같은 갈래는 한 번만 묻는다')

console.log('\n── D. 이미 설치된 형제가 있으면 안 켠다 (규칙 ③) ──')
const one = plan([e(MULTI, { o: true })], [MULTI_COVERS[0]])
ok(one.confirmed.length === 0,
  '🚨 (음성) 형제 하나가 이미 대장에 있으면 응답은 그쪽 것 — 나머지를 켜지 않는다', JSON.stringify(one.confirmed))
ok(one.ambiguous.length === 0, '  · 그때는 물어보지도 않는다(모호하지 않다)')
ok(plan([e(SOLO, { o: true })], [SOLO]).confirmed.length === 0,
  '🚨 (음성) 이미 설치된 설비는 다시 쓰지 않는다 — 쓰기는 설비당 최초 1회')

console.log('\n── E. 경계 ──')
ok(plan([]).confirmed.length === 0 && plan([]).ambiguous.length === 0, '응답이 없으면 아무것도 안 한다')
ok(plan([e('존재하지않는시트ZZZ', { o: true })]).confirmed.length === 0,
  '카탈로그에 없는 시트는 켜지 않는다')

console.log('\n── F. 대조군 — 설계서 원안(respondedNotInstalled 직접 사용)과 갈리는가 ──')
/* 🚨 이 절이 이 검사의 존재 이유다. 원안대로면 「${MULTI}」 ○ 하나가 ${MULTI_COVERS.length}건을
   켰다. 구·신이 **다른 답**을 내야 이 수정이 실재한다 — 같으면 아무것도 안 고친 것이다. */
const naive = (entries: E[], installedCodes: string[] = []) => {
  const inst = new Set(items.filter(it => installedCodes.some(c => it === c)))
  const out = new Set<string>()
  for (const { sheet, group, stat } of entries) {
    if (!stat.o && !stat.x) continue
    for (const it of form3ItemsForSheet(sheet, items)) if (!inst.has(it)) out.add(it)
    void group
  }
  return [...out]
}
const old = naive([e(MULTI, { o: true })])
ok(old.length > 1 && amb.confirmed.length === 0,
  `🎯 구·신이 갈린다 — 구=${old.length}건 켬 / 신=0건 켬(물어봄)`, `구=${old.join('·')}`)
ok(naive([e(SOLO, { o: true })]).length === plan([e(SOLO, { o: true })]).confirmed.length,
  '(대조군) 단독 커버에서는 구·신이 같다 — 바꾼 것은 다중 커버 가지뿐이다')

console.log('\n── G. 배선 — 규칙이 옳아도 아무도 안 부르면 소용없다 ──')
/* 🚨 순수 함수만 보면 「판정이 옳다」까지만 안다. 실제 쓰기 경로가 규칙을 지키는지는 소스를 읽어야 한다.
   특히 §9-4는 **이 축에서 가장 중요한 함정**이다 — 자동 체크가 `facilities_verified_at`을 찍으면
   「사람이 확인했다」가 거짓이 되고 1.4 미확인 경고가 스스로 꺼진다(관문이 조용히 죽는다). */
/* 🚨 소스 단언은 **주석과 import를 걷어내고** 해야 한다. 오늘 세 번 같은 데서 속았다:
   ① 「종료일 고치기가 있는가」가 바로 위 주석에 그 말이 있어 버튼을 지워도 초록
   ② 여기서도 「verified_at을 안 쓴다」가 **그러지 말라는 주석** 때문에 빨강
   ③ 순서 비교가 맨 위 `import` 줄을 먼저 잡아 빨강
   설명하는 글과 하는 일은 다르다 — 단언은 **하는 일**만 봐야 한다. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')          // 블록 주석
  .split('\n').filter(l => !/^\s*\/\//.test(l) && !/^\s*import\s/.test(l)).join('\n')

const act = codeOnly(readFileSync(new URL('../src/app/(dashboard)/inspections/facility-autocheck-actions.ts', import.meta.url), 'utf8'))
const save = codeOnly(readFileSync(new URL('../src/app/(dashboard)/inspections/sheet-actions.ts', import.meta.url), 'utf8'))

ok(/planFacilityAutoCheck\(/.test(act), '쓰기 액션이 순수 판정 함수를 부른다(규칙을 다시 적지 않는다)')
ok(!/facilities_verified_at/.test(act),
  '🎯🚨 (음성) 자동 체크가 `facilities_verified_at`을 **건드리지 않는다** — 찍으면 경고가 스스로 꺼진다')
ok(!/saveFacilitiesAction/.test(act),
  '🚨 (음성) replace 방식 `saveFacilitiesAction`을 재사용하지 않는다 — 한 행 켜려다 대장 전체가 지워진다')
ok(/\.update\(|\.insert\(/.test(act) && /eq\('facility_code'/.test(act),
  '행 단위로만 쓴다(설비 코드 지정)')
ok(/installed: true/.test(act), '`installed`만 켠다')
ok(/\.\.\.\(prev\?\.detail \?\? \{\}\)/.test(act),
  '🚨 기존 `detail`(사람이 쓴 비고)을 보존한 채 출처를 얹는다')
// `'use server'` 파일은 async 함수만 내보내야 한다 — 타입 재수출이 화면을 500으로 죽인 전례(2026-09-10)
const exports = (act.match(/^export .*/gm) ?? [])
ok(exports.length > 0 && exports.every(l => l.startsWith('export async function')),
  `🚨 'use server' 파일이 async 함수만 내보낸다(타입 재수출 = 런타임 500)`, exports.join(' | '))

ok(/autoCheckFacilitiesFromSheetAction\(/.test(save), '🎯 점검표 저장이 따라잡기를 실제로 부른다')
ok(/try \{ autoCheck = await autoCheckFacilitiesFromSheetAction/.test(save),
  '🚨 best-effort로 감쌌다 — 대장 반영 실패가 **점검 입력을 날리면 안 된다**')
ok(save.indexOf('autoCheckFacilitiesFromSheetAction(inspectionId)') < save.indexOf('syncStepsAndRevalidate'),
  '🚨 단계 동기화 **앞에서** 돈다 — 대장이 켜지면 필수 분모가 늘어 단계 판정이 달라진다')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
