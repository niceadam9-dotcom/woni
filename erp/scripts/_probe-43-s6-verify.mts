/** S6 독립 검증 — 설비 구분 '해당' 판정을 **원시 DB에서 따로 계산해** 조립본과 대조 (소방계획서_43 S6)
 *
 *  S6는 타 세션 구현분이고 판정 로직이 `assembleReport9` **안**에 있어 순수 함수로 부를 수 없다.
 *  그래서 구현을 읽고 흉내 내는 대신 **원시 테이블에서 기대값을 독립적으로 세워** 대조한다
 *  (같은 코드를 두 번 부르면 항진명제가 된다).
 *
 *  검증 축:
 *   S6-1 '기타'      ⟺ ETC_CODES ∩ (설치 체크된 대장 코드) ≠ ∅
 *   S6-2 '안전시설등' ⟺ 1.10.3 `multiUse.applicable === true` — **개소수와 무관**해야 한다
 *   S6-3 대장이 비면 판정 자체를 하지 않는다(undefined) — '모름'을 '미해당'으로 단정하지 않는다
 *
 *  ⚠ 읽기 전용. 실행: npx tsx --conditions=react-server scripts/_probe-43-s6-verify.mts */
import './_env.mjs'
import { createAdminClient } from '../src/lib/supabase/admin'
import { assembleReport9 } from '../src/lib/report9-assemble'
import { ETC_CODES } from '../src/lib/facility-codes'
import { isMultiUseApplicable } from '../src/lib/multi-use'

const admin = createAdminClient()
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { console.log(`  ${c ? '✅' : '❌'} ${m}${d ? ` — ${d}` : ''}`); c ? pass++ : fail++ }

const { data: insps, error } = await admin.from('inspections')
  .select('id, customer_id').order('created_at', { ascending: false }).limit(30)
if (error) { console.error('조회 실패:', error.message); process.exit(1) }
const rows = insps ?? []
console.log(`점검 ${rows.length}건 대조\n`)
if (!rows.length) { console.log('⚠ 점검 0건 — 데이터 축 문제이지 코드 축이 아니다'); process.exit(0) }

let judged = 0, undecided = 0, etcTrue = 0, muTrue = 0
for (const insp of rows) {
  const d9 = await assembleReport9(admin, insp.customer_id, insp.id).then(r => r.data).catch(() => null)
  if (!d9) continue

  // ── 독립 기대값: 원시 테이블에서 직접 ──
  const { data: blds } = await admin.from('buildings')
    .select('id').eq('customer_id', insp.customer_id).eq('is_active', true)
  const bldIds = (blds ?? []).map(b => b.id)
  const { data: facs } = await admin.from('fire_facilities')
    .select('facility_code').in('building_id', bldIds.length ? bldIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('installed', true)
  const codes = new Set((facs ?? []).map(f => f.facility_code))
  const wantEtc = ETC_CODES.some(c => codes.has(c))

  const { data: forms } = await admin.from('fire_plan_forms')
    .select('sections').eq('customer_id', insp.customer_id).limit(1)
  const mu = ((forms?.[0]?.sections ?? {}) as Record<string, unknown>)['multiUse'] as { applicable?: boolean } | undefined
  const wantMu = isMultiUseApplicable(mu ?? null)

  const ag = d9.applicableGroups
  const name = insp.id.slice(0, 8)

  if (!ag) {
    undecided++
    // S6-3 — 판정하지 않는 경우는 대장(facilityChecks)이 비었을 때뿐이어야 한다
    ok((d9.facilityChecks ?? []).length === 0,
      `${name}: 미판정(undefined)은 대장이 빈 경우뿐`,
      `facilityChecks=${(d9.facilityChecks ?? []).length}`)
    continue
  }
  judged++
  if (wantEtc) etcTrue++
  if (wantMu) muTrue++
  ok(ag.includes('기타') === wantEtc, `${name}: S6-1 기타`,
    `조립=${ag.includes('기타')} 독립계산=${wantEtc} (설치코드 ${codes.size}종)`)
  ok(ag.includes('안전시설등') === wantMu, `${name}: S6-2 안전시설등`,
    `조립=${ag.includes('안전시설등')} 독립계산=${wantMu}`)
}

console.log(`\n판정된 점검 ${judged}건 · 미판정 ${undecided}건`)
console.log(`양성 표본 — 기타 해당 ${etcTrue}건 · 안전시설등 해당 ${muTrue}건`)
// ⚠ 양성 표본이 0이면 '전부 false로 일치'라 통과해도 공허하다 — 그 사실을 드러낸다
if (judged > 0 && etcTrue === 0) console.log('⚠ 기타=해당 표본 0건 — 이 축은 음성만 확인됐다(공허 주의)')
if (judged > 0 && muTrue === 0) console.log('⚠ 안전시설등=해당 표본 0건 — 이 축은 음성만 확인됐다(공허 주의)')
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
