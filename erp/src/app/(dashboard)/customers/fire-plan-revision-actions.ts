'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 개정이력 연도별 히스토리 (마이그레이션 120 — 소방계획서_17.md §2)
 *
 *  종전에는 개정 사유가 fire_plan_forms.sections.revision 단일 슬롯이라 저장할 때마다 덮어써졌다.
 *  여기서는 (고객, 연도, 순번) 단위 행으로 남겨 과거 이력이 보존된다.
 *  자동 행(생성·업로드 실적)과 수동 행을 source로 구분하고, 편집 권한이 다르다:
 *    - manual    : 전 필드 수정·삭제 가능
 *    - generated/uploaded : 서술·작성자·검토·승인만 수정, 일자·출처는 잠금·삭제 불가 (Q-3) */

export type RevisionSource = 'generated' | 'uploaded' | 'manual'

export type RevisionRowData = {
  id: string
  year: number
  seq: number
  revisedOn: string       // YYYY-MM-DD ('' 가능)
  content: string
  authorName: string
  reviewerName: string
  approverName: string
  source: RevisionSource
}

export type RevisionYearGroup = { year: number; rows: RevisionRowData[] }

/** 사용자가 고칠 수 있는 필드 — 자동 행은 revisedOn을 제외하고 받는다 */
export type RevisionInput = {
  revisedOn?: string
  content?: string
  authorName?: string
  reviewerName?: string
  approverName?: string
}

type DbRow = {
  id: string; year: number; seq: number; revised_on: string | null
  content: string | null; author_name: string | null
  reviewer_name: string | null; approver_name: string | null; source: RevisionSource
}

const s = (v: string | null | undefined) => (v ?? '').trim()
const MAX_CONTENT = 200
const MAX_NAME = 40

function toRow(r: DbRow): RevisionRowData {
  return {
    id: r.id, year: r.year, seq: r.seq,
    revisedOn: (r.revised_on ?? '').slice(0, 10),
    content: r.content ?? '',
    authorName: r.author_name ?? '',
    reviewerName: r.reviewer_name ?? '',
    approverName: r.approver_name ?? '',
    source: r.source,
  }
}

/** 입력 검증 — 길이 초과는 자르지 않고 거부한다(문서에 실릴 값이라 조용한 절단은 위험) */
function validate(input: RevisionInput): string | null {
  if (input.content !== undefined && input.content.length > MAX_CONTENT) {
    return `주요 개정내용은 ${MAX_CONTENT}자 이내로 입력해주세요.`
  }
  for (const [k, label] of [['authorName', '작성자'], ['reviewerName', '검토'], ['approverName', '승인']] as const) {
    const v = input[k]
    if (v !== undefined && v.length > MAX_NAME) return `${label}는 ${MAX_NAME}자 이내로 입력해주세요.`
  }
  if (input.revisedOn !== undefined && s(input.revisedOn) && !/^\d{4}-\d{2}-\d{2}$/.test(s(input.revisedOn))) {
    return '개정일 형식이 올바르지 않습니다 (YYYY-MM-DD).'
  }
  return null
}

/** 연도 내림차순 · 연도 안에서는 순번 내림차순(최신이 위) */
export async function listRevisionsAction(customerId: string): Promise<{ years?: RevisionYearGroup[]; error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data, error } = await admin.from('fire_plan_revisions')
    .select('id, year, seq, revised_on, content, author_name, reviewer_name, approver_name, source')
    .eq('customer_id', customerId)
    .order('year', { ascending: false })
    .order('seq', { ascending: false })
  if (error) return { error: `개정이력 조회 실패: ${error.message}` }
  const groups = new Map<number, RevisionRowData[]>()
  for (const r of (data ?? []) as DbRow[]) {
    const list = groups.get(r.year) ?? []
    list.push(toRow(r))
    groups.set(r.year, list)
  }
  return { years: [...groups.entries()].map(([year, rows]) => ({ year, rows })) }
}

/** 연도 내 다음 순번으로 수동 행 추가.
 *  seq는 서버가 max+1로 채번한다 — 클라이언트가 보낸 값을 믿으면 유니크 인덱스가 뚫린다.
 *  동시 저장 경합(23505)은 1회 재시도로 흡수한다. */
export async function addRevisionAction(
  customerId: string, year: number, input: RevisionInput,
): Promise<{ id?: string; error?: string }> {
  const profile = await requirePermission('customer_manage')
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: '연도가 올바르지 않습니다.' }
  const invalid = validate(input)
  if (invalid) return { error: invalid }
  const admin = createAdminClient()

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: top } = await admin.from('fire_plan_revisions')
      .select('seq').eq('customer_id', customerId).eq('year', year)
      .order('seq', { ascending: false }).limit(1).maybeSingle()
    const seq = ((top as { seq: number } | null)?.seq ?? 0) + 1
    const { data, error } = await admin.from('fire_plan_revisions').insert({
      customer_id: customerId,
      year,
      seq,
      revised_on: s(input.revisedOn) || null,
      content: s(input.content),
      author_name: s(input.authorName) || null,
      reviewer_name: s(input.reviewerName) || null,
      approver_name: s(input.approverName) || null,
      source: 'manual',
      created_by: profile.id,
    } as Record<string, unknown>).select('id').single()
    if (!error) {
      revalidatePath(`/customers/${customerId}`)
      return { id: (data as { id: string }).id }
    }
    if (error.code !== '23505') return { error: `추가 실패: ${error.message}` }
  }
  return { error: '동시에 다른 개정이 추가되었습니다 — 잠시 후 다시 시도해주세요.' }
}

/** 행 수정 — 자동 행(generated·uploaded)은 일자·출처를 바꿀 수 없다 (Q-3).
 *  생성 실적의 일자를 사람이 고치면 보관함 파일과 이력이 어긋난다. */
export async function updateRevisionAction(
  customerId: string, id: string, input: RevisionInput,
): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const invalid = validate(input)
  if (invalid) return { error: invalid }
  const admin = createAdminClient()
  const { data: cur, error: findErr } = await admin.from('fire_plan_revisions')
    .select('id, source').eq('id', id).eq('customer_id', customerId).maybeSingle()
  if (findErr) return { error: `조회 실패: ${findErr.message}` }
  if (!cur) return { error: '개정 항목을 찾을 수 없습니다.' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.content !== undefined) patch.content = s(input.content)
  if (input.authorName !== undefined) patch.author_name = s(input.authorName) || null
  if (input.reviewerName !== undefined) patch.reviewer_name = s(input.reviewerName) || null
  if (input.approverName !== undefined) patch.approver_name = s(input.approverName) || null
  if (input.revisedOn !== undefined) {
    if ((cur as { source: RevisionSource }).source !== 'manual') {
      return { error: '생성·업로드 이력의 일자는 바꿀 수 없습니다 — 서술·작성자·검토·승인만 수정할 수 있습니다.' }
    }
    patch.revised_on = s(input.revisedOn) || null
  }
  const { error } = await admin.from('fire_plan_revisions').update(patch).eq('id', id).eq('customer_id', customerId)
  if (error) return { error: `저장 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/** 삭제는 수동 행만 — 생성·업로드 실적은 보관함 파일과 1:1이라 지우면 이력이 사실과 어긋난다 */
export async function deleteRevisionAction(customerId: string, id: string): Promise<{ error?: string }> {
  await requirePermission('customer_manage')
  const admin = createAdminClient()
  const { data: cur, error: findErr } = await admin.from('fire_plan_revisions')
    .select('id, source').eq('id', id).eq('customer_id', customerId).maybeSingle()
  if (findErr) return { error: `조회 실패: ${findErr.message}` }
  if (!cur) return { error: '개정 항목을 찾을 수 없습니다.' }
  if ((cur as { source: RevisionSource }).source !== 'manual') {
    return { error: '생성·업로드 이력은 삭제할 수 없습니다 (보관함 파일과 연결된 기록입니다).' }
  }
  const { error } = await admin.from('fire_plan_revisions').delete().eq('id', id).eq('customer_id', customerId)
  if (error) return { error: `삭제 실패: ${error.message}` }
  revalidatePath(`/customers/${customerId}`)
  return {}
}

/* 생성·업로드 파이프라인의 자동 기록은 여기 두지 않는다 —
 * 'use server' 파일의 export는 전부 공개 엔드포인트가 되므로 권한 검사 없는 액션은 위험하다.
 * 서버 내부 호출용 헬퍼는 lib/fire-plan-revisions.ts(appendGeneratedRevision) 참조. */
