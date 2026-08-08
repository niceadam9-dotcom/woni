/** 중복 입력 제거 회귀 테스트 — 대장 파생·미러 값이 별지 9호 HTML에 실제로 인쇄되는지 (2026-08-08)
 *
 *  실행: npx tsx scripts/test-spec-derive.mts  (동적 import — tsx v4.21+node24는 .ts 정적 named import를
 *        해석하지 못한다, project_soban11 참조). 서버·DB가 필요 없는 순수 렌더 대조라 test:all 무서버 단계다.
 *
 *  고정하는 계약:
 *    ① 별지 9호 3쪽 소화기구·피난기구 하위 체크칸이 실제 데이터로 채워진다 (종전 ck(false) 하드코딩)
 *    ② 피난기구 종류의 저장소는 세부제원 하나이고, 3쪽은 그 11종을 서식 원문대로 3그룹으로 접어 표시한다
 *    ③ 가스계 설비 종류·유도표지·피난유도선은 1.4 대장에서, 비상용승강기는 건물 정보에서 파생된다
 *       — 세부제원에 사본을 저장하지 않으므로 spec이 비어 있어도 인쇄돼야 한다 */

const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

const d = {
  customerName: 'T', purpose: '', address: '', repName: '', repPhone: '', managerName: '', managerPhone: '',
  facilityChecks: ['피난기구', '이산화탄소소화설비', '유도표지'],
  resultMarks: {}, muResults: {}, defectRows: [], assistants: [], main: {}, multiUseCounts: {},
  // 대장: 가스계 이산화탄소 + 유도표지 + 소화기구 하위(주거용)만 설치
  ledgerCodes: ['피난기구', '이산화탄소소화설비', '유도표지', '소화기구 및 자동소화장치', '주거용주방자동소화장치'],
  building: { emergency_elevator_count: 3 },
  specs: {
    s36_evac: {
      evac_equipment: { types: ['피난사다리', '완강기', '하향식피난구용내림식사다리'] },
      guide_light: { types: ['통로'] },   // 사용자 고유 입력 — 유도표지는 대장에서 파생돼야 한다
    },
    s34_gas: { gas_system: { pressure_class: '고압식' } },  // system 미저장 → 파생만으로 체크돼야
    s38_activity: { smoke_lobby: { targets: 'A동' } },       // elevator_count 미저장 → 건물값 3
  },
} as unknown as Parameters<typeof renderReport9>[0]

const html = renderReport9(d)

/** 라벨이 들어 있는 '조각'을 찾는다 — 조각 = <br>·태그·공백으로 끊긴 최소 단위.
 *  체크박스 [√]/[ ]는 라벨 바로 앞에 붙으므로 조각 안에서 판정하면 이웃 항목에 오염되지 않는다. */
function segs(scope = html): string[] {
  return scope.replace(/&nbsp;/g, ' ').split(/<br\s*\/?>|<\/?t[dhr][^>]*>|<\/?div[^>]*>/i)
}
/** 세부현황 한 개 절만 잘라낸다 — 같은 낱말이 3쪽·다중이용업 표에도 있어 전체 검색은 순번이 어긋난다 */
function section(no: string): string {
  const i = html.indexOf(`${no}.`)
  if (i < 0) return ''
  const j = html.indexOf('sec-title', i + 1)
  return html.slice(i, j < 0 ? undefined : j)
}
/** 라벨 직전 체크박스가 √인가 (같은 조각 안에서 라벨 앞부분만 본다) */
function checkedAt(label: string, occurrence = 0, scope = html): boolean | null {
  let seen = 0
  for (const s of segs(scope)) {
    let from = 0
    for (;;) {
      const i = s.indexOf(label, from)
      if (i < 0) break
      if (seen++ === occurrence) {
        const before = s.slice(0, i)
        const box = before.lastIndexOf('[')
        return box >= 0 && before.slice(box).startsWith('[√]')
      }
      from = i + label.length
    }
  }
  return null
}

// ① 3쪽 — 피난기구 하위 3그룹이 세부제원 types에서 주입되는가 (종전 ck(false) 하드코딩)
check('3쪽 피난기구 그룹1(피난사다리·완강기 포함) √', checkedAt('공기안전매트ㆍ피난사다리') === true)
check('3쪽 피난기구 그룹2(다수인피난장비) 미체크 — 해당 종류 미선택', checkedAt('다수인피난장비') === false)
check('3쪽 피난기구 그룹3(승강식·하향식) √', checkedAt('승강식피난기') === true)
// ② 3쪽 — 소화기구 하위는 대장(fire_facilities)에서 주입
check('3쪽 소화기구 하위(주거용) √ — 대장에서 주입', checkedAt('주거용주방자동소화장치') === true)
check('3쪽 소화기구 하위(상업용) 미체크 — 대장 미설치', checkedAt('상업용주방자동소화장치') === false)
// ③ 4~7쪽 3-6 — 통합 어휘 11번째(종전 세부현황 목록에 없어 인쇄 불가였던 종류)
const s36 = section('3-6'), s34 = section('3-4')
check('세부현황 피난기구 종류 하향식… √', checkedAt('하향식피난구용내림식사다리', 0, s36) === true)
check('세부현황 피난기구 종류 피난교 미체크', checkedAt('피난교', 0, s36) === false)
// ④ 가스계 — 세부제원에 저장이 없어도 대장 체크에서 파생
check('가스계 이산화탄소 √ (대장 파생, spec 미저장)', checkedAt('이산화탄소', 0, s34) === true)
check('가스계 할론 미체크 (대장 미설치)', checkedAt('할론', 0, s34) === false)
// ⑤ 유도등 — 유도표지는 대장 파생, 통로는 사용자 입력 유지, 피난유도선은 대장 미설치
check('유도등 유도표지 √ (대장 파생)', checkedAt('유도표지', 0, s36) === true)
check('유도등 통로 √ (세부제원 고유 입력 유지)', checkedAt('통로', 0, s36) === true)
check('유도등 피난유도선 미체크 (대장 미설치)', checkedAt('피난유도선', 0, s36) === false)
// ⑥ 비상용승강기 — 건물 정보에서 파생
const lobbyLine = segs().find(s => s.includes('비상용승강기')) ?? ''
check('비상용승강기 3대 (건물 파생)', /비상용승강기[^0-9]*3/.test(lobbyLine), lobbyLine.trim().slice(0, 120))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
