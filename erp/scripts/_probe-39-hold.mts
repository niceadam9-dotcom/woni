/** 39 S3 — 완료 보류 왕복 검증 (DB 축·양방향 대조군).
 *  ① countInstalledRequiredBlanks: 종합 회차 + 설치 설비 + 응답 0 → required>0 / 전부 채우면 0 (양방향)
 *  ② applyStepSideEffects: hold 있으면 completed 전환 보류(in_progress 유지·justCompleted=false),
 *     hold 없으면 completed 전환 (양방향) · scheduled+hold → in_progress 강등 · completed 소급 없음
 *  실행: npx tsx --conditions=react-server scripts/_probe-39-hold.mts
 *  픽스처는 test-sheet-overview.mts와 같은 방식(스테이징 실DB, 끝에 정리). */
// @ts-expect-error mjs 헬퍼 — test-sheet-overview.mts와 같은 픽스처 축
import { raw, mkUser, mkCustomer, cleanupCustomer, delUser } from './_e2e-helpers.mjs'
const { countInstalledRequiredBlanks, buildSheetOverviews } = await import('../src/lib/sheet-overview.ts')
const { applyStepSideEffects } = await import('../src/lib/inspection-step-sync.ts')
const { getSheets, getAllSheetItems } = await import('../src/lib/sheet-catalog.ts')
const { isItemInScope } = await import('../src/lib/sheet-scope.ts')

const admin = raw as never as Parameters<typeof countInstalledRequiredBlanks>[0]

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

let custId = '', bldId = '', inspId = '', userId = ''
try {
  userId = await mkUser({ email: 'probe-39-hold@erp-test.com', name: '39보류프로브', employeeId: 'E2E-39H' })
  custId = await mkCustomer({ customer_name: '_39보류프로브고객', created_by: userId, inspection_type: '종합' })
  const { data: bld } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '_39동', is_active: true, created_by: userId,
  }).select('id').single()
  bldId = (bld as { id: string }).id
  // 소화기구 설치 — STD-01(소화기구) 시트가 설치 매칭되게 한다
  await raw.from('fire_facilities').insert({
    building_id: bldId, facility_code: '소화기구 및 자동소화장치', category: '소화설비', installed: true,
  })
  const { data: insp } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '종합', plan_type: 'special_종합', sequence_num: 1,
    inspection_start_date: '2025-09-02', status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = (insp as { id: string }).id

  // ── ① 판정 함수 — 양방향 ──
  console.log('[1] countInstalledRequiredBlanks')
  const before = await countInstalledRequiredBlanks(admin, inspId)
  check('응답 0건 → required > 0', before.required > 0, JSON.stringify(before))
  check('그중 ● > 0 (종합이라 comp 포함)', before.comp > 0, JSON.stringify(before))
  // UI 카운터 축과 일치 — buildSheetOverviews의 설치 시트 (total-responded) 합과 같은 수
  const { overviews } = await buildSheetOverviews(admin, [inspId], { id: userId, role: 'admin' })
  const uiRequired = overviews[inspId].sheets.filter(s => s.installed)
    .reduce((a, s) => a + (s.total - s.responded), 0)
  const uiComp = overviews[inspId].sheets.filter(s => s.installed).reduce((a, s) => a + s.compBlank, 0)
  check('UI 축(overview)과 같은 수 — required', before.required === uiRequired, `${before.required} vs ${uiRequired}`)
  check('UI 축과 같은 수 — comp', before.comp === uiComp, `${before.comp} vs ${uiComp}`)

  // 전부 채운다(범위 내 STD-01 항목 전부 N) → 0으로 떨어져야 진짜 응답 축이다
  const sheets = (await getSheets()).filter(s => s.version === 'v2025' && s.sheet_code === 'STD-01')
  const items = (await getAllSheetItems()).filter(i => i.sheet_id === sheets[0].id)
  const scope = { isSpecial: true, isOperational: false, version: 'v2025' as const }
  const codes = [...new Set(items.filter(i => isItemInScope(i, scope)).map(i => i.item_code))]
  await raw.from('inspection_sheet_responses').insert(codes.map(c => ({
    inspection_id: inspId, item_code: c, result: 'N', month: 0, updated_by: userId,
  })))
  const after = await countInstalledRequiredBlanks(admin, inspId)
  check('전부 기재(／ 포함) → required = 0 — ／도 유효 기재(법 범례)', after.required === 0, JSON.stringify(after))

  // ── ② 완료 보류 부수효과 — 양방향 + 경계 ──
  console.log('[2] applyStepSideEffects 보류 축')
  const status = async () => (await raw.from('inspections').select('status').eq('id', inspId).single())
    .data!.status as string

  // hold 있음 → completed로 안 올라간다
  let r = await applyStepSideEffects(admin, {
    inspectionId: inspId, actorId: userId, prevStatus: 'in_progress',
    allActiveDone: true, newlyCompleted: [], completedAtIso: new Date().toISOString(),
    holdCompletion: { required: 3, comp: 1 },
  })
  check('hold → justCompleted=false·completionHeld 반환', !r.justCompleted && r.completionHeld?.required === 3, JSON.stringify(r))
  check('hold → status in_progress 유지', (await status()) === 'in_progress')

  // scheduled + hold → in_progress로만 (단계 다 찼어도 완료 아님)
  await raw.from('inspections').update({ status: 'scheduled' }).eq('id', inspId)
  r = await applyStepSideEffects(admin, {
    inspectionId: inspId, actorId: userId, prevStatus: 'scheduled',
    allActiveDone: true, newlyCompleted: [], completedAtIso: new Date().toISOString(),
    holdCompletion: { required: 1, comp: 0 },
  })
  check('scheduled+hold → in_progress 강등', (await status()) === 'in_progress')

  // hold 해소 → completed 전환 (대조군 — 보류 로직이 완료 자체를 죽이지 않았다는 증명)
  r = await applyStepSideEffects(admin, {
    inspectionId: inspId, actorId: userId, prevStatus: 'in_progress',
    allActiveDone: true, newlyCompleted: [], completedAtIso: new Date().toISOString(),
    holdCompletion: { required: 0, comp: 0 },
  })
  check('hold 해소 → justCompleted=true', r.justCompleted === true, JSON.stringify(r))
  check('hold 해소 → status completed', (await status()) === 'completed')

  // 이미 completed + hold → 소급하지 않는다(내리지 않음)
  r = await applyStepSideEffects(admin, {
    inspectionId: inspId, actorId: userId, prevStatus: 'completed',
    allActiveDone: true, newlyCompleted: [], completedAtIso: new Date().toISOString(),
    holdCompletion: { required: 5, comp: 2 },
  })
  check('completed+hold → 소급 없음(completed 유지)', (await status()) === 'completed')
} finally {
  // 정리 — 프로브 흔적을 남기지 않는다 (test-sheet-overview와 같은 헬퍼 규약)
  if (inspId) {
    await raw.from('inspection_sheet_responses').delete().eq('inspection_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspection_plan_items').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
