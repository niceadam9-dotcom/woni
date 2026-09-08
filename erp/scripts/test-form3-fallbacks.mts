/** 별지 3쪽(=별지 4호 1쪽) **폴백 3축** 회귀 가드 — 소방계획서_15 A4-5·A9-7·A9-5·A9-9.
 *
 *  세 축 모두 "값이 없을 때 무엇을 찍는가"이고, 셋 다 한 번씩 **조용히 빈칸을 제출**한 전력이 있다:
 *    ① 기타 3항목(방화문·비상구·방염) — 31-* 응답이 인쇄까지 도달하는가
 *    ② 주차장 옥내 하위(지하·지상·필로티) — 자유 텍스트 매칭
 *    ③ 설치(√)+무응답 → ○ (2026-09-02 사용자 결정으로 '공란'에서 번복)
 *
 *  왜 새로 만들었나(2026-09-08): `test-*` 스위트 전수에 parseParkingSummary·etcMarks를
 *  단언하는 곳이 **0건**이었다. 기존 프로브 2종은 축이 다르다 — _probe-etc-std31은
 *  "DB에 31-* 응답이 있는가"(데이터 축), _probe-etc-real-delta는 "시트 installed 판정이
 *  바뀌는가"(카탈로그 축)만 잰다. **응답 → 인쇄 출력**의 델타는 아무도 안 봤고, 그래서
 *  2026-08-20 재판정이 "코드는 있으나 실측 0건이라 인쇄물은 전부 ☐"에서 멈췄다.
 *  실측 0건에 기댄 판정은 공허하게 초록이 된다 — 코드 축은 **주입한 양성 표본**으로만 갈린다.
 *
 *  단언은 되도록 양방향이다(켜지는가 + 지어내지 않는가). 한쪽만 걸면 "전부 ○"로
 *  위조해도 통과한다 — 이 서식에서 가장 위험한 방향이 그것이다.
 *
 *  무DB·무서버(순수 함수)라 싸다. 실행:
 *    npx tsx --conditions=react-server scripts/test-form3-fallbacks.mts */
import { facilityResultSection, FORM3_ITEMS, parseParkingSummary } from '../src/lib/doc-templates/report9.ts'

type Marks = { door: 'O' | 'X' | 'N'; exit: 'O' | 'X' | 'N'; flame: 'O' | 'X' | 'N' }
const render = (etcMarks?: Marks) =>
  facilityResultSection({ facilityChecks: [], resultMarks: {}, ...(etcMarks ? { etcMarks } : {}) } as never)

/** 라벨이 든 <tr> 한 줄만 뽑는다 — 표 전체를 비교하면 무관한 차이에 묻힌다 */
const rowOf = (html: string, label: string) =>
  (html.split('\n').find(l => l.includes(label)) ?? '(행 없음)').trim()

const LABELS = { door: '방화문', exit: '비상구', flame: '방  염' } as const

const off = render()
const on = render({ door: 'O', exit: 'X', flame: 'N' })

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}\n     ${detail}`) }
}

console.log('[무응답] 기타 3행:')
for (const k of ['door', 'exit', 'flame'] as const) console.log(`  ${k}: ${rowOf(off, LABELS[k])}`)
console.log('\n[응답 주입 O/X/N] 기타 3행:')
for (const k of ['door', 'exit', 'flame'] as const) console.log(`  ${k}: ${rowOf(on, LABELS[k])}`)

console.log('\n판정:')
check('무응답과 주입본이 다르다 (반영 경로가 살아 있다)', off !== on,
  '두 출력이 동일 — 응답이 인쇄에 도달하지 않는다(A4-5·A9-7 원래 주장이 여전히 참)')

for (const k of ['door', 'exit'] as const) {
  check(`${k}: 응답(${k === 'door' ? 'O' : 'X'})이 행을 바꾼다`,
    rowOf(off, LABELS[k]) !== rowOf(on, LABELS[k]),
    `off=${rowOf(off, LABELS[k])}\n     on =${rowOf(on, LABELS[k])}`)
}

// N은 무응답과 같은 표기(／)여야 정상 — 델타가 없는 것이 옳다. 방향을 뒤집어 단언한다.
check('flame: N 응답은 무응답과 같은 표기(／) — 값을 지어내지 않는다',
  rowOf(off, LABELS.flame) === rowOf(on, LABELS.flame),
  `off=${rowOf(off, LABELS.flame)}\n     on =${rowOf(on, LABELS.flame)}`)

// 무응답이 '공란'이 아니라 ／인가 — A4-5/A9-7 제목의 '공란' 부분
check('무응답도 결과칸이 비어 있지 않다 (／ 표기 규약)',
  !/<td class="center mk"><\/td>/.test(rowOf(off, LABELS.door)),
  `door 무응답 행=${rowOf(off, LABELS.door)}`)

// ── A9-9: 설치(√)인데 점검표 응답이 없으면 결과칸이 공란으로 제출되던 것 ──────────
// 2026-09-02 사용자 결정으로 뒤집혔다(report9.ts HEAD:456) — 체크된 설비는 반드시 ○/×.
// 미설치는 여전히 값을 지어내지 않아야 하므로, 두 방향을 함께 단언한다.
const plain = FORM3_ITEMS[16]
const a99On = facilityResultSection({ facilityChecks: [plain], resultMarks: {} } as never)
const a99Off = facilityResultSection({ facilityChecks: [], resultMarks: {} } as never)
console.log(`\n[A9-9] 표본 항목 "${plain}"`)
console.log(`  설치+무응답: ${rowOf(a99On, plain)}`)
console.log(`  미설치      : ${rowOf(a99Off, plain)}`)
check('A9-9: 설치(√)+무응답 → 결과칸이 ○ (공란 아님)',
  /<td class="center mk">○<\/td>/.test(rowOf(a99On, plain)),
  `설치+무응답 행=${rowOf(a99On, plain)}`)
check('A9-9: 미설치는 ○를 지어내지 않는다 (반대 방향)',
  !/<td class="center mk">○<\/td>/.test(rowOf(a99Off, plain)),
  `미설치 행=${rowOf(a99Off, plain)}`)

// ── A9-5: 주차장 옥내 하위(지하/지상/필로티)가 '기계식'만 매칭하던 것 ───────────────
// 지하·필로티는 서식상 옥내의 하위라 상위도 함께 켜야 모순 출력이 안 난다.
// '지상'은 옥외 문맥("옥외 지상 N대")에도 쓰이므로 옥내 명시가 있을 때만 하위로 인정 — 적대 표본으로 건다.
console.log('\n[A9-5] 주차 문자열 파싱')
const pkCases: Array<[string, Partial<ReturnType<typeof parseParkingSummary>>]> = [
  ['지하 20대, 옥상 5대', { pkIn: true, pkInUg: true, pkInGround: false, pkInPiloti: false, pkRoof: true }],
  ['옥내 지상 10대, 필로티 3대', { pkIn: true, pkInGround: true, pkInPiloti: true }],
  ['옥외 지상 10대', { pkIn: false, pkInGround: false, pkOut: true }],   // 적대 표본
  ['기계식 12대', { pkMech: true, pkIn: false }],                        // 종전에 유일하게 되던 축
  // A9-11 후속 — **어떤 체크도 안 켜지는 입력**. 사용자는 값을 넣었는데 서식은 조용히 공란이다.
  // report9-assemble이 이 경우에만 missing으로 알린다(부재는 안 알린다 — 97%에 뜨므로).
  ['자주식 10대', { pkIn: false, pkInUg: false, pkInGround: false, pkInPiloti: false, pkMech: false, pkRoof: false, pkOut: false }],
]
for (const [text, want] of pkCases) {
  const got = parseParkingSummary(text)
  const bad = Object.entries(want).filter(([k, v]) => got[k as keyof typeof got] !== v)
  console.log(`  "${text}" → ${JSON.stringify(got)}`)
  check(`A9-5: "${text}"`, bad.length === 0,
    `어긋난 키: ${bad.map(([k, v]) => `${k} want=${v} got=${got[k as keyof typeof got]}`).join(', ')}`)
}

console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
