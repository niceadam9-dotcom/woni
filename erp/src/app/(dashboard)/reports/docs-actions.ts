'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { hangulMatch } from '@/lib/hangul'
import { findMissingCerts, getDocTodo, hasCertFile, SELF_INSPECTION_OR, type MissingCertRow, type DueReport9Row } from '@/lib/doc-status'
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
  status: string
  startDate: string | null
  endDate: string | null
  defects: { total: number; done: number; photoPairs: number }
  report9: DocGroupRef | null
  report10: DocGroupRef | null
  report11: DocGroupRef | null
  exterior: DocGroupRef | null
  cert: DocFileRef | null
  contract: DocFileRef | null
}

export type CustomerDocs = {
  customerId: string
  customerName: string
  inspectionType: string
  isGeneral: boolean
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

export async function getCustomerDocsAction(customerId: string): Promise<{ docs?: CustomerDocs; error?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data: cust } = await admin.from('customers')
    .select('id, customer_name, inspection_type').eq('id', customerId).single()
  if (!cust) return { error: '고객을 찾을 수 없습니다.' }
  const c = cust as { id: string; customer_name: string; inspection_type: string }
  const isGeneral = c.inspection_type === '일반관리'

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

  type InspRow = {
    id: string; year: number; sequence_num: number; inspection_type: string; status: string
    plan_type: string | null; inspection_start_date: string | null; inspection_end_date: string | null
  }
  // 자체점검(작동·종합)만 문서 절차 대상 — 정기(monthly)·일반 event 는 행에서 제외 (§3-3)
  const inspRows = ((inspRes.data ?? []) as InspRow[]).filter(i =>
    isGeneral ? i.inspection_type === '일반관리' : (i.inspection_type !== '일반관리' && (!i.plan_type || i.plan_type.startsWith('special'))))

  const inspections: InspectionDocs[] = await Promise.all(inspRows.map(async i => {
    const prefix = `${customerId}/inspections/${i.id}`
    const [objRes, defRes] = await Promise.all([
      admin.storage.from(BUCKET).list(prefix, { limit: 100, sortBy: { column: 'name', order: 'desc' } }),
      admin.from('inspection_defects')
        .select('id, photo_url, after_photo_url, action_completed_at').eq('inspection_id', i.id),
    ])
    const objects = objRes.data ?? []
    const defects = (defRes.data ?? []) as Array<{ photo_url: string | null; after_photo_url: string | null; action_completed_at: string | null }>
    const cert = objects.find(o => /^cert_\d+\./.test(o.name))
    const contract = objects.find(o => /^contract_\d+\./.test(o.name))
    return {
      inspectionId: i.id, year: i.year, sequenceNum: i.sequence_num,
      inspectionType: i.inspection_type, status: i.status,
      startDate: i.inspection_start_date, endDate: i.inspection_end_date,
      defects: {
        total: defects.length,
        done: defects.filter(d => d.action_completed_at).length,
        photoPairs: defects.filter(d => d.photo_url && d.after_photo_url).length,
      },
      report9: latestGroup(objects, 'report9', prefix),
      report10: latestGroup(objects, 'report10', prefix),
      report11: latestGroup(objects, 'report11', prefix),
      exterior: latestGroup(objects, 'exterior', prefix),
      cert: cert ? { path: `${prefix}/${cert.name}`, at: cert.created_at ?? null } : null,
      contract: contract ? { path: `${prefix}/${contract.name}`, at: contract.created_at ?? null } : null,
    } satisfies InspectionDocs
  }))

  // 요약 게이지 (R2-c): 필요 문서 n종 중 m종 보유 — 소방계획서 + 점검 건별 (9호·배치확인서 필수 / 10·11호는 불량 시 / 사진·계약서는 선택이라 제외)
  let need = 0, have = 0, warns = 0
  const tally = (n: boolean, h: boolean) => { if (!n) return; need += 1; if (h) have += 1; else warns += 1 }
  if (!isGeneral) tally(true, !!plan)
  for (const i of inspections) {
    if (isGeneral) { tally(true, !!i.exterior); continue }
    tally(true, !!i.report9)
    tally(true, !!i.cert)
    tally(i.defects.total > 0, !!i.report10)
    tally(i.defects.total > 0, !!i.report11)
  }

  return {
    docs: {
      customerId, customerName: c.customer_name, inspectionType: c.inspection_type, isGeneral,
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

/* ── 행동 자동완성 검색 (R0-3·R0-4·R0-5) — 검색 결과가 곧 실행 버튼 ── */

export type DocCommand =
  | { kind: 'open-docs'; customerId: string; customerName: string; label: string }
  | { kind: 'open-file'; customerId: string; customerName: string; label: string; pdfPath?: string; hwpPath?: string; saveBase: string }
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
  // 초성 검색(R0-5) 지원 — 활성 고객 이름을 서버에서 필터 (약 300건 규모)
  const { data: all } = await admin.from('customers')
    .select('id, customer_name, inspection_type').eq('is_active', true).order('customer_name').limit(1000)
  const matched = ((all ?? []) as Array<{ id: string; customer_name: string; inspection_type: string }>)
    .filter(c => hangulMatch(c.customer_name, query)).slice(0, 5)
  const customers = matched.map(c => ({ id: c.id, name: c.customer_name, type: c.inspection_type }))
  if (matched.length === 0) return { customers, commands: [] }

  // 최상위 매칭 고객의 문서·행동 후보 (4-0-13-(1)) — 최신 계획서·최신 9호·배치확인서 업로드·생성
  const top = matched[0]
  const isGeneral = top.inspection_type === '일반관리'
  const commands: DocCommand[] = [
    { kind: 'open-docs', customerId: top.id, customerName: top.customer_name, label: `${top.customer_name} — 문서 현황 열기` },
  ]
  const [planRes, inspRes] = await Promise.all([
    isGeneral ? Promise.resolve({ data: [] }) : admin.from('fire_plans')
      .select('year, revision, pdf_path, hwp_path')
      .eq('customer_id', top.id).order('year', { ascending: false }).order('revision', { ascending: false }).limit(1),
    admin.from('inspections')
      .select('id, year, sequence_num, inspection_type, plan_type, inspection_start_date')
      .eq('customer_id', top.id)
      .neq('inspection_type', '일반관리')
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
        saveBase: `${top.customer_name}_실시결과 보고서_${(g9.at ?? '').slice(0, 10) || insp.year}`,
      })
    }
    const hasCert = (objects ?? []).some(o => /^cert_\d+\./.test(o.name))
    if (!hasCert) {
      commands.push({
        kind: 'upload-cert', customerId: top.id, customerName: top.customer_name,
        label: `${top.customer_name} · 점검인력 배치확인서 ⚠ 미업로드 (${insp.year}년 ${insp.sequence_num}차)`,
        inspectionId: insp.id,
      })
    }
  }
  if (!isGeneral) {
    commands.push({ kind: 'generate-plan', customerId: top.id, customerName: top.customer_name, label: `${top.customer_name} · 소방계획서 생성 요청` })
  }
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
  certUploaded: boolean        // 배치확인서 업로드
  defectsTotal: number
  report10Gen: boolean
  report11Gen: boolean
  report11SubmittedAt: string | null
  risk: number                 // 정렬용 위험도 (작을수록 위험)
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

  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, sequence_num, inspection_type, status, inspection_start_date, inspection_end_date, report9_submitted_at, report11_submitted_at, customer:customers(customer_name)')
    .neq('inspection_type', '일반관리')
    .or(SELF_INSPECTION_OR)
    .gte('inspection_start_date', since)
    .order('inspection_start_date', { ascending: false, nullsFirst: false })
    .limit(80)
  type Row = {
    id: string; customer_id: string; year: number; sequence_num: number; inspection_type: string; status: string
    inspection_start_date: string | null; inspection_end_date: string | null
    report9_submitted_at: string | null; report11_submitted_at: string | null
    customer: { customer_name: string } | null
  }
  const insps = (data ?? []) as unknown as Row[]
  const ids = insps.map(i => i.id)

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
  // 배치확인서(storage) 병렬 확인
  const certFlags = await Promise.all(insps.map(i => hasCertFile(admin, i.customer_id, i.id)))

  const rows: SubmissionRow[] = insps.map((i, idx) => {
    const g = gen[i.id] ?? { r9: false, r10: false, r11: false }
    const submitted = i.report9_submitted_at
    const due9Dday = !submitted && i.inspection_end_date ? diffYmd(shiftYmd(i.inspection_end_date, 15), today) : null
    const defectsTotal = def[i.id] ?? 0
    const certUploaded = certFlags[idx]
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
      certUploaded, defectsTotal, report10Gen: g.r10, report11Gen: g.r11, report11SubmittedAt: i.report11_submitted_at,
      risk,
    }
  })
  rows.sort((a, b) => a.risk - b.risk)

  const monthPrefix = today.slice(0, 7)
  const summary: SubmissionSummary = {
    monthSelf: insps.filter(i => (i.inspection_start_date ?? '').startsWith(monthPrefix)).length,
    completed: rows.filter(r => r.status === 'completed').length,
    r9NotSubmitted: rows.filter(r => !r.report9SubmittedAt && r.status === 'completed').length,
    overdue: rows.filter(r => r.due9Dday !== null && r.due9Dday < 0).length,
    certMissing: rows.filter(r => r.status === 'completed' && !r.certUploaded).length,
  }
  return { rows, summary }
}
