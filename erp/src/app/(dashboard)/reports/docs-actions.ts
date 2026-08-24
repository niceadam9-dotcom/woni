'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { hangulMatch } from '@/lib/hangul'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { CONTRACT_FILE_RE, findArchivedCertInspections, findMissingCerts, getDocTodo, hasCertFile, isCertFileName, SELF_INSPECTION_OR, type MissingCertRow, type DueReport9Row } from '@/lib/doc-status'
import { GENERATED_DOC_KINDS } from '@/lib/doc-requirements'

/** 보고서 센터 데이터 액션 (소방계획서_5 S2) — ① 고객 문서 현황(R2)·④ 최근 문서(R5)·⑦ 누락 경고(R8)·행동 자동완성(R0-3).
 *  신규 테이블 없음(R2-e): fire_plans + storage 점검 폴더 + 업로드 슬롯 + inspection_defects 사진 쌍 통합 조회. */

const BUCKET = 'fire-plans'

/* ── 공용: 서명 URL (경로는 fire-plans 버킷 내 임의 문서 — 직원 권한 확인) ── */
export async function getDocUrlAction(path: string, saveName?: string): Promise<{ url?: string; error?: string }> {
  await requirePermission('inspection_register')
  if (!/^[0-9a-f-]{36}\//.test(path) || path.includes('..')) return { error: '잘못된 경로입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(BUCKET)
    .createSignedUrl(path, 300, saveName ? { download: saveName } : undefined)
  if (error || !data) return { error: '다운로드 URL 생성 실패' }
  return { url: data.signedUrl }
}

/* ── ① 고객 문서 현황 (R2) ── */

export type DocFileRef = { path: string; at: string | null }
export type DocGroupRef = { hwp?: DocFileRef; pdf?: DocFileRef; html?: DocFileRef; at: string | null }

export type InspectionDocs = {
  inspectionId: string
  year: number
  sequenceNum: number
  inspectionType: string
  planType: string | null            // 자체점검 판정 축 — null·special_* (성격 배지용, 소방계획서_8)
  status: string
  startDate: string | null
  endDate: string | null
  /** 점검표 응답 수 — 트리 점검표 행 진행 표시용 (소방계획서_8 H-2) */
  sheetResponses: number
  /** S9-1(149) — 점검표 입력 규약. null=미상 → 응답 있으면 재생성 차단(회차 카드 배너의 판정 재료)
   *  ⚠ **지금은 항상 null이다** — 이 파일의 inspections select 4곳이 sheet_protocol을 안 가져온다
   *  (2026-08-23 독립 판정). 149가 스테이징·운영 양쪽 미적용이라 select에 넣는 순간 조회가 통째로
   *  깨지므로 의도적으로 미배선 상태다. **149 적용 후 select에 컬럼을 보태기 전까지 이 값을 믿지 말 것** —
   *  믿으면 전건이 '미상'으로 판정돼 재생성 차단이 잘못 걸린다. */
  sheetProtocol: 'legacy_na' | 'blank_unanswered' | null
  defects: { total: number; done: number; photoPairs: number }
  report4: DocGroupRef | null
  report9: DocGroupRef | null
  report10: DocGroupRef | null
  report11: DocGroupRef | null
  exterior: DocGroupRef | null
  cert: DocFileRef | null
  contract: DocFileRef | null
  /** 배치확인서가 파일로는 없지만 종이 보관 후 정리된 회차 — '미업로드'와 구분해야 한다
   *  (소방계획서_18 D-7 ⚠). 파일이 없는데 이 값이 true면 누락이 아니다. */
  certArchived: boolean
}

export type CustomerDocs = {
  customerId: string
  customerName: string
  inspectionType: string
  firePlan: {
    id: string; year: number; title: string | null; revision: number | null
    pdfPath: string | null; pdfName: string | null; hwpPath: string | null; hwpName: string | null
    updatedAt: string | null
  } | null
  inspections: InspectionDocs[]
  summary: { need: number; have: number; warns: number }
}

function latestGroup(objects: Array<{ name: string; created_at?: string | null }>, kind: string, prefix: string): DocGroupRef | null {
  const re = new RegExp(`^${kind}_(\\d+)\\.(hwpx?|pdf|html?)$`, 'i')
  const groups = new Map<string, DocGroupRef>()
  for (const o of objects) {
    const m = o.name.match(re)
    if (!m) continue
    const stamp = m[1]
    const ext = m[2].toLowerCase().startsWith('htm') ? 'html' : m[2].toLowerCase().startsWith('hwp') ? 'hwp' : 'pdf'
    const g = groups.get(stamp) ?? { at: o.created_at ?? null }
    g[ext as 'hwp' | 'pdf' | 'html'] = { path: `${prefix}/${o.name}`, at: o.created_at ?? null }
    if (o.created_at && (!g.at || o.created_at > g.at)) g.at = o.created_at
    groups.set(stamp, g)
  }
  if (groups.size === 0) return null
  const stamps = [...groups.keys()].sort((a, b) => (b > a ? 1 : -1))
  return groups.get(stamps[0]) ?? null
}

type InspRow = {
  id: string; year: number; sequence_num: number; inspection_type: string; status: string
  plan_type: string | null; inspection_start_date: string | null; inspection_end_date: string | null
  sheet_protocol?: 'legacy_na' | 'blank_unanswered' | null   // S9-1(149)
}

/** 점검 1건의 문서 상태 조립 — getCustomerDocsAction·getCustomerRoundsAction 공용 (소방계획서_8 H-1) */
async function buildInspectionDocs(
  admin: ReturnType<typeof createAdminClient>, customerId: string, i: InspRow,
  archivedCerts?: Set<string>,
): Promise<InspectionDocs> {
  const prefix = `${customerId}/inspections/${i.id}`
  const [objRes, defRes, respRes] = await Promise.all([
    admin.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } }),
    admin.from('inspection_defects')
      .select('id, photo_url, after_photo_url, action_completed_at').eq('inspection_id', i.id),
    admin.from('inspection_sheet_responses')
      .select('id', { count: 'exact', head: true }).eq('inspection_id', i.id),
  ])
  const objects = objRes.data ?? []
  const defects = (defRes.data ?? []) as Array<{ photo_url: string | null; after_photo_url: string | null; action_completed_at: string | null }>
  const cert = objects.find(o => isCertFileName(o.name))
  const contract = objects.find(o => CONTRACT_FILE_RE.test(o.name))
  return {
    inspectionId: i.id, year: i.year, sequenceNum: i.sequence_num,
    inspectionType: i.inspection_type, planType: i.plan_type, status: i.status,
    startDate: i.inspection_start_date, endDate: i.inspection_end_date,
    sheetResponses: respRes.count ?? 0,
    sheetProtocol: i.sheet_protocol ?? null,
    defects: {
      total: defects.length,
      done: defects.filter(d => d.action_completed_at).length,
      photoPairs: defects.filter(d => d.photo_url && d.after_photo_url).length,
    },
    report4: latestGroup(objects, 'report4', prefix),
    report9: latestGroup(objects, 'report9', prefix),
    report10: latestGroup(objects, 'report10', prefix),
    report11: latestGroup(objects, 'report11', prefix),
    exterior: latestGroup(objects, 'exterior', prefix),
    cert: cert ? { path: `${prefix}/${cert.name}`, at: cert.created_at ?? null } : null,
    contract: contract ? { path: `${prefix}/${contract.name}`, at: contract.created_at ?? null } : null,
    certArchived: !cert && !!archivedCerts?.has(i.id),
  }
}

export async function getCustomerDocsAction(customerId: string): Promise<{ docs?: CustomerDocs; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers')
    .select('id, customer_name, inspection_type').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  const c = cust as { id: string; customer_name: string; inspection_type: string }

  const [planRes, inspRes] = await Promise.all([
    admin.from('fire_plans')
      .select('id, year, title, revision, pdf_path, pdf_name, hwp_path, hwp_name, created_at')
      .eq('customer_id', customerId)
      .order('year', { ascending: false }).order('revision', { ascending: false }).limit(1),
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, status, plan_type, inspection_start_date, inspection_end_date')
      .eq('customer_id', customerId)
      .order('inspection_start_date', { ascending: false, nullsFirst: false })
      .limit(6),
  ])
  const plan = (planRes.data?.[0] ?? null) as {
    id: string; year: number; title: string | null; revision: number | null
    pdf_path: string | null; pdf_name: string | null; hwp_path: string | null; hwp_name: string | null; created_at: string | null
  } | null

  // 자체점검(special_*·null)만 문서 절차 대상 — 정기(monthly)·레거시 event는 행에서 제외.
  // 관리유형 무관 (소방계획서_6 W-16) — 일반관리 자체점검도 동일 행 구성
  const inspRows = ((inspRes.data ?? []) as InspRow[]).filter(i =>
    !i.plan_type || i.plan_type.startsWith('special'))

  // 종이 보관 후 정리된 회차(D-7 ⚠) — 파일이 없어도 '미업로드'로 표시하지 않는다
  const archivedCerts = await findArchivedCertInspections(admin, inspRows.map(i => i.id))
  const inspections: InspectionDocs[] = await Promise.all(
    inspRows.map(i => buildInspectionDocs(admin, customerId, i, archivedCerts)))

  // 요약 게이지 (R2-c): 필요 문서 n종 중 m종 보유 — 소방계획서 + 점검 건별 (9호·배치확인서 필수 / 10·11호는 불량 시 / 사진·계약서는 선택이라 제외)
  // 일반관리 특례 없음 (소방계획서_6 W-16) — 전 유형 동일 판정
  let need = 0, have = 0, warns = 0
  const tally = (n: boolean, h: boolean) => { if (!n) return; need += 1; if (h) have += 1; else warns += 1 }
  tally(true, !!plan)
  for (const i of inspections) {
    tally(true, !!i.report9)
    tally(true, !!i.cert || i.certArchived)   // 종이 보관 정리분은 누락이 아니다(D-7 ⚠)
    tally(i.defects.total > 0, !!i.report10)
    tally(i.defects.total > 0, !!i.report11)
  }

  return {
    docs: {
      customerId, customerName: c.customer_name, inspectionType: c.inspection_type,
      firePlan: plan ? {
        id: plan.id, year: plan.year, title: plan.title, revision: plan.revision,
        pdfPath: plan.pdf_path, pdfName: plan.pdf_name, hwpPath: plan.hwp_path, hwpName: plan.hwp_name,
        updatedAt: plan.created_at,
      } : null,
      inspections,
      summary: { need, have, warns },
    },
  }
}

/* ── 별지 서식 트리 회차 로더 (소방계획서_8 H-1) — plan_items∪inspections 자체점검 그룹 ── */

export type CustomerRound = {
  year: number
  sequenceNum: number
  /** special_종합 | special_작동 | null(레거시 자체점검) */
  planType: string | null
  /** planned=계획만(미시작) / in_progress·completed 등=inspections.status */
  state: 'planned' | 'scheduled' | 'in_progress' | 'completed' | 'overdue'
  /** 미시작 회차의 확정·자동 시작용 (H-3) */
  planItemId: string | null
  plannedDate: string | null
  /** 시작된 회차만 — 문서·불량 상태. 완료 회차는 null이고 docsLite만 온다(소방계획서_20 S2) */
  docs: InspectionDocs | null
  /** 완료 회차 요약 (S2) — 펼치기 전까지 storage.list를 돌리지 않으려는 경량 대체본.
   *  ⚠ generated는 '생성 이력'(fire_plan_gen_jobs)이지 파일 존재가 아니다 — 과거본 정리(18)로
   *  파일이 지워진 회차도 true다. 실제 파일 유무는 펼칠 때 getRoundDocsAction이 확정한다. */
  docsLite: RoundDocsLite | null
}

export type RoundDocsLite = {
  inspectionId: string
  endDate: string | null
  /** 생성 이력 유무 (파일 존재 아님 — 위 주석 참조) */
  generated: { report4: boolean; report9: boolean; report10: boolean; report11: boolean; exterior: boolean }
  defectsTotal: number
  /** 배치확인서 종이 보관 정리 마커 (소방계획서_18 D-7) */
  certArchived: boolean
}

export type CustomerRounds = {
  customerId: string
  customerName: string
  inspectionType: string
  rounds: CustomerRound[]
}

/** 회차 1건 문서 상태 재조회 (소방계획서_20 S1) — 생성·업로드 후 전면 reload 대신 해당 회차만 패치.
 *  reload()는 미리보기 캐시 전체를 폐기해 펼친 회차 iframe이 전부 재렌더되던 비용(3+3N 왕복)을 없앤다. */
export async function getRoundDocsAction(customerId: string, inspectionId: string): Promise<{ docs?: InspectionDocs; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: insp } = await admin.from('inspections')
    .select('id, year, sequence_num, inspection_type, status, plan_type, inspection_start_date, inspection_end_date')
    .eq('id', inspectionId).eq('customer_id', customerId).single()
  if (!insp) return { error: '점검 건을 찾을 수 없습니다.' }
  const row = insp as InspRow
  const archivedCerts = await findArchivedCertInspections(admin, [row.id])
  const docs = await buildInspectionDocs(admin, customerId, row, archivedCerts)
  return { docs }
}

export async function getCustomerRoundsAction(customerId: string): Promise<{ data?: CustomerRounds; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers')
    .select('id, customer_name, inspection_type').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  const c = cust as { customer_name: string; inspection_type: string }

  const [inspRes, itemRes] = await Promise.all([
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, status, plan_type, inspection_start_date, inspection_end_date')
      .eq('customer_id', customerId)
      .or(SELF_INSPECTION_OR)
      .order('year', { ascending: false }).order('sequence_num', { ascending: false })
      .limit(24),
    admin.from('inspection_plan_items')
      .select('id, sequence_num, plan_type, planned_date, scheduled_date, status, inspection_id, plan:inspection_plans(year)')
      .eq('customer_id', customerId)
      .or(SELF_INSPECTION_OR)
      .neq('status', 'cancelled')
      .limit(48),
  ])

  const inspRows = (inspRes.data ?? []) as InspRow[]
  type ItemRow = {
    id: string; sequence_num: number; plan_type: string | null
    planned_date: string | null; scheduled_date: string | null
    status: string; inspection_id: string | null
    plan: { year: number } | null
  }
  const items = (itemRes.data ?? []) as unknown as ItemRow[]

  // 시작된 점검 = 회차의 정본.
  // S2(소방계획서_20): 회차마다 buildInspectionDocs(=storage.list+불량+응답 3왕복)를 돌리면 왕복이 3+3N으로
  // 회차 수에 비례해 늘었다(회차 8건이면 마운트 5초+). 화면에서 카드로 펼치는 건 진행 중·예정 회차뿐이므로
  // 완료 회차는 집계 2쿼리로 만든 요약(docsLite)만 싣고, 상세는 펼칠 때 getRoundDocsAction으로 지연 로드한다.
  const activeRows = inspRows.filter(i => i.status !== 'completed')
  const doneRows = inspRows.filter(i => i.status === 'completed')
  const doneIds = doneRows.map(i => i.id)

  const [archivedCerts, docsList, genRes, defRes] = await Promise.all([
    findArchivedCertInspections(admin, inspRows.map(i => i.id)),
    // 활성 회차만 상세 조립 (통상 1~2건)
    Promise.all(activeRows.map(i => buildInspectionDocs(admin, customerId, i))),
    doneIds.length
      ? admin.from('fire_plan_gen_jobs').select('inspection_id, report_type').eq('status', 'done').in('inspection_id', doneIds)
      : Promise.resolve({ data: [] as Array<{ inspection_id: string; report_type: string | null }> }),
    doneIds.length
      ? admin.from('inspection_defects').select('inspection_id').in('inspection_id', doneIds)
      : Promise.resolve({ data: [] as Array<{ inspection_id: string }> }),
  ])
  // archivedCerts는 활성 회차 상세에도 필요하다 — buildInspectionDocs를 병렬로 돌린 뒤 여기서 채운다
  for (const d of docsList) d.certArchived = !d.cert && archivedCerts.has(d.inspectionId)

  const genBy = new Map<string, RoundDocsLite['generated']>()
  for (const j of (genRes.data ?? []) as Array<{ inspection_id: string; report_type: string | null }>) {
    const g = genBy.get(j.inspection_id)
      ?? { report4: false, report9: false, report10: false, report11: false, exterior: false }
    if (j.report_type && j.report_type in g) g[j.report_type as keyof typeof g] = true
    genBy.set(j.inspection_id, g)
  }
  const defBy = new Map<string, number>()
  for (const d of (defRes.data ?? []) as Array<{ inspection_id: string }>) {
    defBy.set(d.inspection_id, (defBy.get(d.inspection_id) ?? 0) + 1)
  }

  const docsByInsp = new Map(docsList.map(d => [d.inspectionId, d]))
  const rounds = new Map<string, CustomerRound>()
  inspRows.forEach(i => {
    const key = `${i.year}-${i.sequence_num}`
    if (rounds.has(key)) return
    const docs = docsByInsp.get(i.id) ?? null
    rounds.set(key, {
      year: i.year, sequenceNum: i.sequence_num, planType: i.plan_type,
      state: (i.status as CustomerRound['state']) ?? 'in_progress',
      planItemId: null, plannedDate: i.inspection_start_date,
      docs,
      docsLite: docs ? null : {
        inspectionId: i.id,
        endDate: i.inspection_end_date,
        generated: genBy.get(i.id) ?? { report4: false, report9: false, report10: false, report11: false, exterior: false },
        defectsTotal: defBy.get(i.id) ?? 0,
        certArchived: archivedCerts.has(i.id),
      },
    })
  })

  // 계획만 있는 회차(미시작) — 같은 연도·차수에 시작된 점검이 없을 때만 추가
  for (const it of items) {
    if (it.inspection_id) continue
    const year = it.plan?.year
    if (!year) continue
    const key = `${year}-${it.sequence_num}`
    if (rounds.has(key)) continue
    rounds.set(key, {
      year, sequenceNum: it.sequence_num, planType: it.plan_type,
      state: 'planned', planItemId: it.id,
      plannedDate: it.scheduled_date ?? it.planned_date, docs: null, docsLite: null,
    })
  }

  const sorted = [...rounds.values()].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : b.sequenceNum - a.sequenceNum)
  return { data: { customerId, customerName: c.customer_name, inspectionType: c.inspection_type, rounds: sorted } }
}

/* ── 행동 자동완성 검색 (R0-3·R0-4·R0-5) — 검색 결과가 곧 실행 버튼 ── */

export type DocCommand =
  | { kind: 'open-docs'; customerId: string; customerName: string; label: string }
  /** 별지 산출물이면 inspectionId를 싣는다 — 저장명은 `/inspections/{id}/doc` 라우트가 붙는다.
   *  saveBase는 그 규약 밖인 소방계획서 파일에만 쓴다(둘 중 하나만 채워진다). */
  | { kind: 'open-file'; customerId: string; customerName: string; label: string; pdfPath?: string; hwpPath?: string; saveBase?: string; inspectionId?: string }
  | { kind: 'upload-cert'; customerId: string; customerName: string; label: string; inspectionId: string }
  | { kind: 'generate-plan'; customerId: string; customerName: string; label: string }

export async function searchDocCommandsAction(q: string): Promise<{
  customers: Array<{ id: string; name: string; type: string }>
  commands: DocCommand[]
}> {
  await requirePermission('inspection_register')
  const query = q.trim()
  if (query.length < 1) return { customers: [], commands: [] }
  const admin = createAdminClient()
  // 초성 검색(R0-5) 지원 — 초성은 DB가 못 거르므로 활성 고객을 받아 와 이름을 여기서 맞춘다.
  // ⚠ `.limit(1000)`은 상한 구실을 못 한다 — PostgREST가 요청당 1000행에서 자르므로 같은 값이고,
  // 고객이 1000곳을 넘으면 뒤쪽 고객은 **검색해도 안 나온다**(오류도 없이). 끝까지 받는다.
  const { rows: all } = await fetchAllRows<{ id: string; customer_name: string; inspection_type: string }>(
    (from, to) => admin.from('customers')
      .select('id, customer_name, inspection_type').eq('is_active', true)
      .order('customer_name').order('id').range(from, to))
  const matched = all.filter(c => hangulMatch(c.customer_name, query)).slice(0, 5)
  const customers = matched.map(c => ({ id: c.id, name: c.customer_name, type: c.inspection_type }))
  if (matched.length === 0) return { customers, commands: [] }

  // 최상위 매칭 고객의 문서·행동 후보 (4-0-13-(1)) — 최신 계획서·최신 9호·배치확인서 업로드·생성.
  // 일반관리 특례 없음 (소방계획서_6 W-16) — 전 유형 동일 후보
  const top = matched[0]
  const commands: DocCommand[] = [
    { kind: 'open-docs', customerId: top.id, customerName: top.customer_name, label: `${top.customer_name} — 문서 현황 열기` },
  ]
  const [planRes, inspRes] = await Promise.all([
    admin.from('fire_plans')
      .select('year, revision, pdf_path, hwp_path')
      .eq('customer_id', top.id).order('year', { ascending: false }).order('revision', { ascending: false }).limit(1),
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, plan_type, inspection_start_date')
      .eq('customer_id', top.id)
      .or('plan_type.is.null,plan_type.like.special_*')
      .order('inspection_start_date', { ascending: false, nullsFirst: false }).limit(1),
  ])
  const plan = (planRes.data?.[0] ?? null) as { year: number; revision: number | null; pdf_path: string | null; hwp_path: string | null } | null
  if (plan && (plan.pdf_path || plan.hwp_path)) {
    commands.push({
      kind: 'open-file', customerId: top.id, customerName: top.customer_name,
      label: `${top.customer_name} · ${plan.year} 소방계획서${plan.revision ? ` (개정${plan.revision})` : ''}`,
      pdfPath: plan.pdf_path ?? undefined, hwpPath: plan.hwp_path ?? undefined,
      saveBase: `${top.customer_name}_소방계획서_${plan.year}`,
    })
  }
  const insp = (inspRes.data?.[0] ?? null) as { id: string; year: number; sequence_num: number } | null
  if (insp) {
    const prefix = `${top.id}/inspections/${insp.id}`
    const { data: objects } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } })
    const g9 = latestGroup(objects ?? [], 'report9', prefix)
    if (g9) {
      commands.push({
        kind: 'open-file', customerId: top.id, customerName: top.customer_name,
        label: `${top.customer_name} · ${GENERATED_DOC_KINDS.report9.label} 최신`,
        pdfPath: g9.pdf?.path, hwpPath: g9.hwp?.path,
        inspectionId: insp.id,
      })
    }
    const hasCert = (objects ?? []).some(o => isCertFileName(o.name))
    // 종이 보관 후 정리된 회차는 '미업로드'가 아니다 — 업로드 재촉 명령을 띄우지 않는다(D-7 ⚠)
    const archived = (await findArchivedCertInspections(admin, [insp.id])).has(insp.id)
    if (!hasCert && !archived) {
      commands.push({
        kind: 'upload-cert', customerId: top.id, customerName: top.customer_name,
        label: `${top.customer_name} · 점검인력 배치확인서 ⚠ 미업로드 (${insp.year}년 ${insp.sequence_num}차)`,
        inspectionId: insp.id,
      })
    }
  }
  commands.push({ kind: 'generate-plan', customerId: top.id, customerName: top.customer_name, label: `${top.customer_name} · 소방계획서 생성 요청` })
  return { customers, commands }
}

/* ── ④ 최근 문서 20건 (R5) — 생성(fire_plan_gen_jobs) + 업로드(activity_logs) 통합 ── */

export type RecentDoc = {
  at: string
  kind: 'gen' | 'upload'
  docKey: string          // report9 | report10 | report11 | exterior | fire_plan | cert | contract
  docLabel: string
  customerId: string | null
  customerName: string
  inspectionId: string | null
}

const UPLOAD_LABELS: Record<string, string> = { cert: '점검인력 배치확인서', contract: '수리 계약서' }

export async function getRecentDocsAction(): Promise<{ docs: RecentDoc[] }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const [genRes, upRes] = await Promise.all([
    admin.from('fire_plan_gen_jobs')
      .select('report_type, customer_id, customer_name, inspection_id, created_at')
      .eq('status', 'done').order('created_at', { ascending: false }).limit(30),
    admin.from('activity_logs')
      .select('created_at, entity_id, metadata')
      .eq('action', 'timeline_upload').order('created_at', { ascending: false }).limit(20),
  ])
  const gens: RecentDoc[] = ((genRes.data ?? []) as Array<{
    report_type: string | null; customer_id: string | null; customer_name: string | null; inspection_id: string | null; created_at: string
  }>).map(j => {
    const key = j.report_type ?? 'fire_plan'
    return {
      at: j.created_at, kind: 'gen' as const, docKey: key,
      docLabel: GENERATED_DOC_KINDS[key]?.label ?? key,
      customerId: j.customer_id, customerName: j.customer_name ?? '—', inspectionId: j.inspection_id,
    }
  })
  const ups: RecentDoc[] = ((upRes.data ?? []) as Array<{
    created_at: string; entity_id: string | null; metadata: { slot?: string; customerId?: string; customerName?: string } | null
  }>).map(l => ({
    at: l.created_at, kind: 'upload' as const, docKey: l.metadata?.slot ?? 'cert',
    docLabel: UPLOAD_LABELS[l.metadata?.slot ?? ''] ?? '업로드 문서',
    customerId: l.metadata?.customerId ?? null, customerName: l.metadata?.customerName ?? '—',
    inspectionId: l.entity_id,
  }))
  const docs = [...gens, ...ups].sort((a, b) => (b.at > a.at ? 1 : -1)).slice(0, 20)
  return { docs }
}

/* ── ⑦ 배치확인서 누락 (R8) + 문서 할 일 위젯 (R0-9) — 판정은 lib/doc-status 1곳 ── */

export async function getMissingCertsAction(): Promise<{ rows: MissingCertRow[] }> {
  await requirePermission('inspection_register')
  return { rows: await findMissingCerts(createAdminClient()) }
}

export async function getDocTodoAction(): Promise<{ dueSoon: DueReport9Row[]; missingCerts: MissingCertRow[] }> {
  await requirePermission('inspection_register')
  return getDocTodo(createAdminClient())
}

/* ── §7-A 제출 현황판 (R14-a·R14-b) — 타임라인 필드 단일 소스, 수기 입력 없음 ── */

export type SubmissionRow = {
  inspectionId: string
  customerId: string
  customerName: string
  year: number
  sequenceNum: number
  inspectionType: string
  status: string
  endDate: string | null
  report9Gen: boolean          // 별지 9호 생성됨
  report9Sent: boolean         // 관계인 발송 이력
  report9SubmittedAt: string | null
  due9Dday: number | null      // 미제출 시 종료+15 D-day
  certUploaded: boolean        // 배치확인서 업로드 (종이 보관 정리분 포함 — 누락 아님 판정)
  certArchived: boolean        // 그중 파일 없이 '종이 보관됨'인 경우 (소방계획서_18 D-7)
  defectsTotal: number
  report10Gen: boolean
  report11Gen: boolean
  report11SubmittedAt: string | null
  risk: number                 // 정렬용 위험도 (작을수록 위험)
  assigneeId: string | null    // P-4: '내 담당만' 필터용 배정 직원
  assigneeName: string | null  // 담당자 표시명
  thisMonth: boolean           // 이번 달 자체점검 여부 (클라이언트 요약 재계산용)
}

export type SubmissionSummary = {
  monthSelf: number       // 이번 달 자체점검
  completed: number       // 완료
  r9NotSubmitted: number  // 9호 미제출
  overdue: number         // 기한 초과
  certMissing: number     // 배치확인서 누락
}

const todayKstStr = () => new Date(Date.now() + 9 * 3600_000).toISOString().split('T')[0]
const shiftYmd = (base: string, days: number) => { const d = new Date(base); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0] }
const diffYmd = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)

export async function getSubmissionBoardAction(opts: { sinceDays?: number } = {}): Promise<{
  rows: SubmissionRow[]; summary: SubmissionSummary
}> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const today = todayKstStr()
  const since = shiftYmd(today, -(opts.sinceDays ?? 90))   // D-9: 기본 최근 90일

  // 자체점검 = plan_type 축 단독 — 일반관리 자체점검도 제출 현황판 대상 (소방계획서_6 W-16, 독립 검증 지적 수정)
  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, status, assigned_employee_id, inspection_start_date, inspection_end_date, report9_submitted_at, report11_submitted_at, customer:customers(customer_name)')
    .or(SELF_INSPECTION_OR)
    .gte('inspection_start_date', since)
    .order('inspection_start_date', { ascending: false, nullsFirst: false })
    .limit(80)
  type Row = {
    id: string; customer_id: string; year: number; sequence_num: number; inspection_type: string; status: string
    assigned_employee_id: string | null
    inspection_start_date: string | null; inspection_end_date: string | null
    report9_submitted_at: string | null; report11_submitted_at: string | null
    customer: { customer_name: string } | null
  }
  const insps = (data ?? []) as unknown as Row[]
  const ids = insps.map(i => i.id)

  // P-4: 담당자 표시명 — 배정 직원 id 배치 조회
  const assigneeIds = [...new Set(insps.map(i => i.assigned_employee_id).filter(Boolean) as string[])]
  const assigneeNames: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: profs } = await admin.from('profiles').select('id, name').in('id', assigneeIds)
    for (const p of (profs ?? []) as Array<{ id: string; name: string }>) assigneeNames[p.id] = p.name
  }

  const gen: Record<string, { r9: boolean; r10: boolean; r11: boolean }> = {}
  const sent: Record<string, boolean> = {}
  const def: Record<string, number> = {}
  if (ids.length > 0) {
    const [jobsRes, delRes, defRes] = await Promise.all([
      admin.from('fire_plan_gen_jobs').select('inspection_id, report_type').eq('status', 'done').in('inspection_id', ids),
      admin.from('report_deliveries').select('inspection_id').in('inspection_id', ids),
      admin.from('inspection_defects').select('inspection_id').in('inspection_id', ids),
    ])
    for (const j of (jobsRes.data ?? []) as Array<{ inspection_id: string; report_type: string | null }>) {
      const g = gen[j.inspection_id] ??= { r9: false, r10: false, r11: false }
      if (j.report_type === 'report9') g.r9 = true
      else if (j.report_type === 'report10') g.r10 = true
      else if (j.report_type === 'report11') g.r11 = true
    }
    for (const d of (delRes.data ?? []) as Array<{ inspection_id: string }>) sent[d.inspection_id] = true
    for (const d of (defRes.data ?? []) as Array<{ inspection_id: string }>) def[d.inspection_id] = (def[d.inspection_id] ?? 0) + 1
  }
  // 배치확인서(storage) 병렬 확인 — 종이 보관 후 정리된 회차는 보유로 본다(소방계획서_18 D-7).
  // 마커가 있어도 파일 존재는 따로 확인한다: 정리 이후 다시 업로드했다면 '종이 보관'이 아니라 '보유'다.
  const archivedCerts = await findArchivedCertInspections(admin, ids)
  const certFiles = await Promise.all(insps.map(i => hasCertFile(admin, i.customer_id, i.id)))

  const monthPrefix = today.slice(0, 7)
  const rows: SubmissionRow[] = insps.map((i, idx) => {
    const g = gen[i.id] ?? { r9: false, r10: false, r11: false }
    const submitted = i.report9_submitted_at
    const due9Dday = !submitted && i.inspection_end_date ? diffYmd(shiftYmd(i.inspection_end_date, 15), today) : null
    const defectsTotal = def[i.id] ?? 0
    const certArchived = !certFiles[idx] && archivedCerts.has(i.id)
    const certUploaded = certFiles[idx] || certArchived
    // 위험도: 기한 초과(음수 dday) < 임박 < 누락 < 정상
    let risk = 100
    if (due9Dday !== null && due9Dday < 0) risk = -100 + due9Dday
    else if (due9Dday !== null && due9Dday <= 7) risk = due9Dday
    else if (i.status === 'completed' && !certUploaded) risk = 50
    return {
      inspectionId: i.id, customerId: i.customer_id, customerName: i.customer?.customer_name ?? '—',
      year: i.year, sequenceNum: i.sequence_num, inspectionType: i.inspection_type, status: i.status,
      endDate: i.inspection_end_date,
      report9Gen: g.r9, report9Sent: !!sent[i.id], report9SubmittedAt: submitted, due9Dday,
      certUploaded, certArchived,
      defectsTotal, report10Gen: g.r10, report11Gen: g.r11, report11SubmittedAt: i.report11_submitted_at,
      risk,
      assigneeId: i.assigned_employee_id,
      assigneeName: i.assigned_employee_id ? assigneeNames[i.assigned_employee_id] ?? null : null,
      thisMonth: (i.inspection_start_date ?? '').startsWith(monthPrefix),
    }
  })
  rows.sort((a, b) => a.risk - b.risk)

  const summary: SubmissionSummary = {
    monthSelf: insps.filter(i => (i.inspection_start_date ?? '').startsWith(monthPrefix)).length,
    completed: rows.filter(r => r.status === 'completed').length,
    r9NotSubmitted: rows.filter(r => !r.report9SubmittedAt && r.status === 'completed').length,
    overdue: rows.filter(r => r.due9Dday !== null && r.due9Dday < 0).length,
    certMissing: rows.filter(r => r.status === 'completed' && !r.certUploaded).length,
  }
  return { rows, summary }
}
