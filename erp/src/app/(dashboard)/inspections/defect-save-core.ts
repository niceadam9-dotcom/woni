/** 불량 등록·사진 첨부 **코어** — defect-actions.ts에서 추출 (C1 Phase E, 2026-10-04)
 *
 *  ⚠ 이 파일에는 `'use server'`를 **넣지 않는다** (step-revalidate.ts·sheet-save-core.ts 전례).
 *  웹 서버액션(addDefectAction·uploadDefectPhotoAction)과 모바일 라우트(/api/mobile/defect-add)가
 *  **같은 코드 한 벌**을 탄다. 종전 모바일 입구(Edge add-defect)는 insert만 하고 단계 동기화를
 *  빠뜨려, 앱에서 불량을 넣어도 ⑤가 열리지 않았다 — 입구가 둘이면 이렇게 조용히 갈린다.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { checkImageUpload } from '@/lib/upload-guard'
import { syncStepsAndRevalidate, revalidateInspection, type RevalidateContext } from './step-revalidate'

type Admin = ReturnType<typeof createAdminClient>
export type DefectSeverity = '경미' | '보통' | '중대'

const BUCKET = 'inspection-defects'

/** 불량 한 건 추가 + 단계 동기화.
 *  @param clientKey 모바일 오프라인 큐의 멱등 키(마이그 180). 같은 (점검, 키)가 이미 있으면
 *    **새로 넣지 않고 그 행을 돌려준다**(`existed: true`) — 전송 중 끊겨 재전송된 경우다.
 *    웹은 넘기지 않는다(NULL = 제약 밖, 종전과 동일). */
export async function addDefectCore(
  admin: Admin,
  actorId: string,
  input: {
    inspectionId: string
    defectCode?: string | null
    defectName: string
    defectDetail?: string | null
    severity: DefectSeverity
    clientKey?: string | null
  },
  /** 호출 맥락 — 모바일 라우트는 'route'(updateTag는 Server Action 전용이라 던진다, step-revalidate.ts) */
  ctx: RevalidateContext = 'action',
): Promise<{ error?: string; id?: string; existed?: boolean; photoUrl?: string | null }> {
  const clientKey = input.clientKey?.trim() || null

  if (clientKey) {
    const { data: prev } = await admin.from('inspection_defects')
      .select('id, photo_url').eq('inspection_id', input.inspectionId).eq('client_key', clientKey).maybeSingle()
    if (prev) {
      const p = prev as { id: string; photo_url: string | null }
      return { id: p.id, existed: true, photoUrl: p.photo_url }
    }
  }

  const { data, error } = await admin
    .from('inspection_defects')
    .insert({
      inspection_id: input.inspectionId,
      defect_code:   input.defectCode   ?? null,
      defect_name:   input.defectName,
      defect_detail: input.defectDetail ?? null,
      severity:      input.severity,
      ...(clientKey ? { client_key: clientKey } : {}),
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) {
    // 동시 재전송 경합 — 조회와 insert 사이에 같은 키가 먼저 들어갔다(23505). 그 행을 돌려준다.
    if (clientKey && (error as { code?: string }).code === '23505') {
      const { data: raced } = await admin.from('inspection_defects')
        .select('id, photo_url').eq('inspection_id', input.inspectionId).eq('client_key', clientKey).maybeSingle()
      if (raced) {
        const r = raced as { id: string; photo_url: string | null }
        return { id: r.id, existed: true, photoUrl: r.photo_url }
      }
    }
    return { error: '불량내역 저장에 실패했습니다.' }
  }
  // R4-6: ⑤ 불량이 생기면 분모가 6으로 늘고 ⑤가 미완료로 열린다 (증거 기반 동기화)
  // 36 S2-5(이웃) — 바뀌는 서버 prop: defects.total(칸 제목 분모)·불량 목록 자체.
  await syncStepsAndRevalidate(admin, input.inspectionId, actorId, { alsoChanged: true, ctx })
  return { id: (data as { id: string }).id, existed: false, photoUrl: null }
}

/** 불량 사진 업로드 + 경로 저장 — DB에는 **경로만** 둔다(표시 시점 서명, lib/defect-photos).
 *  @returns path(저장된 경로)·signedUrl(즉시 미리보기용 1시간) */
export async function attachDefectPhotoCore(
  admin: Admin,
  input: { inspectionId: string; defectId: string; file: File; field: 'before' | 'after' },
  ctx: RevalidateContext = 'action',
): Promise<{ error?: string; retryable?: boolean; path?: string; signedUrl?: string }> {
  // A2(2026-10-02) — 확장자 허용목록·10MB·머리 바이트를 보고 서버가 정한 Content-Type을 준다.
  // 가드 거절은 **다시 보내도 같다**(retryable 없음) — 오프라인 큐가 영원히 재시도하지 않게 가른다.
  const checked = await checkImageUpload(input.file, 'photo')
  if (!checked.ok) return { error: checked.error }
  const column = input.field === 'after' ? 'after_photo_url' : 'photo_url'
  const path = `${input.inspectionId}/${input.defectId}/${input.field === 'after' ? 'after_' : ''}${Date.now()}.${checked.ext}`

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, checked.buffer, { contentType: checked.contentType, upsert: true })
  if (uploadErr) return { error: '사진 업로드에 실패했습니다.', retryable: true }

  const { error: updErr } = await admin
    .from('inspection_defects')
    .update({ [column]: path } as Record<string, unknown>)
    .eq('id', input.defectId)
    .eq('inspection_id', input.inspectionId)   // 남의 점검 불량에 경로를 꽂지 못하게 — 짝이 맞아야 쓴다
  if (updErr) return { error: '사진 경로 저장에 실패했습니다.', retryable: true }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)

  // 36 S2-6 — 사진도 ⑤ 증빙(전·후 쌍)이라 목록 집계에 들어간다. sync는 부르지 않는다
  // (사진은 photoPairs를 바꿀 뿐 단계 판정 근거가 아니다 — 완료 조건은 조치).
  revalidateInspection(input.inspectionId, ctx)
  return { path, signedUrl: signed?.signedUrl }
}
