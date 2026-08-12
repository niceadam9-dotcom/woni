'use server'

import { createHash } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { ARCHIVE_CLEANUP_ACTION, CONTRACT_FILE_RE, isCertFileName } from '@/lib/doc-status'

/** 보관함 [과거본 정리] (소방계획서_18 S2 — 소방계획서_14.md #17)
 *  "최신만 ERP, 과거는 종이 보관" — Storage 산출물 파일만 지운다.
 *  DB 원천·이력(fire_plan_forms·점검 데이터·annex_inputs·fire_plan_revisions·fire_plan_gen_jobs)은
 *  유지한다(D-5) — 별지는 원천에서 언제든 재생성 가능해야 한다.
 *  드라이브 백업 안전망은 사용자 후속 확정으로 폐지(D-6, 2026-08-10) — 종이 단일 보관.
 *  따라서 "종이 보관(인쇄) 완료" 확인이 유일한 게이트다: 삭제된 파일은 어디에도 남지 않는다. */

const BUCKET = 'fire-plans'

type PlanRow = {
  id: string; year: number; revision: number | null; title: string | null; created_at: string
  pdf_path: string | null; hwp_path: string | null; html_path: string | null; odt_path: string | null
}

/** 업로드 원본 스캔 슬롯 — 협회 발급 배치확인서·계약서(D-7).
 *  종이 원본을 이미 보유하므로 ERP 스캔은 사본이라는 판단으로 **과거 회차에 한해** 정리 대상에 넣는다.
 *  최신 회차에서는 절대 지우지 않는다: 별지와 달리 원천에서 재생성할 수 없고,
 *  같은 슬롯에 여러 장(배치확인서 2장 등)을 올렸을 수 있어 '구본' 판정을 적용하면 유실이다. */
const fileName = (path: string) => path.split('/').pop() ?? ''
const isScan = (path: string) => isCertFileName(fileName(path)) || CONTRACT_FILE_RE.test(fileName(path))
/** 배치확인서 슬롯만 — 증빙 누락 감시가 보는 대상이라 마커 판정을 이 슬롯으로 한정한다(D-7 ⚠).
 *  판정하는 쪽(doc-status)과 **같은 규칙**을 써야 한다: 한쪽만 대소문자를 무시하면
 *  '지우기는 하는데 화면은 없다고 하는' 파일이 생긴다. */
const isCertScan = (path: string) => isCertFileName(fileName(path))

export type CleanupPreview = {
  /** 이 목록의 지문 — 실행 시 되돌려보내 대상이 그대로인지 서버가 대조한다 */
  signature: string
  /** 소방계획서 과거본(최신 1건 제외) — attachments = 그 계획서의 부속자료(지도·사진) 파일 수 */
  oldPlans: Array<{ id: string; label: string; fileCount: number; attachments: number }>
  /** 과거 회차 파일 — 별지 산출물(count)과 업로드 스캔(scans, D-7)을 나눠 보여준다 */
  oldRoundFiles: Array<{ round: string; count: number; scans: number }>
  /** 최신 회차 내 타임스탬프 구본 */
  staleLatestFiles: number
  /** ④ 업로드 스캔 합계 — 종이 원본 보유 전제로 삭제된다는 걸 별도로 고지하기 위한 값 */
  scanFiles: number
  /** ⑤ 부속자료 합계 — 업로드 원본이라 재생성 불가. 별도 고지 대상 */
  attachmentFiles: number
  totalFiles: number
}

function planFiles(p: PlanRow): string[] {
  return [
    ...(p.pdf_path ? [p.pdf_path] : []),
    ...(p.hwp_path ? [p.hwp_path] : []),
    ...(p.html_path ? [p.html_path] : []),
    ...(p.odt_path ? [p.odt_path] : []),
    ...(p.pdf_path?.includes('generated_') ? [p.pdf_path.replace(/\.pdf$/, '.form.json')] : []),
  ]
}

/** 회차별 별지 파일 분류 — {reportType}_{timestamp}.{pdf,html} 규약.
 *  최신 회차: reportType별 최신 타임스탬프 파일(pdf·html 쌍)만 남기고 구본은 정리 대상.
 *  과거 회차: 업로드 스캔(cert_·contract_, D-7)을 포함해 전부 정리 대상. */
async function collectAnnexTargets(
  admin: ReturnType<typeof createAdminClient>, customerId: string,
): Promise<{ oldRounds: Array<{ round: string; inspId: string; paths: string[] }>; staleLatest: string[] }> {
  const { data: inspRows } = await admin.from('inspections')
    .select('id, year, sequence_num, plan_type').eq('customer_id', customerId)
    .order('year', { ascending: false }).order('sequence_num', { ascending: false })
  // 자체점검(special_*·null)만 대상 — 별지 산출물이 붙는 축이 자체점검이다(docs-actions와 같은 판정).
  // 정기·레거시 회차를 섞으면 그쪽이 '최신 회차'를 가로채 진짜 최신 별지가 과거로 몰려 삭제된다.
  const inspections = ((inspRows ?? []) as Array<{ id: string; year: number; sequence_num: number; plan_type: string | null }>)
    .filter(i => !i.plan_type || i.plan_type.startsWith('special'))

  const perRound: Array<{ round: string; inspId: string; files: string[] }> = []
  for (const insp of inspections) {
    const prefix = `${customerId}/inspections/${insp.id}`
    const { data: files } = await admin.storage.from(BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
    const names = (files ?? []).filter(f => f.id !== null).map(f => f.name)
    if (names.length > 0) perRound.push({ round: `${insp.year}년 ${insp.sequence_num}차`, inspId: insp.id, files: names.map(n => `${prefix}/${n}`) })
  }
  if (perRound.length === 0) return { oldRounds: [], staleLatest: [] }

  // inspections 쿼리가 최신순 정렬 — 파일이 있는 첫 회차가 "최신 회차"
  const [latest, ...older] = perRound

  // 최신 회차: reportType별 최신 타임스탬프 결정 → 그 외(구본)만 대상.
  // 업로드 스캔은 재생성 불가라 이 판정에서 통째로 제외한다(cert_·contract_도 규약상 이 정규식에 걸린다).
  const latestAnnex = latest.files.filter(p => !isScan(p))
  const latestTs = new Map<string, string>()
  for (const path of latestAnnex) {
    const m = /\/([a-z0-9]+)_(\d+)\.(pdf|html)$/i.exec(path)
    if (!m) continue
    const cur = latestTs.get(m[1])
    if (!cur || cur < m[2]) latestTs.set(m[1], m[2])
  }
  const staleLatest = latestAnnex.filter(path => {
    const m = /\/([a-z0-9]+)_(\d+)\.(pdf|html)$/i.exec(path)
    return m ? latestTs.get(m[1]) !== m[2] : false   // 규약 밖 파일은 건드리지 않는다
  })

  return { oldRounds: older.map(r => ({ round: r.round, inspId: r.inspId, paths: r.files })), staleLatest }
}

/** 소방계획서 과거본 — 최신 1건을 뺀 나머지와 그 파일들.
 *  "최신"의 축은 보관함·보고서 센터와 같은 연도·개정 차수다(docs-actions.ts와 동일).
 *  created_at으로 고르면 과거 연도본을 나중에 업로드했을 때 당해년도본이 지워진다.
 *  부속자료(지도·사진)는 fire_plans 행이 지워질 때 FK CASCADE(086)로 행이 함께 사라지므로,
 *  파일을 같이 지우지 않으면 아무도 접근 못 하는 고아 파일만 남는다 — 그래서 대상에 포함한다. */
async function collectPlanTargets(
  admin: ReturnType<typeof createAdminClient>, customerId: string,
): Promise<Array<{ row: PlanRow; files: string[]; attachments: string[] }>> {
  const { data: planRows } = await admin.from('fire_plans')
    .select('id, year, revision, title, created_at, pdf_path, hwp_path, html_path, odt_path')
    .eq('customer_id', customerId)
    .order('year', { ascending: false })
    .order('revision', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  const oldPlans = ((planRows ?? []) as PlanRow[]).slice(1)   // 최신 1건 제외 (D-2)
  if (oldPlans.length === 0) return []

  const { data: attRows } = await admin.from('fire_plan_attachments')
    .select('fire_plan_id, file_path').in('fire_plan_id', oldPlans.map(p => p.id))
  const byPlan = new Map<string, string[]>()
  for (const a of (attRows ?? []) as Array<{ fire_plan_id: string; file_path: string }>) {
    byPlan.set(a.fire_plan_id, [...(byPlan.get(a.fire_plan_id) ?? []), a.file_path])
  }
  return oldPlans.map(row => ({ row, files: planFiles(row), attachments: byPlan.get(row.id) ?? [] }))
}

/** 대상 목록의 지문 — 미리보기와 실행 사이에 대상이 바뀌면 실행을 막기 위한 것.
 *  삭제는 복구 불가라, 사용자가 확인한 목록과 실제 지울 목록이 다르면 그냥 진행해서는 안 된다.
 *  (예: 확인 후 새 계획서가 생기면 직전까지 최신이던 계획서가 과거본으로 강등된다) */
function targetSignature(
  oldPlans: Array<{ row: PlanRow; files: string[]; attachments: string[] }>,
  oldRounds: Array<{ paths: string[] }>, staleLatest: string[],
): string {
  const all = [
    ...oldPlans.flatMap(p => [`plan:${p.row.id}`, ...p.files, ...p.attachments]),
    ...oldRounds.flatMap(r => r.paths), ...staleLatest,
  ].sort()
  return createHash('sha1').update(all.join('\n')).digest('hex').slice(0, 16)
}

export async function listCleanupTargetsAction(customerId: string): Promise<{ data?: CleanupPreview; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()

  const oldPlans = await collectPlanTargets(admin, customerId)
  const { oldRounds, staleLatest } = await collectAnnexTargets(admin, customerId)

  const totalFiles = oldPlans.reduce((n, p) => n + p.files.length + p.attachments.length, 0)
    + oldRounds.reduce((n, r) => n + r.paths.length, 0) + staleLatest.length

  return {
    data: {
      signature: targetSignature(oldPlans, oldRounds, staleLatest),
      oldPlans: oldPlans.map(p => ({
        id: p.row.id,
        // 같은 연도·같은 개정 차수 행이 둘일 수 있다 — 제목만으로는 구분되지 않으므로
        // 연도와 등록일까지 붙여 어떤 항목이 지워지는지 화면에서 특정할 수 있게 한다
        label: `${p.row.year}년 ${p.row.title ?? '소방계획서'}${p.row.revision && p.row.revision > 1 ? ` (개정${p.row.revision})` : ''} · 등록 ${p.row.created_at.slice(0, 10)}`,
        fileCount: p.files.length,
        attachments: p.attachments.length,
      })),
      oldRoundFiles: oldRounds.map(r => {
        const scans = r.paths.filter(isScan).length
        return { round: r.round, count: r.paths.length - scans, scans }
      }),
      staleLatestFiles: staleLatest.length,
      scanFiles: oldRounds.reduce((n, r) => n + r.paths.filter(isScan).length, 0),
      attachmentFiles: oldPlans.reduce((n, p) => n + p.attachments.length, 0),
      totalFiles,
    },
  }
}

export type CleanupResult = {
  plansDeleted: number
  filesDeleted: number
  /** 그중 업로드 스캔(배치확인서·계약서) — D-7 */
  scansDeleted: number
  skipped: Array<{ path: string; reason: string }>
}

export async function cleanupArchiveAction(
  customerId: string,
  /** 종이 보관(인쇄) 완료 확인 — D-6의 유일한 게이트라 서버도 함께 강제한다.
   *  클라이언트 체크박스만으로 두면 액션 직접 호출로 복구 불가 삭제가 그냥 실행된다. */
  confirm?: { printed?: boolean; signature?: string },
): Promise<{ data?: CleanupResult; error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!confirm?.printed) return { error: '종이 보관(인쇄) 완료 확인이 필요합니다.' }
  const admin = createAdminClient()

  // 대상은 서버에서 재계산 — 클라이언트 목록을 신뢰하지 않는다
  const oldPlans = await collectPlanTargets(admin, customerId)
  const { oldRounds, staleLatest } = await collectAnnexTargets(admin, customerId)

  // 확인한 목록과 지금 지울 목록이 같은지 대조 — 다르면 사용자가 못 본 파일이 사라진다.
  // printed와 마찬가지로 **필수**다: 없으면 통과시키면 액션 직접 호출로 미리보기 없이 전량 삭제된다.
  const signature = targetSignature(oldPlans, oldRounds, staleLatest)
  if (!confirm.signature) return { error: '대상 확인이 필요합니다 — [대상 확인]을 먼저 실행해주세요.' }
  if (confirm.signature !== signature) {
    return { error: '확인한 목록 이후 대상이 바뀌었습니다 — [대상 확인]을 다시 눌러 검토해주세요.' }
  }

  const skipped: Array<{ path: string; reason: string }> = []
  const deleted: string[] = []
  let plansDeleted = 0
  let scansDeleted = 0

  async function removeFile(path: string): Promise<boolean> {
    const { error } = await admin.storage.from(BUCKET).remove([path])
    if (error) { skipped.push({ path, reason: `삭제 실패: ${error.message}` }); return false }
    deleted.push(path)
    if (isScan(path)) scansDeleted++
    return true
  }

  // ① 소방계획서 과거본 — 파일(+부속자료)을 **모두** 지운 뒤에만 DB 행을 지운다.
  //    행을 먼저 지우면 fire_plan_attachments가 CASCADE(086)로 함께 사라져 파일이 영영 고아가 되고,
  //    행이 없으면 다음 정리에서 대상으로도 잡히지 않아 재실행으로도 수렴하지 않는다.
  //    (없는 파일에 대한 remove는 에러가 아니므로, 실패 = 진짜 스토리지 오류다)
  //    fire_plan_revisions는 FK ON DELETE SET NULL(120) — 개정이력 무손실(D-5).
  for (const p of oldPlans) {
    let allOk = true
    for (const path of [...p.files, ...p.attachments]) if (!await removeFile(path)) allOk = false
    if (!allOk) {
      // 행을 남기면 이미 지운 경로가 dangling으로 남는다 — 무엇이 남았는지 사용자에게 알린다
      skipped.push({
        path: `fire_plans/${p.row.id}`,
        reason: `${p.row.year}년 ${p.row.title ?? '소방계획서'} — 파일 삭제 실패로 항목을 남겨 둠(일부 파일은 이미 삭제됨, 재실행 필요)`,
      })
      continue
    }
    const { error } = await admin.from('fire_plans').delete().eq('id', p.row.id)
    if (error) { skipped.push({ path: `fire_plans/${p.row.id}`, reason: `행 삭제 실패: ${error.message}` }); continue }
    plansDeleted++
  }

  // ② 과거 회차 별지 파일 + ④ 업로드 스캔(D-7) + ③ 최신 회차 구본 — 파일만 삭제, DB 이력 유지(D-5)
  for (const r of oldRounds) {
    let certs = 0
    for (const path of r.paths) if (await removeFile(path) && isCertScan(path)) certs++
    // 배치확인서를 지운 회차만 마커 — 증빙 감시가 '누락'으로 오경고하지 않게 한다(D-7 ⚠).
    // 계약서(contract_)만 지운 회차에 마커를 남기면 진짜 배치확인서 누락 경고까지 덮여 버린다.
    //
    // 마커는 회차별로 즉시·개별 기록한다. 감사 로그와 한 번에 넣으면 그 insert 하나가 실패할 때
    // 파일은 이미 지워졌는데 마커만 통째로 없어져 전 회차가 영구 오경고 상태가 된다.
    if (certs > 0) {
      const { error } = await admin.from('activity_logs').insert({
        actor_id: profile.id, action: ARCHIVE_CLEANUP_ACTION,
        entity_type: 'inspection', entity_id: r.inspId,
        metadata: { round: r.round, certs, reason: '종이 보관 후 정리' },
      } as Record<string, unknown>)
      if (error) skipped.push({ path: `inspection/${r.inspId}`, reason: `${r.round} — 정리 표시 기록 실패. 파일은 삭제됐으므로 이 회차가 '배치확인서 누락'으로 잘못 표시됩니다(관리자 확인 필요): ${error.message}` })
    }
  }
  for (const path of staleLatest) await removeFile(path)

  // 복구 불가 삭제이므로 '무엇이' 사라졌는지 남긴다 — 2년 증빙 재구성의 유일한 단서(D-5)
  const { error: logErr } = await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: ARCHIVE_CLEANUP_ACTION,
    entity_type: 'customer',
    entity_id: customerId,
    metadata: {
      plansDeleted, filesDeleted: deleted.length, scansDeleted, skipped: skipped.length,
      deletedPaths: deleted, skippedPaths: skipped,
    },
  } as Record<string, unknown>)
  if (logErr) skipped.push({ path: 'activity_logs', reason: `삭제 이력 기록 실패: ${logErr.message}` })

  revalidatePath(`/customers/${customerId}`)
  return { data: { plansDeleted, filesDeleted: deleted.length, scansDeleted, skipped } }
}
