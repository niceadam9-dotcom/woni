// 「기타」 7종은 회차 성격에 맞는 것만 보인다 (2026-09-21 사용자 지적)
//
// 왜 생겼나: 7종이 한 묶음처럼 보이지만 **속한 점검이 다르다**(실측).
//   방화문·비상구·방염      → STD-31 「기타사항」 = 자체점검(v2025) 전용
//   위험물·화기·가스·전기   → EXT-11~14         = 외관점검(v2022) 전용
// 그런데 점검 귀속 1.4(`/inspections/{id}/facilities`)가 7종을 **회차와 무관하게 통째로** 그렸다.
// 자체점검 회차에서 뒤 4종을 체크해도 그 회차 점검표엔 시트가 없어 대상 축도 필수 입력도 안 늘었다.
// 3분리(2026-09-20) 때 이 화면은 「무변경 대조군」이라 일부러 안 건드렸는데, A(2026-09-21)로
// **달력 ①이 여기로 바로 보내게 되면서** 전제가 깨졌다 — 「설비를 확인하세요」라고 말하는 첫
// 관문에 무관한 항목이 절반 넘게 섞여 있었다.
//
// 이 검사가 지키는 것:
//   ① 자체점검 회차 → STD-31 3종만 · 외관 회차 → EXT 4종만 (표본 **둘**이어야 갈린다)
//   ② 🚨 안 보이는 코드의 **기존 대장 행이 저장으로 사라지지 않는다** — 대장은 고객 단위라,
//      외관 회차에서 체크해 둔 값이 자체점검 저장에 날아가면 안 된다.
//   ③ 고객 상세 쪽은 **무변경**(회차 개념이 없다)
//
// 실행: npx tsx scripts/test-etc-scope-per-round.mts   (로컬 dev + 스테이징 DB)
import { ETC_ITEMS } from '../src/lib/facility-codes'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'etc-scope@erp-test.com'
const SELF = ['방화문 및 방화셔터', '비상구 및 피난통로', '방염']
const EXT = ['위험물 저장·취급시설', '화기시설', '가연성 가스시설', '전기시설']
let userId = ''
const custIds: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

function kstShift(d: number): string {
  const t = new Date(Date.now() + 9 * 3600_000)
  t.setDate(t.getDate() + d)
  return t.toISOString().split('T')[0]
}

/** 고객 + 건물 + 회차(성격 지정) + 대장 7종 전부 설치로 심는다(②의 보존 대조군) */
async function fixture(name: string, planType: 'special_작동' | 'monthly') {
  const customerId = await mkCustomer({ customer_name: name, created_by: userId, inspection_type: '일반관리' })
  custIds.push(customerId)
  const { data: bld } = await raw.from('buildings')
    .insert({ customer_id: customerId, building_name: '본관', is_active: true, created_by: userId }).select('id').single()
  // ⚠ insert 오류를 **삼키지 않는다** — 조용히 실패하면 아래 ②가 「저장이 지웠다」로 오독된다
  //   (실제로 한 번 그렇게 읽었다: 행이 없는데 소실로 보였다).
  for (const code of ETC_ITEMS.map(i => i.code)) {
    const { error: insErr } = await raw.from('fire_facilities')
      .insert({ building_id: bld!.id, category: '기타', facility_code: code, installed: true })
    if (insErr) throw new Error(`대장 심기 실패(${code}): ${insErr.message}`)
  }
  const { data: ins, error } = await raw.from('inspections').insert({
    customer_id: customerId, inspection_type: '작동', sequence_num: 1, plan_type: planType,
    inspection_start_date: kstShift(-1), status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (error) throw new Error(`회차 생성 실패: ${error.message}`)
  return { customerId, inspectionId: ins!.id as string, buildingId: bld!.id as string }
}

try {
  userId = await mkUser({ email: EMAIL, name: '기타범위', employeeId: 'E2E-ETCSC' })
  const self = await fixture('기타범위자체E2E', 'special_작동')
  const ext = await fixture('기타범위외관E2E', 'monthly')

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  /** 「기타」 블록 안에 보이는 코드들 */
  const shown = async (inspectionId: string) => {
    await page.goto(`${BASE}/inspections/${inspectionId}/facilities`)
    await page.waitForSelector('[data-testid="form14-etc"]', { timeout: 60000 })
    const t = await page.locator('[data-testid="form14-etc"]').innerText()
    return ETC_ITEMS.map(i => i.code).filter(c => t.includes(c))
  }

  // ── ① 자체점검 회차 — STD-31 3종만 ─────────────────────────────────────
  const a = await shown(self.inspectionId)
  check('★ ① 자체점검 — STD-31 3종이 보인다', SELF.every(c => a.includes(c)), JSON.stringify(a))
  check('🚨 ① 자체점검 — 외관 전용 4종은 **안 보인다**', EXT.every(c => !a.includes(c)), JSON.stringify(a))

  // ── ① 외관 회차 — EXT 4종만 ───────────────────────────────────────────
  const b = await shown(ext.inspectionId)
  check('★ ① 외관 — EXT 4종이 보인다', EXT.every(c => b.includes(c)), JSON.stringify(b))
  check('🚨 ① 외관 — 자체점검 전용 3종은 **안 보인다**', SELF.every(c => !b.includes(c)), JSON.stringify(b))
  // 표본이 둘이어야 「그냥 3종만 그리게 했다」와 구별된다
  check('★ 표본 둘이 서로 다른 집합을 보여준다', JSON.stringify(a.sort()) !== JSON.stringify(b.sort()))

  // ── ② 안 보이는 코드의 기존 대장 행이 저장으로 사라지지 않는다 ────────
  {
    // 전제 — 저장 **전에** 4종 행이 실재하는지 먼저 잰다. 이게 없으면 아래 판정이 공허하다
    const { data: pre } = await raw.from('fire_facilities')
      .select('facility_code, installed').eq('building_id', self.buildingId).in('facility_code', EXT)
    check('② 전제 — 저장 전 4종 행이 있다', (pre ?? []).length === EXT.length, JSON.stringify(pre))

    await page.goto(`${BASE}/inspections/${self.inspectionId}/facilities`)
    await page.waitForSelector('[data-testid="form14-etc"]', { timeout: 60000 })
    // 보이는 항목 하나를 토글해 dirty를 만들고 저장한다(안 보이는 4종은 건드리지 않는다)
    await page.locator(`[data-testid="form14-etc"] [aria-label*="${SELF[0]}"]`).first().click().catch(async () => {
      await page.locator('[data-testid="form14-etc"] button').first().click()
    })
    const saveBtn = page.locator('button:has-text("저장")').last()
    await saveBtn.click()
    /* 🚨 고정 대기로 재면 안 된다 — 저장은 **지우고 다시 넣는다**. 그 사이 창에 걸리면 행이
       비어 보여 「저장이 지웠다」로 오독한다(실제로 한 번 그렇게 읽었다). 값이 **자리를 잡을
       때까지** 기다린다. 판정은 4종이 전부 살아 있는 상태에서만 내린다. */
    let kept: Array<{ facility_code: string; installed: boolean }> = []
    for (let i = 0; i < 40; i++) {
      const { data } = await raw.from('fire_facilities')
        .select('facility_code, installed').eq('building_id', self.buildingId)
        .in('facility_code', ETC_ITEMS.map(x => x.code))
      kept = ((data ?? []) as Array<{ facility_code: string; installed: boolean }>)
        .filter(r => EXT.includes(r.facility_code))
      if (kept.length === EXT.length) break
      await page.waitForTimeout(400)
    }
    check('🚨 ② 화면에 없는 4종의 대장 행이 **그대로 살아 있다**(저장이 안 지운다)',
      EXT.every(c => kept.some(r => r.facility_code === c && r.installed)),
      JSON.stringify(kept))
  }

  // ── ③ 고객 상세 1.4는 무변경(기타 블록 자체가 없다 — 3분리로 갈라졌다) ──
  await page.goto(`${BASE}/customers/${self.customerId}?tab=facilities&form=1.4`)
  await page.waitForSelector('text=소방시설', { timeout: 60000 }).catch(() => {})
  check('③ 고객 상세 [공통] 탭 1.4엔 기타 블록이 없다(무변경)',
    (await page.locator('[data-testid="form14-etc"]').count()) === 0)
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  for (const cid of custIds) {
    const { data: insps } = await raw.from('inspections').select('id').eq('customer_id', cid)
    for (const i of insps ?? []) {
      await raw.from('inspection_sheet_responses').delete().eq('inspection_id', i.id)
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
    }
    const { data: blds } = await raw.from('buildings').select('id').eq('customer_id', cid)
    for (const b2 of blds ?? []) await raw.from('fire_facilities').delete().eq('building_id', b2.id)
    await raw.from('buildings').delete().eq('customer_id', cid)
    await cleanupCustomer(cid)
  }
  if (userId) await delUser(userId)
}
summary()
