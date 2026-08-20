/** 세부현황 입력 화면 '◦ 설치장소' 묶음 표시 회귀 프로브. 읽기 전용(DB·파일 무변경).
 *
 *  왜: 라벨이 그냥 '동명'·'시작 층'이라 화면만 봐서는 서식의 어느 줄인지 알 수 없었다
 *  (바로 위 '수신기 동명'과 구분 불가) → 값이 비어 있는 채로 인쇄되는 원인.
 *  라벨·저장 키는 그대로 두고 SpecField.group으로만 묶는다(2026-08-20 사용자 확정).
 *
 *  G-1 설치장소 줄을 이루는 필드는 **전부** group='설치장소'
 *  G-2 그 밖의 필드에는 group이 붙지 않는다(설치대상·수신기 등 자기 라벨로 식별되는 줄)
 *  G-3 인쇄 출력은 group과 무관 — 라벨을 바꾸지 않았음을 축자 확인
 *  실행: npx tsx scripts/_probe-spec-group.mts */
import { FACILITY_SPEC_SECTIONS } from '../src/lib/facility-spec-schema.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 서식에서 `◦ 설치장소:` 줄로 인쇄되는 필드 키 — 층범위형(rangeLocFields)과 단일지점형(locFields 무접두) */
const RANGE = ['dong', 'coverage', 'from_ground', 'from_floor', 'to_ground', 'to_floor']
const POINT = ['dong', 'ground', 'floor', 'room']
const isPlaceKey = (k: string) => {
  const base = k.replace(/2$/, '')
  return RANGE.includes(base) || POINT.includes(base)
}

const missing: string[] = []
const stray: string[] = []
const badCollapse: string[] = []
let tagged = 0
for (const sec of FACILITY_SPEC_SECTIONS) {
  for (const bl of sec.blocks) {
    for (const f of bl.fields) {
      if (isPlaceKey(f.key)) {
        const second = /2$/.test(f.key)
        const want = second ? '설치장소 (2행)' : '설치장소'
        if (f.group === want) tagged++
        else missing.push(`${sec.no} ${bl.key}.${f.key} (group=${f.group})`)
        // 접기는 2행에만 — 1행이 접히면 필수 칸이 숨는다
        if (!!f.collapsedWhenEmpty !== second) badCollapse.push(`${sec.no} ${bl.key}.${f.key}`)
      } else if (f.group) {
        stray.push(`${sec.no} ${bl.key}.${f.key} → ${f.group}`)
      }
    }
  }
}
console.log('=== G-1/G-2 그룹 부착')
check(`설치장소 필드 전건 부착 (${tagged}개)`, missing.length === 0, missing.join(', '))
check('설치장소 아닌 필드엔 group 없음', stray.length === 0, stray.join(', '))
check('접기(collapsedWhenEmpty)는 2행에만', badCollapse.length === 0, badCollapse.join(', '))

console.log('=== G-2b 접두사 있는 줄은 묶지 않는다(라벨로 식별)')
// from_/to_는 설치장소 층범위형이라 '접두사 있는 줄'이 아니다 — 제외하지 않으면 검사가 통째로 뒤집힌다
const prefixed = FACILITY_SPEC_SECTIONS.flatMap(s => s.blocks).flatMap(b => b.fields)
  .filter(f => /_(dong|ground|floor|room)$/.test(f.key) && !/^(from|to)_/.test(f.key))
check(`접두사 필드 ${prefixed.length}개 group 없음`, prefixed.every(f => !f.group),
  prefixed.filter(f => f.group).map(f => f.key).join(', '))
check('설치대상(targets)엔 group 없음',
  FACILITY_SPEC_SECTIONS.flatMap(s => s.blocks).flatMap(b => b.fields)
    .filter(f => f.key === 'targets').every(f => !f.group))

console.log('=== G-3 라벨 무변경(인쇄·화면 공용 문구)')
const byKey = new Map(FACILITY_SPEC_SECTIONS.flatMap(s => s.blocks).flatMap(b => b.fields).map(f => [f.key, f.label]))
check("'dong' 라벨은 '동명' 그대로", byKey.get('dong') === '동명', String(byKey.get('dong')))
check("'from_floor' 라벨은 '시작 층' 그대로", byKey.get('from_floor') === '시작 층', String(byKey.get('from_floor')))
check("'receiver_dong' 라벨은 '수신기 동명' 그대로", byKey.get('receiver_dong') === '수신기 동명', String(byKey.get('receiver_dong')))

console.log(`\n=== 결과 — ${pass}/${pass + fail}`)
process.exit(fail ? 1 : 0)
