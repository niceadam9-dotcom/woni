/** 소방계획서 절↔시트 대장 검사 — `src/lib/fire-plan-sections.ts`.
 *
 *  이 대장이 하는 일은 하나다: **50시트가 모두 어느 화면엔가 속한다**는 것을 못 박는 것.
 *  그 불변식이 깨지는 순간을 사람이 아니라 검사가 발견해야 한다 — 이 저장소는 「앵커 0칸」을
 *  **네 번**(1.4·1.8·1.5.2·1.10.1) 사람이 뒤늦게 발견했다.
 *
 *  🚨 가장 중요한 단언은 [2]다. 목차를 대장에서 **파생**하도록 바꾸면서 딥링크 키가 하나라도
 *    사라지면 `?tab=plan&form=1.10#c-1.10.3` 같은 링크가 **조용히** 엉뚱한 화면을 연다.
 *    그래서 「새 키가 생겼는가」가 아니라 **「옛 키 15개가 전부 살아 있는가」**를 묻는다.
 *
 *  실행: npx tsx scripts/test-fire-plan-sections.mts
 */
import {
  FIRE_PLAN_SECTIONS, FIRE_PLAN_FORMS, FIRE_PLAN_FORM_KEYS, CH1_FORM_KEYS,
  FIRE_PLAN_STATUS_KEYS, PLAN_TREE_FORM_KEYS, tabOfForm,
  sectionsOfForm, formOfSheet, sheetCountOfForm,
  type FirePlanFormKey,
} from '../src/lib/fire-plan-sections.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
// 🚨 적재 시점 검증은 **서버 전용 모듈**로 떼어 냈다(manifest 146KB가 클라이언트 번들로 새던
//   것을 막으려고). 검사는 여기를 import해 「그 관문이 실제로 선다」를 밖에서 다시 묻는다 —
//   이 import가 throw 하면 아래 단언에 도달조차 못 한다.
import { verifyFirePlanSections } from '../src/lib/fire-plan-sections-verify.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════
 *  분모부터 세운다. 빈 배열을 훑고 「전부 통과」라 말하면 항진명제다. */
console.log('\n[0] 눈멂 가드 — 분모')
check('manifest 시트가 있다', FIRE_PLAN_MANIFEST.sheets.length > 0, `${FIRE_PLAN_MANIFEST.sheets.length}장`)
check('대장 항목이 있다', FIRE_PLAN_SECTIONS.length > 0, `${FIRE_PLAN_SECTIONS.length}개`)
check('목차 노드가 있다', FIRE_PLAN_FORMS.length > 0, `${FIRE_PLAN_FORMS.length}개`)

/* ══════════════════════ [1] 50 ↔ 50 ══════════════════════
 *  대장 모듈이 적재 시점에 이미 throw 하지만, 검사는 **그 사실을 밖에서 다시 묻는다**.
 *  모듈이 터지면 여기 도달조차 못 하므로 이 블록이 초록이라는 것 자체가 적재 검증의 통과 증명이다. */
console.log('\n[1] 대장 ↔ manifest 1:1')
// 적재 시점 관문이 실제로 도는가 — 명시적으로 한 번 더 부른다(throw 하면 검사가 죽는다)
let verified = false
try { verifyFirePlanSections(); verified = true } catch { verified = false }
check('적재 시점 검증이 통과한다', verified)
const sheetNames = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
const mapped = FIRE_PLAN_SECTIONS.map(d => d.sheet)
check('항목 수 == 시트 수', FIRE_PLAN_SECTIONS.length === sheetNames.length,
  `대장 ${FIRE_PLAN_SECTIONS.length} / manifest ${sheetNames.length}`)
check('대장 시트명 중복 0', new Set(mapped).size === mapped.length,
  `유일 ${new Set(mapped).size}`)
const notInManifest = mapped.filter(s => !sheetNames.includes(s))
check('대장에만 있는 시트 0', notInManifest.length === 0, notInManifest.join(' · '))
const notInRegistry = sheetNames.filter(s => !mapped.includes(s))
check('manifest에만 있는 시트 0', notInRegistry.length === 0, notInRegistry.join(' · '))

/* ══════════════════════ [2] 🚨 딥링크 키 보존 (음성 단언) ══════════════════════
 *  목차를 파생으로 바꾸는 변경의 **유일한 진짜 위험**이다.
 *  기대 목록을 여기 **손으로** 적는다 — 대장에서 파생해 비교하면 둘이 같이 틀려도 초록이 된다.
 *  (제품과 검사가 같은 원천을 보면 그 원천의 오류를 아무도 못 잡는다) */
console.log('\n[2] 딥링크 키 보존 — 옛 15개가 전부 살아 있는가')
const LEGACY_KEYS = [
  '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.10', '1.11', '1.12',
  'ch2', 'ch3', 'cover', 'archive',
]
const LEGACY_CH1 = ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.10', '1.11', '1.12']
for (const k of LEGACY_KEYS) {
  check(`옛 딥링크 키 '${k}' 생존`, (FIRE_PLAN_FORM_KEYS as readonly string[]).includes(k))
}
check('키가 늘지도 줄지도 않았다(15)', FIRE_PLAN_FORM_KEYS.length === LEGACY_KEYS.length,
  `${FIRE_PLAN_FORM_KEYS.length}개`)
check('1장 목차 11개가 순서까지 그대로', CH1_FORM_KEYS.join(',') === LEGACY_CH1.join(','),
  CH1_FORM_KEYS.join(','))
// 완성도 배지 분모 = formStatus 키. 2026-09-20 — 1.4가 [소방시설] 탭으로 승격돼 archive처럼
// 분모에서 빠졌다(그 탭 자신의 warn이 됐다). 종전 「14개」 단언은 그 구계약이라 13으로 갈아끼운다.
check('완성도 노드 13개(archive·이사 노드 1.4 제외)', FIRE_PLAN_STATUS_KEYS.length === 13,
  `${FIRE_PLAN_STATUS_KEYS.length}개`)
check('완성도 노드에 archive가 없다', !(FIRE_PLAN_STATUS_KEYS as readonly string[]).includes('archive'))
check('완성도 노드에 1.4가 없다(이사 노드)', !(FIRE_PLAN_STATUS_KEYS as readonly string[]).includes('1.4'))
// 목차 **순서**도 계약이다 — 모바일 드롭다운·좌측 트리가 이 배열 순서를 그대로 그린다
check('전체 노드 순서가 종전 그대로', FIRE_PLAN_FORM_KEYS.join(',') === LEGACY_KEYS.join(','),
  FIRE_PLAN_FORM_KEYS.join(','))
// 모바일 드롭다운 라벨 — 원천을 옮기면서 **보이는 글자가 달라지지 않았는지** 함께 묻는다.
// (1장만 ' > ', 2·3장·커버는 붙여쓰기, 조회는 접두 없음 — 종전 하드코딩 그대로)
const navLabel = (f: (typeof FIRE_PLAN_FORMS)[number]) =>
  f.group === '조회' ? f.label : f.group === '본문 1장' ? `본문 1장 > ${f.label}` : `본문 ${f.label}`
const LEGACY_NAV: Record<string, string> = {
  '1.1': '본문 1장 > 1.1 일반현황', ch2: '본문 2장 자위소방대',
  ch3: '본문 3장 피난계획', cover: '본문 보고서 커버', archive: '조회·개정이력',
}
for (const [k, want] of Object.entries(LEGACY_NAV)) {
  const f = FIRE_PLAN_FORMS.find(x => x.key === k)!
  check(`모바일 목차 라벨 '${k}' 그대로`, navLabel(f) === want, navLabel(f))
}

/* ══════════════════════ [2b] 이사 노드 — 1.4 → 최상위 [소방시설] 탭 (2026-09-20) ══════════════════════
 *  계약: 대장 키(딥링크 서버 변환의 전제)에는 **살아 있고**, 화면 트리 키에서만 빠진다.
 *  둘 다 빼면 ?tab=plan&form=1.4 구 링크가 조용히 1.1로 떨어진다 — [2]가 그 회귀를 문다. */
console.log('\n[2b] 이사 노드(1.4 → [소방시설] 탭)')
check('대장 키에는 1.4가 산다', (FIRE_PLAN_FORM_KEYS as readonly string[]).includes('1.4'))
check('화면 트리 키에는 1.4가 없다', !(PLAN_TREE_FORM_KEYS as readonly string[]).includes('1.4'))
check('트리 키 14개 = 전체 15 − 이사 1', PLAN_TREE_FORM_KEYS.length === 14,
  `${PLAN_TREE_FORM_KEYS.length}개`)
check("tabOfForm('1.4')가 목적지 탭을 답한다", tabOfForm('1.4') === 'facilities', String(tabOfForm('1.4')))
check('이사 안 한 노드는 tabOfForm이 undefined', tabOfForm('1.5') === undefined)
check('1.4 시트 배정은 그대로 2장(1.4 현황·1.10.3 다중이용업소)', sectionsOfForm('1.4').length === 2,
  sectionsOfForm('1.4').map(d => d.sheet).join(' · '))

/* ══════════════════════ [3] 배정이 실제로 갈라져 있는가 ══════════════════════
 *  🚨 「전부 한 노드」여도 [1]은 초록이다. 배정이 **뜻을 갖는지**를 따로 물어야 한다. */
console.log('\n[3] 배정 분포')
const used = new Set(FIRE_PLAN_SECTIONS.map(d => d.form))
check('모든 시트가 한 노드에 몰려 있지 않다', used.size > 1, `${used.size}개 노드가 쓰인다`)
for (const f of FIRE_PLAN_FORMS) {
  const n = sheetCountOfForm(f.key)
  console.log(`       ${String(n).padStart(2)}장  ${f.key.padEnd(7)} ${f.label}`)
}
// 시트가 0장인 노드는 **있어도 된다**(보고서 커버는 PDF 마지막 쪽이라 워크북 시트가 없다).
// 다만 그게 사고가 아니라 결정임을 못 박는다 — 늘어나면 붉어진다.
const zero = FIRE_PLAN_FORMS.filter(f => sheetCountOfForm(f.key) === 0).map(f => f.key)
check('시트 0장인 노드는 cover 하나뿐', zero.join(',') === 'cover', zero.join(',') || '(없음)')

/* ══════════════════════ [4] 장을 넘나드는 줄 — 이 대장이 있어야 하는 이유 ══════════════════════
 *  🚨 「시트 번호 앞자리 == 노드 앞자리」로 대장을 대신할 수 있었다면 대장이 필요 없다.
 *    아래 세 줄이 그 규칙을 깨므로 대장이 필요하다. 이 단언이 붉어지면 **대장을 지워도 된다**는 뜻이다. */
console.log('\n[4] 교차 배정(대장의 존재 이유)')
const CROSS: Array<[string, FirePlanFormKey, string]> = [
  ['1.9.3 입주사 현황', '1.2', '입주사는 1.2.1 구역표의 「관리주체(입주사)」 열이다'],
  ['1.9 자위소방대 현황', 'ch2', '1장의 자위소방대 요약 — 입력은 2장'],
  ['1.10.3 다중이용업소 관리현황', '1.4', '입력 자리가 1.10 → 1.4로 이사(소방계획서_43 S7)'],
  ['표지', '1.1', '표지 앵커는 고객명·용도뿐 — 둘 다 1.1 축이다'],
]
for (const [sheet, expect, why] of CROSS) {
  check(`'${sheet}' → ${expect}`, formOfSheet(sheet) === expect, why)
}
// 음성 — 표지를 cover로 보내면 안 된다(그 화면은 reportCover만 고친다)
check('표지가 cover 노드가 **아니다**', formOfSheet('표지') !== 'cover')

/* ══════════════════════ [5] 조회 함수 ══════════════════════ */
console.log('\n[5] 조회 함수')
const ch3 = sectionsOfForm('ch3')
check('sectionsOfForm(ch3) == 7장', ch3.length === 7, ch3.map(d => d.sheet).join(' · '))
check('sectionsOfForm 결과가 워크북 순서', ch3.map(d => d.sheet).join(',') ===
  sheetNames.filter(s => ch3.some(d => d.sheet === s)).join(','))
let threw = false
try { formOfSheet('없는 시트') } catch { threw = true }
check('formOfSheet가 모르는 시트에 throw(폴백 없음)', threw)
const f12 = sectionsOfForm('1.12')
check('1.12 노드가 5장을 담당(1.12.1·1.13·1.14.1·1.14.2·1.15)', f12.length === 5,
  f12.map(d => d.sheet).join(' · '))

/* ══════════════════════ [6] 카드 앵커 ══════════════════════
 *  card는 「그 시트 전용 카드가 화면에 있다」는 주장이다. 주장이 거짓이면 미리보기의
 *  「여기서 입력 ↓」 링크가 아무 데도 안 간다. 실제 서식 소스에 그 id가 있는지 본다. */
console.log('\n[6] 카드 앵커가 화면에 실재하는가')
const { readFileSync, existsSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')
const { dirname, resolve } = await import('node:path')
const HERE = dirname(fileURLToPath(import.meta.url))
const COMPONENTS = resolve(HERE, '../src/components/customers')
const FORM_FILE: Partial<Record<FirePlanFormKey, string>> = {
  '1.10': 'plan-form110.tsx', '1.12': 'plan-form1215.tsx',
  ch2: 'plan-ch2.tsx', ch3: 'plan-ch3.tsx', '1.4': 'plan-form14.tsx',
}
/** 서식 화면은 **한 파일이 아니다** — 1.4는 `plan-multi-use-card.tsx`를 불러 1.10.3 카드를 그린다.
 *  그래서 탐색 범위는 「그 파일 + 그 파일이 직접 부르는 형제 컴포넌트」다.
 *  🚨 범위를 `components/customers` 전체로 넓히면 **엉뚱한 화면의 카드도 초록**이 된다 —
 *    이 단언이 묻는 것은 「id가 어딘가 있는가」가 아니라 **「그 화면에서 닿는가」**다. */
const corpusOf = (file: string): string[] => {
  const self = readFileSync(resolve(COMPONENTS, file), 'utf8')
  const siblings = [...self.matchAll(/from\s+'(?:\.\/|@\/components\/customers\/)([\w-]+)'/g)]
    .map(m => `${m[1]}.tsx`)
    .filter(f => existsSync(resolve(COMPONENTS, f)))
  return [self, ...siblings.map(f => readFileSync(resolve(COMPONENTS, f), 'utf8'))]
}
let cardChecked = 0
for (const d of FIRE_PLAN_SECTIONS) {
  if (!d.card) continue
  const file = FORM_FILE[d.form]
  if (!file) { check(`'${d.sheet}' card=${d.card} — 서식 파일 매핑 없음`, false); continue }
  const key = d.card.replace(/^c-/, '')
  // 🚨 「문자열이 있는가」가 아니라 **id 선언**을 묻는다. 주석에 적힌 'c-1.10.3'으로 통과하면
  //   카드가 사라져도 초록이다(이 저장소가 주석을 단언해 세 번 데였다).
  // 템플릿 리터럴로 id를 만드는 서식(form1215·ch3)은 **그 키가 생성 목록에 있는가**를 함께 묻는다 —
  // 리터럴 존재만 보면 목록에서 키가 빠져도 초록이 된다.
  const declared = corpusOf(file).some(src =>
    src.includes(`id="${d.card}"`) || src.includes(`id: '${d.card}'`)
    || (/id=\{`c-\$\{/.test(src) && new RegExp(`'${key.replace('.', '\\.')}[ ']`).test(src)))
  check(`${d.form} 화면에서 카드 ${d.card}에 닿는다`, declared, file)
  cardChecked++
}
check('카드 단언이 실제로 돌았다(0건이면 공허)', cardChecked > 0, `${cardChecked}건`)

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
