// 발행 의도 표식 — 「엑셀 받으려다 점검표 입력하러 간」 쪽지 (2026-09-21 사용자 요청)
//
// 무엇을 고쳤나: 회차 카드의 [엑셀]은 미입력이 있으면 발행 대신 팝업을 띄우고 점검표 화면으로
// **전체 이동**한다. 그 순간 「엑셀을 받으려던 것」이 사라져, 입력을 마치고 돌아와도 사용자가
// 같은 버튼을 **다시** 눌러야 했다. 이동 직전에 쪽지를 적고 돌아온 카드가 소비하게 했다.
//
// 이 검사가 무는 것은 둘이다.
//   ㄱ) 쪽지의 **규칙**(lib/pending-doc-intent) — one-shot·TTL·남의 회차 보존·부서진 쪽지 내성
//   ㄴ) 그 규칙이 화면에 **배선됐는가** — 이 저장소가 반복해 밟은 함정이 여기다. 순수 함수는
//       완벽한데 호출부가 없어 「코드는 그럴듯한데 동작만 없는」 상태가 여러 번 있었다
//       (39 S-5·45 M11·48). 그래서 값 축과 **배선 축**을 함께 문다.
//
// ⚠ 소스 단언은 전부 codeOnly()를 통과한 뒤에 한다 — 이 저장소는 주석에 결함 내력을 길게
//   적는 규약이라, 리터럴을 주석에서 주워 **코드를 지워도 초록**이 되는 사고가 네 번 있었다.
//   계측기 자기 검사(strippedStats)를 먼저 세워 두는 이유도 같다: 걷어냈다고 **믿는 것**과
//   걷어낸 것은 다르다(CRLF에서 사본들이 통째로 죽어 있던 전례).
//
// 서버·DB 없이 순수 함수 + 소스만 본다 — pre-push(무서버 게이트)에 얹을 수 있다.
// 실행: npx tsx scripts/test-pending-doc-intent.mts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { codeOnly, strippedStats } from './_code-only.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  writePendingDoc, takePendingDoc, parsePendingDoc, isExpired,
  PENDING_DOC_KEY, PENDING_DOC_TTL_MS,
} = await import('../src/lib/pending-doc-intent.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`) }
}

/** 가짜 sessionStorage — 실제 저장소 없이 규칙만 본다. `throws`로 사생활 모드도 흉내낸다 */
function mkStore(init?: Record<string, string>, throws = false) {
  const m = new Map(Object.entries(init ?? {}))
  return {
    getItem: (k: string) => { if (throws) throw new Error('boom'); return m.get(k) ?? null },
    setItem: (k: string, v: string) => { if (throws) throw new Error('boom'); m.set(k, v) },
    removeItem: (k: string) => { if (throws) throw new Error('boom'); m.delete(k) },
    has: (k: string) => m.has(k),
    raw: (k: string) => m.get(k) ?? null,
  }
}

const T0 = 1_700_000_000_000
const ID = 'insp-aaaa'
const OTHER = 'insp-bbbb'

console.log('— ① 왕복: 적은 쪽지를 같은 회차가 소비한다')
{
  const s = mkStore()
  writePendingDoc(ID, 'xlsx', T0, s)
  check('적으면 저장소에 남는다', s.has(PENDING_DOC_KEY))
  check('같은 회차가 소비하면 kind가 나온다', takePendingDoc(ID, T0 + 1_000, s) === 'xlsx')
}
{
  const s = mkStore()
  writePendingDoc(ID, 'bundle', T0, s)
  check('bundle도 그대로 왕복한다', takePendingDoc(ID, T0 + 1_000, s) === 'bundle')
}

console.log('\n— ② one-shot: 읽는 즉시 사라진다 (★ 유령 발행 방어)')
// 이게 무너지면 새로고침·다음 방문마다 엑셀이 저절로 떨어진다. 변이축: removeItem을 지우면 빨강.
{
  const s = mkStore()
  writePendingDoc(ID, 'xlsx', T0, s)
  const first = takePendingDoc(ID, T0 + 1_000, s)
  check('첫 소비는 kind', first === 'xlsx')
  check('소비 직후 저장소가 비었다', !s.has(PENDING_DOC_KEY), `남은 값 ${s.raw(PENDING_DOC_KEY)}`)
  check('두 번째 소비는 null (재발행 없음)', takePendingDoc(ID, T0 + 2_000, s) === null)
}

console.log('\n— ③ TTL: 딴 일 하다 한참 뒤에 온 것은 다른 용무다')
{
  const s = mkStore()
  writePendingDoc(ID, 'xlsx', T0, s)
  check('만료 직전(TTL-1ms)은 살아 있다', takePendingDoc(ID, T0 + PENDING_DOC_TTL_MS - 1, s) === 'xlsx')
}
{
  const s = mkStore()
  writePendingDoc(ID, 'xlsx', T0, s)
  check('정확히 TTL이면 만료', takePendingDoc(ID, T0 + PENDING_DOC_TTL_MS, s) === null)
  check('만료 쪽지는 치운다', !s.has(PENDING_DOC_KEY))
}
{
  // 시계 되감김 — at이 미래면 age가 음수라 TTL이 영영 안 끝난다. 만료로 쳐야 한다
  const s = mkStore()
  writePendingDoc(ID, 'xlsx', T0 + 60_000, s)
  check('미래 시각 쪽지는 만료(시계 되감김)', takePendingDoc(ID, T0, s) === null)
  check('되감긴 쪽지도 치운다', !s.has(PENDING_DOC_KEY))
}
check('isExpired 경계: TTL-1 미만은 살아있다', !isExpired({ inspectionId: ID, kind: 'xlsx', at: T0 }, T0 + PENDING_DOC_TTL_MS - 1))
check('isExpired 경계: TTL은 만료', isExpired({ inspectionId: ID, kind: 'xlsx', at: T0 }, T0 + PENDING_DOC_TTL_MS))

console.log('\n— ④ 남의 회차 쪽지는 소비도 삭제도 하지 않는다 (★)')
// 지워 버리면 정작 그 회차가 돌아왔을 때 의도를 잃는다. 「null이면 지운다」로 뭉뚱그리면 안 된다.
{
  const s = mkStore()
  writePendingDoc(OTHER, 'xlsx', T0, s)
  check('다른 회차가 읽으면 null', takePendingDoc(ID, T0 + 1_000, s) === null)
  check('그래도 쪽지는 **남아 있다**', s.has(PENDING_DOC_KEY), '남의 쪽지를 대신 버렸다')
  check('주인이 오면 그제야 소비된다', takePendingDoc(OTHER, T0 + 2_000, s) === 'xlsx')
}

console.log('\n— ⑤ 부서진 쪽지 내성: 저장소에 뭐가 들었든 화면은 살아야 한다')
check('파싱 불가', parsePendingDoc('{{{') === null)
check('배열', parsePendingDoc('[]') === null)
check('null 리터럴', parsePendingDoc('null') === null)
check('id 없음', parsePendingDoc(JSON.stringify({ kind: 'xlsx', at: T0 })) === null)
check('id 빈 문자열', parsePendingDoc(JSON.stringify({ inspectionId: '', kind: 'xlsx', at: T0 })) === null)
check('모르는 kind는 거른다', parsePendingDoc(JSON.stringify({ inspectionId: ID, kind: 'pdf', at: T0 })) === null)
check('at이 숫자가 아니면 거른다', parsePendingDoc(JSON.stringify({ inspectionId: ID, kind: 'xlsx', at: '어제' })) === null)
check('at이 NaN이면 거른다', parsePendingDoc('{"inspectionId":"x","kind":"xlsx","at":null}') === null)
{
  const s = mkStore({ [PENDING_DOC_KEY]: '{{{' })
  check('부서진 쪽지를 읽어도 던지지 않는다', takePendingDoc(ID, T0, s) === null)
  check('부서진 쪽지는 치운다 (매 방문 재파싱 방지)', !s.has(PENDING_DOC_KEY))
}

console.log('\n— ⑥ 저장소가 없거나 던져도 조용히 종전 동작으로 떨어진다')
// SSR(window 없음)·사생활 모드·용량 초과. 표식을 못 쓰면 「사용자가 다시 누르기」일 뿐이고,
// 그것 때문에 화면이 죽으면 안 된다.
check('store=null이면 take는 null', takePendingDoc(ID, T0, null) === null)
{
  let threw = false
  try { writePendingDoc(ID, 'xlsx', T0, null) } catch { threw = true }
  check('store=null이어도 write가 던지지 않는다', !threw)
}
{
  const s = mkStore({}, true)
  let threw = false
  try { writePendingDoc(ID, 'xlsx', T0, s) } catch { threw = true }
  check('저장소가 던져도 write가 삼킨다', !threw)
  try { threw = false; check('저장소가 던져도 take는 null', takePendingDoc(ID, T0, s) === null) } catch { threw = true }
  check('저장소가 던져도 take가 던지지 않는다', !threw)
}
check('빈 inspectionId로는 소비하지 않는다', takePendingDoc('', T0, mkStore({ [PENDING_DOC_KEY]: JSON.stringify({ inspectionId: '', kind: 'xlsx', at: T0 }) })) === null)

// ────────────────────────────────────────────────────────────────────────────
// 배선 축 — 규칙이 아무리 옳아도 **호출부가 없으면 아무 일도 일어나지 않는다**
// ────────────────────────────────────────────────────────────────────────────
console.log('\n— ⑦ 계측기 자기 검사: 주석을 실제로 걷어냈는가')
const CARD = join(ROOT, 'src/components/customers/plan-annex-round-card.tsx')
const SHEET = join(ROOT, 'src/components/inspections/sheet-entry-client.tsx')
const cardRaw = readFileSync(CARD, 'utf8')
const sheetRaw = readFileSync(SHEET, 'utf8')
for (const [name, raw] of [['회차 카드', cardRaw], ['점검표 화면', sheetRaw]] as const) {
  const st = strippedStats(raw)
  check(`${name}: 주석을 걷어냈다 (지운 글자 ${st.removed})`, st.removed > 0, '한 글자도 못 걷었다 — CRLF 함정 재발')
  check(`${name}: 남은 줄주석 0`, st.leftover === 0, `${st.leftover}줄 생존`)
}
const card = codeOnly(cardRaw)
const sheet = codeOnly(sheetRaw)

console.log('\n— ⑧ 회차 카드 배선: 쪽지 없는 탈출구가 없는가 (★ 이게 핵심 단언이다)')
// 「쪽지를 적는다」가 아니라 **「적지 않고 나가는 길이 없다」**를 문다. 전자는 경로가 하나만
// 있어도 초록이지만, 실제 결함은 늘 「새로 낸 두 번째 출구」에서 난다(가드 분기가 이미 둘이다).
const assigns = [...card.matchAll(/window\.location\.assign\(/g)].map(m => m.index!)
const writes = [...card.matchAll(/writePendingDoc\(/g)].map(m => m.index!)
check(`점검표로 나가는 출구가 ${assigns.length}곳`, assigns.length >= 1, '이동 경로가 사라졌다')
check('출구마다 쪽지가 있다 (출구 수 = 쪽지 수)', assigns.length === writes.length,
  `출구 ${assigns.length} vs 쪽지 ${writes.length} — 쪽지 없이 나가는 길이 생겼다`)
check('쪽지는 이동 **앞**에서 적는다', writes.every((w, i) => w < assigns[i]),
  'assign 뒤에 적으면 그 줄은 실행되지 않는다')
check('가드가 무엇을 하려던 것인지(kind)를 받는다', /blanksGuardThenGo\([^)]*kind: PendingDocKind\)/.test(card))
check('엑셀 경로는 xlsx로 부른다', /blanksGuardThenGo\(inspectionId, 'xlsx'\)/.test(card))
check('전체 인쇄 경로는 bundle로 부른다', /blanksGuardThenGo\(r\.docs!\.inspectionId, 'bundle'\)/.test(card))

console.log('\n— ⑨ 복귀 소비 배선')
check('복귀 시 쪽지를 소비한다', /takePendingDoc\(id,/.test(card))
check('소비 결과로 엑셀을 **자동 실행**한다', /downloadWorkbook\(id, \{ skipGuard: true \}\)/.test(card))
check('자동 실행은 가드를 건너뛴다(왕복 팝업 방어)', /skipGuard\?: boolean/.test(card) && /!opts\?\.skipGuard && !blanksGuardThenGo/.test(card))
// 음성 축 — bundle을 자동 실행하면 안 된다. window.open은 제스처 없이 반드시 차단되므로
// 「자동 실행한 척하고 아무 일도 안 일어나는」 화면이 된다. xlsx로 좁혀져 있는가를 묻는다.
check('bundle은 자동 실행하지 않는다 (xlsx로 좁혀져 있다)', /kind === 'xlsx'\) void downloadWorkbook/.test(card),
  '자동 실행이 kind로 안 갈려 있다 — 인쇄까지 자동 실행하면 조용히 막힌다')
check('막혔을 때의 보장 경로(배너)가 있다', /round-resume-banner/.test(card))
check('배너의 [지금 받기]도 가드를 건너뛴다', /round-resume-xlsx/.test(card))
check('배너의 인쇄는 사용자 클릭으로 연다', /round-resume-bundle/.test(card))

console.log('\n— ⑩ 점검표 화면 보조 버튼: 왕복 자체를 없애는 길')
check('WorkbookXlsxButton을 재사용한다 (받기 경로 한 벌 규약)', /import \{ WorkbookXlsxButton \}/.test(sheet))
check('compact 표면으로 쓴다', /<WorkbookXlsxButton[^>]*variant="compact"/.test(sheet))
// ★ 음성 축(2026-09-21 재조정) — 여기에 **두 번째 이름**을 만들지 않는다. 처음엔
//   `label="입력 마치고 엑셀 받기"`로 두려 했는데, 같은 날 사용자 지시로 이 문서의 이름이
//   `WORKBOOK_LABEL` 한 벌로 모였다(test-workbook-label이 그 분기를 문다). 이름을 여기서 갈면
//   «같은 문서, 화면마다 다른 이름»으로 되돌아간다. 「지금 받을 수 있다」는 **자리**가 말한다.
check('라벨을 덮어쓰지 않는다 (이름은 한 벌)',
  !/<WorkbookXlsxButton[^>]*\blabel=/.test(sheet), '라벨 override가 되살아났다')
// 음성 축 — 여기에 fetch를 새로 짜면 X-Workbook-Missing 고지가 또 새는 길이 생긴다(그 버튼이
// 존재하는 이유 자체가 window.open 시절 고지가 한 번도 안 닿았던 사고다)
check('고지 경로를 복사하지 않았다 (workbook 라우트 직접 fetch 없음)',
  !/fetch\(`\/inspections\/\$\{inspectionId\}\/workbook`\)/.test(sheet),
  '점검표 화면이 받기 경로를 따로 짰다 — 고지가 새는 두 번째 길')

console.log(`\n${fail === 0 ? '✅' : '❌'} pending-doc-intent — 통과 ${pass} / 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
