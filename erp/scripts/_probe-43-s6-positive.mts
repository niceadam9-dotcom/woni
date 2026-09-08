/** S6-2 양성 표본 정조준 — 「해당」 켠 고객에서 안전시설등이 실제로 해당으로 판정되나 (43 S6).
 *  앞선 전수 대조는 양성 표본 0건이라 `false==false`만 확인한 공허 통과였다.
 *  ⚠ 읽기 전용. 실행: npx tsx --conditions=react-server scripts/_probe-43-s6-positive.mts */
import './_env.mjs'
import { createAdminClient } from '../src/lib/supabase/admin'
import { assembleReport9 } from '../src/lib/report9-assemble'
import { isMultiUseApplicable } from '../src/lib/multi-use'

const admin = createAdminClient()
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { console.log(`  ${c ? '✅' : '❌'} ${m}${d ? ` — ${d}` : ''}`); c ? pass++ : fail++ }

// 「해당」이 켜진 고객을 찾는다
const { data: forms } = await admin.from('fire_plan_forms').select('customer_id, sections')
const positives = (forms ?? []).filter(f => {
  const mu = ((f.sections ?? {}) as Record<string, unknown>)['multiUse'] as { applicable?: boolean } | undefined
  return isMultiUseApplicable(mu ?? null)
})
console.log(`multiUse.applicable=true 고객 ${positives.length}건\n`)

for (const f of positives) {
  const cid = String(f.customer_id)
  const mu = ((f.sections ?? {}) as Record<string, unknown>)['multiUse'] as Record<string, unknown>
  const { data: cust } = await admin.from('customers').select('name').eq('id', cid).maybeSingle()
  const { data: insps } = await admin.from('inspections').select('id').eq('customer_id', cid).limit(3)
  console.log(`── ${cust?.name ?? '?'} (${cid.slice(0, 8)}) · 점검 ${(insps ?? []).length}건`)
  // 개소수가 비어 있는가 — S6-2의 핵심은 **개소수와 무관하게** 해당이어야 한다는 것
  const counts = Object.entries(mu).filter(([k]) => k !== 'applicable')
  const filled = counts.filter(([, v]) => String(v ?? '').trim() !== '')
  console.log(`   multiUse 키 ${counts.length}개 · 값 있는 것 ${filled.length}개`
    + (filled.length ? ` (${filled.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')})` : ' → 개소수 전부 공란'))

  for (const insp of insps ?? []) {
    const d9 = await assembleReport9(admin, cid, insp.id).then(r => r.data).catch(e => { console.log(`   조립 실패: ${e}`); return null })
    if (!d9) continue
    const ag = d9.applicableGroups
    if (!ag) {
      console.log(`   ${insp.id.slice(0, 8)}: applicableGroups 미판정(대장 공란 ${(d9.facilityChecks ?? []).length}) — 이 건으로는 못 잰다`)
      continue
    }
    ok(ag.includes('안전시설등'),
      `${insp.id.slice(0, 8)}: S6-2 **양성** — 「해당」이면 안전시설등이 해당`,
      `applicableGroups=[${ag.join(', ')}]`)
    // 8쪽이 실제로 그 구분을 「해당없음」이 아닌 것으로 인쇄하는가(표면까지)
    // ⚠ 종전 정규식은 매칭에 실패해 `(행 없음)`을 돌려줬고, 그게 `!== '해당없음'`을 **공허 통과**
    //   시켰다(2026-09-08). 추출이 실패했는지 값이 다른지를 가르려면 **행을 찾았다는 것부터**
    //   단언해야 한다. 빈 구분은 1행, 행 있는 구분은 rowspan이라 `</tr>`로 끊어 셀을 읽는다.
    const { renderReport9 } = await import('../src/lib/doc-templates/report9')
    const html = renderReport9(d9)
    const i8 = html.indexOf('4. 소방시설등 불량 세부 사항')
    const page8 = i8 >= 0 ? html.slice(i8, i8 + 2600) : ''
    const m = page8.match(/<td class="center"(?: rowspan="\d+")?>안전시설등<\/td>([\s\S]{0,200}?)<\/tr>/)
    const cells = m ? [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/&nbsp;/g, '').trim()) : null
    ok(cells !== null, `${insp.id.slice(0, 8)}: 8쪽에 안전시설등 행이 있다(추출 성공 — 공허 통과 방지)`)
    if (cells) {
      ok(cells[cells.length - 1] !== '해당없음',
        `${insp.id.slice(0, 8)}: 8쪽 인쇄면에서도 「해당없음」이 아니다`,
        `실제 "${cells[cells.length - 1]}"`)
    }
  }
}

if (pass + fail === 0) console.log('\n🚫 양성 표본은 있으나 그 고객의 점검이 전부 대장 공란이라 **판정 자체가 불가**했다')
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed · ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
