/** [독립 재판정] A4-4 잔여 (a) — 완성도 게이지·'빈칸만 보기' 분모에 둘째 줄 필드가 섞이는지 수치 확인
 *  실행: npx tsx --conditions=react-server scripts/_judge-a44-gauge.mts
 *  plan-form14-specs.tsx의 CATALOG_TOTAL(43-44행)·gauge(327-345행)·emptySnap(288-296행) 공식을 그대로 재현한다. */
import schemamod from '../src/lib/facility-spec-schema.ts'
const { FACILITY_SPEC_SECTIONS, isDerivedField } =
  schemamod as unknown as typeof import('../src/lib/facility-spec-schema.ts')

const SECOND = new Set(['dong2', 'coverage2', 'from_ground2', 'from_floor2', 'to_ground2', 'to_floor2'])

let catalog = 0, second = 0, etcCond = 0
const secondBlocks: string[] = []
for (const s of FACILITY_SPEC_SECTIONS) for (const b of s.blocks) {
  catalog += b.fields.length
  const n = b.fields.filter(f => SECOND.has(f.key)).length
  if (n) { second += n; secondBlocks.push(`${s.key}.${b.key}(${n})`) }
  // 비교군: 특정 선택지를 고른 사람만 채우는 '기타 내용'류 — 이미 대다수 고객에게 영구 미달성인 칸
  etcCond += b.fields.filter(f => /기타 내용|기타 종류|_etc$/.test(f.label) || /_etc$/.test(f.key)).length
}
console.log(`CATALOG_TOTAL(전 카탈로그 필드) = ${catalog}`)
console.log(`  그중 둘째 줄 필드(A4-4) = ${second}   ${secondBlocks.join(' ')}`)
console.log(`  그중 '기타 내용'류 조건부 필드(A4-4 이전부터 존재) = ${etcCond}`)
console.log(`  둘째 줄 비중 = ${(second / catalog * 100).toFixed(1)}%`)

// 설치 설비 기준 분모(totalOn) 시뮬레이션 — enabled(bl)은 facilityHint 코드가 설치된 블록만 켠다
const INSTALLED_LABELS = ['옥내소화전설비', '자동화재탐지설비 및 시각경보기', '피난기구', '유도등', '비상조명등']
let totalOn = 0, secondOn = 0, derivedOn = 0
for (const s of FACILITY_SPEC_SECTIONS) for (const b of s.blocks) {
  const hints = (b.facilityHint ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const on = hints.length === 0 ? true : hints.some(h => INSTALLED_LABELS.includes(h))
  if (!on) continue
  totalOn += b.fields.length
  secondOn += b.fields.filter(f => SECOND.has(f.key)).length
  derivedOn += b.fields.filter(f => isDerivedField(f)).length
}
console.log(`\n[시뮬] 설치 설비 = ${INSTALLED_LABELS.join(', ')} (단일 동 대상물 가정)`)
console.log(`  gauge.totalOn = ${totalOn}  ← 분모`)
console.log(`  그중 둘째 줄 필드 = ${secondOn}  → 단일 동이면 영구 미입력`)
console.log(`  그중 파생(읽기전용) 필드 = ${derivedOn}  ← gauge는 제외하지 않으나 '빈칸만 보기'는 제외`)
console.log(`  달성 가능 최대치 = ${totalOn - secondOn}/${totalOn} = ${((totalOn - secondOn) / totalOn * 100).toFixed(1)}%`)
console.log(`\n[빈칸만 보기] 스냅샷은 isDerivedField만 제외(292행) → 둘째 줄 ${secondOn}칸이 '남은 미입력'에 상주`)
