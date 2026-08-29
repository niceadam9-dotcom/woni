// 소방계획서_36 — 'test-cert-paper-delete 2-1 ② 완료로 전환 pending'의 정체 규명 (F-13)
//
// 사실관계: 마커는 기록되고(2-2·2-3 통과) 화면에도 '종이 보관 중'이 뜨는데(3-1·3-2 통과)
// **단계만 안 바뀐다**. 업로드 경로(certFile)는 멀쩡하다(5-1 통과). 즉 certArchived 축만 죽었다.
// 웹 계층을 걷어내고 DB+판정 로직만으로 재현한다.
//
// 실행: npx tsx --conditions=react-server scripts/_probe-36-cert-archived.mts
// @ts-expect-error mjs 헬퍼
import { raw, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'
const { syncInspectionSteps, gatherStepEvidence } = await import('../src/lib/inspection-step-sync.ts')
const { findArchivedCertInspections, CERT_PAPER_ACTION } = await import('../src/lib/doc-status.ts')
const { evidenceDone } = await import('../src/lib/inspection-step-status.ts')

const EMAIL = 'cert-archived-probe@erp-test.com'
let userId = '', custId = '', inspId = ''

const STEP_DEFS = [
  { step_num: 1, name_ko: '자체점검', days: 0 },
  { step_num: 2, name_ko: '배치확인서 보고서 작성', days: 7 },
  { step_num: 3, name_ko: '관계인 보고서 제출', days: 14 },
  { step_num: 4, name_ko: '소방서 보고서 제출 및 이행계획서 등록', days: 21 },
  { step_num: 5, name_ko: '소방보수 완료', days: 28 },
  { step_num: 6, name_ko: '이행완료보고서 제출', days: 35 },
]

try {
  console.log(`CERT_PAPER_ACTION = ${JSON.stringify(CERT_PAPER_ACTION)}`)
  userId = await mkUser({ email: EMAIL, name: '종이보관프로브', employeeId: 'E2E-CAP' })
  custId = await mkCustomer({ customer_name: 'ZZ종이보관프로브고객', created_by: userId })
  const { data: ins } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: '2026-07-01', status: 'in_progress',
    assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  inspId = ins!.id
  const { data: ex } = await raw.from('inspection_steps').select('step_num').eq('inspection_id', inspId)
  if (!ex || ex.length === 0) {
    await raw.from('inspection_steps').insert(STEP_DEFS.map(d => ({
      inspection_id: inspId, step_num: d.step_num, name_ko: d.name_ko, due_date: '2026-08-01',
    })))
  }

  // ── 앱과 **똑같이** 마커를 심는다 (timeline-actions.recordCertPaperAction과 동일 형태)
  const { error: insErr } = await raw.from('activity_logs').insert({
    actor_id: userId, action: CERT_PAPER_ACTION,
    entity_type: 'inspection', entity_id: inspId,
    metadata: { date: '2026-07-02', location: '사무실 캐비닛 A', memo: '' },
  })
  check('마커 insert 성공', !insErr, insErr?.message ?? '')

  const { data: back } = await raw.from('activity_logs')
    .select('action, entity_type, entity_id').eq('entity_id', inspId).eq('action', CERT_PAPER_ACTION)
  check('마커가 DB에 있다', (back ?? []).length === 1, JSON.stringify(back?.[0] ?? null))

  // ── 축 ①: findArchivedCertInspections 가 이 회차를 잡는가
  const set = await findArchivedCertInspections(raw, [inspId])
  check('★ findArchivedCertInspections 가 회차를 포함한다', set.has(inspId), `set.size=${set.size}`)

  // ── 축 ②: gatherStepEvidence 의 certArchived
  const { data: inspRow } = await raw.from('inspections')
    .select('id, customer_id, status, inspection_start_date, inspection_end_date, inspection_type, plan_type, report9_submitted_at, report11_submitted_at')
    .eq('id', inspId).single()
  const ev = await gatherStepEvidence(raw, inspRow)
  check('★ evidence.certArchived = true', ev.certArchived === true, `certFile=${ev.certFile} certArchived=${ev.certArchived}`)

  // ── 축 ③: 판정 함수가 ②를 완료로 보는가
  const done = evidenceDone(ev)
  check('★ evidenceDone()[2] = true', done[2] === true, JSON.stringify(done))

  // ── 축 ④: 실제 동기화가 DB status를 바꾸는가
  const sync = await syncInspectionSteps(raw, inspId, userId)
  const { data: st2 } = await raw.from('inspection_steps')
    .select('status').eq('inspection_id', inspId).eq('step_num', 2).single()
  check('★ sync 후 ② completed', (st2 as { status: string }).status === 'completed',
    `status=${(st2 as { status: string }).status} · sync.changed=${sync.changed}`)
} catch (e) {
  check(`예외: ${(e as Error).message}`, false)
  console.log((e as Error).stack)
} finally {
  if (inspId) {
    await raw.from('activity_logs').delete().eq('entity_id', inspId)
    await raw.from('inspection_steps').delete().eq('inspection_id', inspId)
    await raw.from('inspections').delete().eq('id', inspId)
  }
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
