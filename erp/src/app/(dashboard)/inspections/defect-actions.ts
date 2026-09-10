'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getSessionUser, requirePermission } from '@/lib/auth'
import { syncStepsAndRevalidate, revalidateInspection } from './step-revalidate'
import { extractStoragePath } from '@/lib/defect-photos'
import { dateRangeError, splitRange } from '@/lib/date-range'
import { loadAnnexInputs, fstr } from '@/lib/report9-assemble'
import { completionDateFrom, isPlanFillTarget } from '@/lib/action-period-derive'

export type DefectSeverity = '경미' | '보통' | '중대'

export type ActionPeriod = { startISO: string; endISO: string }

/** ⑤ 계획 기간·⑥ 완료일이 **둘 다 파생되는 원천** — 별지 10호 `totalPeriod`(2026-09-10 사용자 결정).
 *
 *  ⚠ 클라이언트가 들고 있는 값을 **받지 않는다**. 작업대의 서버 prop은 세션 내내 갱신되지 않아서
 *    (같은 파일 :175 F-21 주석 참조) ④에서 기간을 고친 직후 화면 값이 낡는데, 그 낡은 날짜는
 *    별지 11호 「이행조치 일자」에 **그대로 인쇄된다**. 그래서 쓰기 시점마다 서버가 다시 읽는다.
 *  ⚠ 파싱은 `splitRange` 한 곳에서만 한다 — 구분자 규칙을 여기 다시 적으면 화면과 조용히 갈린다.
 *  ⚠ 읽기도 `loadAnnexInputs` 공용을 쓴다(문서 조립기와 같은 행·같은 키를 보게 하려고). */
async function loadActionPeriod(
  admin: ReturnType<typeof createAdminClient>, inspectionId: string,
): Promise<ActionPeriod | null> {
  const fields = await loadAnnexInputs(admin, inspectionId, 'report10')
  const [startISO, endISO] = splitRange(fstr(fields, 'totalPeriod'))
  return startISO && endISO ? { startISO, endISO } : null
}

/** 불량표가 머리글에 띄우는 값. 없으면 null — 호출부가 '아직 없습니다'를 그리게 한다
 *  (「—」로 적으면 기간이 정해진 것처럼 읽힌다). */
export async function getActionPeriodAction(inspectionId: string): Promise<ActionPeriod | null> {
  const user = await getSessionUser()
  if (!user) return null
  return loadActionPeriod(createAdminClient(), inspectionId)
}

// 불량내역 추가
export async function addDefectAction(input: {
  inspectionId: string
  defectCode?: string | null
  defectName: string
  defectDetail?: string | null
  severity: DefectSeverity
}): Promise<{ error?: string; id?: string }> {
  // 인증만으로는 부족하다 — 같은 파일의 다른 액션·점검표 저장과 같은 권한 축을 쓴다
  // ('use server' export는 그 자체가 공개 엔드포인트다. R4 독립 검증 지적)
  const user = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('inspection_defects')
    .insert({
      inspection_id: input.inspectionId,
      defect_code:   input.defectCode   ?? null,
      defect_name:   input.defectName,
      defect_detail: input.defectDetail ?? null,
      severity:      input.severity,
    })
    .select('id')
    .single()

  if (error) return { error: '불량내역 저장에 실패했습니다.' }
  // R4-6: ⑤ 불량이 생기면 분모가 6으로 늘고 ⑤가 미완료로 열린다 (증거 기반 동기화)
  // 36 S2-5(이웃) — 바뀌는 서버 prop: defects.total(칸 제목 분모)·불량 목록 자체.
  // ⚠ 설계 §2.1은 이 자리를 세지 않았다(:148만 적혀 있었다) — 같은 파일·같은 형태라 함께 옮긴다.
  await syncStepsAndRevalidate(admin, input.inspectionId, user.id, { alsoChanged: true })
  return { id: (data as { id: string }).id }
}

// 단골 불량 원터치 칩 TOP 8 + 표준 문구 (소방계획서_5 R13-a·R13-e) —
// 전사 inspection_defects 등록 빈도 상위, 부족분은 defect_catalog 프리셋 백필. 메모 표준 문구도 함께.
export async function getDefectSuggestionsAction(): Promise<{ chips: string[]; standard: string[] }> {
  const user = await getSessionUser()
  if (!user) return { chips: [], standard: [] }
  const admin = createAdminClient()
  const { data } = await admin
    .from('inspection_defects')
    .select('defect_name')
    .order('created_at', { ascending: false })
    .limit(500)
  const freq = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ defect_name: string | null }>) {
    const n = r.defect_name?.trim()
    if (!n) continue
    freq.set(n, (freq.get(n) ?? 0) + 1)
  }
  const chips = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n)
  // 통계 부족(초기) 시 defect_catalog 프리셋으로 백필
  if (chips.length < 8) {
    const { data: cat } = await admin.from('defect_catalog').select('description').order('sort_order').limit(24)
    for (const c of (cat ?? []) as Array<{ description: string }>) {
      if (chips.length >= 8) break
      if (c.description && !chips.includes(c.description)) chips.push(c.description)
    }
  }
  const { data: std } = await admin.from('defect_catalog').select('description').order('sort_order').limit(8)
  const standard = [...new Set(((std ?? []) as Array<{ description: string }>).map(s => s.description).filter(Boolean))]
  return { chips, standard }
}

// 불량사진 업로드 (FormData 방식)
export async function uploadDefectPhotoAction(formData: FormData): Promise<{ error?: string; url?: string }> {
  // 전·후 사진은 별지 11호 증빙이다 — 쓰기 액션이므로 같은 권한 축으로 통일
  const user = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const defectId     = formData.get('defectId')     as string | null
  const inspectionId = formData.get('inspectionId') as string | null
  const file         = formData.get('file')         as File | null
  const field        = (formData.get('field') as string | null) === 'after' ? 'after_photo_url' : 'photo_url'

  if (!defectId || !inspectionId || !file) return { error: '파일 정보가 없습니다.' }

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${inspectionId}/${defectId}/${field === 'after_photo_url' ? 'after_' : ''}${Date.now()}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage
    .from('inspection-defects')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadErr) return { error: '사진 업로드에 실패했습니다.' }

  // ⚠ 종전엔 getPublicUrl()을 저장했다 — 이 버킷은 비공개라 그 주소는 400(Bucket not found)이고
  // 불량사진이 화면 전체에서 뜨지 않았다. DB에는 경로만 두고 표시 시점에 서명한다(lib/defect-photos).
  await admin
    .from('inspection_defects')
    .update({ [field]: path } as Record<string, unknown>)
    .eq('id', defectId)

  // 호출부는 업로드 직후 미리보기에 이 값을 그대로 <img src>로 쓴다 — 서명 URL이어야 보인다
  const { data: signed } = await admin.storage
    .from('inspection-defects')
    .createSignedUrl(path, 3600)

  // 36 S2-6 — 고립 호출 흡수. 종전엔 상세 경로만 무효화해 **목록(/inspections)의 진행률이
  // 조용히 낡았다** — 사진도 ⑤ 증빙(전·후 쌍)이라 목록 집계에 들어간다.
  // sync는 부르지 않는다: 사진은 photoPairs를 바꿀 뿐 단계 판정 근거가 아니다(완료 조건은 조치).
  revalidateInspection(inspectionId)
  return { url: signed?.signedUrl }
}

// 불량 조치 저장 (P34-4 + R-3 §9-7) — 이행계획(별지 10호: 계획·기간) + 조치완료(별지 11호: 내용·완료일)
export async function updateDefectActionAction(input: {
  defectId: string
  inspectionId: string
  actionTaken?: string | null
  actionCompletedAt?: string | null
  actionPlan?: string | null
  actionStart?: string | null
  actionEnd?: string | null
}): Promise<{ error?: string }> {
  // 작업대 ⑤⑥ 불량 표(defect-grid)가 칸마다 이 액션을 부른다 — 인증만으로는 부족하다 (R4 독립 검증 지적)
  const user = await requirePermission('inspection_register')

  const admin = createAdminClient()

  /** F-27 — **보낸 칸만 고친다(부분 업데이트).**
   *
   *  종전엔 `action_taken`·`action_completed_at`을 **항상** 덮어썼다. 그래서 호출부가 낡은
   *  값을 들고 있으면 그게 그대로 DB에 실렸다 — 독립 판정이 실측한 데이터 소실의 기전이다:
   *  ⑤에서 계획을 저장하고 ①로 넘어가면 갱신 왕복이 수 초인데, 그 창에서 ① 카드의 [저장]을
   *  누르면(아무것도 안 치고 눌러도) 카드가 들고 있던 **빈 값**이 다섯 칸에 실렸다.
   *  화면엔 초록색 '저장했습니다'가 뜨고 뒤이은 갱신이 그 빈 값을 실어 와 조용히 일치시켜,
   *  **오류 신호가 어디에도 없었다.**
   *
   *  이 차수는 같은 계열의 결함을 **네 번** 국소 수리했다(F-24·25·26 그리고 이 F-27).
   *  매번 '낡지 않게 만드는 법'을 고쳤고 매번 안 막은 경로가 남았다. 막을 자리는 여기다 —
   *  **낡은 값이 있어도 보내지 않으면 실리지 않는다.** */
  const patch: Record<string, unknown> = {}
  if (input.actionTaken !== undefined) patch.action_taken = input.actionTaken?.trim() || null
  if (input.actionCompletedAt !== undefined) patch.action_completed_at = input.actionCompletedAt || null
  if (input.actionPlan !== undefined) patch.action_plan = input.actionPlan?.trim() || null
  if (input.actionStart !== undefined) patch.action_start = input.actionStart || null
  if (input.actionEnd !== undefined) patch.action_end = input.actionEnd || null
  if (Object.keys(patch).length === 0) return {}   // 보낼 것이 없으면 왕복도 없다

  /** 이행 기간 뒤집힘 차단(2026-08-19) — 화면 두 곳이 각각 부르는 자리라 여기 한 곳에서 막는다.
   *  ⚠ 부분 업데이트가 되면서 **입력만 봐서는 판정할 수 없게 됐다** — 시작일만 보내면 종료일은
   *  DB에 있다. 그래서 한쪽만 와도 **저장 후의 조합**을 만들어 검사한다. 안 그러면
   *  '시작일만 고쳐 기간을 뒤집는' 경로가 열린다. */
  if (input.actionStart !== undefined || input.actionEnd !== undefined) {
    const { data: cur, error: curErr } = await admin
      .from('inspection_defects').select('action_start, action_end').eq('id', input.defectId).single()
    if (curErr) return { error: '조치 내용 저장에 실패했습니다.' }
    const row = cur as { action_start: string | null; action_end: string | null } | null
    const start = input.actionStart !== undefined ? input.actionStart : row?.action_start ?? null
    const end = input.actionEnd !== undefined ? input.actionEnd : row?.action_end ?? null
    const rangeErr = dateRangeError(start, end, '이행 기간')
    if (rangeErr) return { error: rangeErr }
  }

  const { error } = await admin
    .from('inspection_defects')
    .update(patch)
    .eq('id', input.defectId)
  if (error) return { error: '조치 내용 저장에 실패했습니다.' }
  // R4-6: ⑤ 조치완료·해제가 곧 근거 — 완료일을 지우면 ⑤도 되돌아간다(예외 없음)
  // 36 S2-5 — 바뀌는 서버 prop: defects.planned/done/total(칸 제목 'N/M'·10호 미리보기 watch).
  //
  // ✅ **가드로 내렸다(F-21 해소, 2026-08-30).** 이 자리만 alsoChanged를 뺀다 — 셀 blur마다
  //    도는 **유일한 고빈도 경로**이고, 여기서 바뀌는 서버 prop은 전부 클라이언트가 책임진다:
  //      · 집계(planned/done/total) → S3-5 로컬 미러(defectsLocal)
  //      · 행 내용(action_plan 등)  → F-21 부모 편집분(defectEdits) — ⑤·⑥이 공유한다
  //      · 단계 ⑤/⑥ 완료 전이       → stepsChanged가 참이 되므로 **가드가 통과시킨다**
  //    즉 건너뛰는 경우는 "단계 상태가 안 바뀐 저장"뿐이고, 그때 달라지는 화면은 위 둘뿐이다.
  // ⚠ 선행조건을 **검사로** 못박았다: test-workbench-defect-pane-switch.mts(7/0).
  //    그 검사를 이 스위치를 내리기 **전에** 현행 코드에 돌렸더니 3건이 붉었다 —
  //    F-21이 '내리면 생길 사고'라 예고한 것은 실은 **이미 나 있던 사고**였다(S3-7이
  //    router.refresh()를 걷어내며 서버 prop이 세션 내내 갱신되지 않게 됐기 때문).
  await syncStepsAndRevalidate(admin, input.inspectionId, user.id)
  return {}
}

/** ⑥ 불량 조치 완료 — **날짜를 손으로 치지 않는다**(2026-09-10 사용자 결정).
 *
 *  체크 한 번으로 `action_completed_at`을 채운다. 값은 총 이행기간의 **종료일**이고, 기간이 없으면
 *  그 불량의 계획 종료일(`action_end`)로 한 칸 내려간다. **둘 다 없으면 거절한다** — 오늘 날짜를
 *  몰래 넣으면 근거 없는 날짜가 별지 11호 「이행조치 일자」에 그대로 찍히고 아무도 모른다.
 *
 *  ⚠ **이미 들어 있는 날짜는 덮지 않는다.** 손으로 적은 실제 조치일이 있으면 그게 파생값보다 정확하다
 *    (체크 상태는 '값이 있는가'이므로 그 행은 이미 체크로 보인다 — 다시 눌러도 바뀔 것이 없다).
 *  ⚠ 해제는 `null`로 되돌린다. ⑤ 단계 완료 판정이 이 칸 하나에 걸려 있어(inspection-step-sync :108)
 *    해제하면 ⑤도 함께 열린다 — updateDefectActionAction의 R4-6 규약과 같다. */
export async function setDefectCompletionAction(input: {
  defectId: string
  inspectionId: string
  done: boolean
}): Promise<{ error?: string; completedAt?: string | null }> {
  // 표의 다른 칸과 같은 권한 축 — 'use server' export는 그 자체가 공개 엔드포인트다
  const user = await requirePermission('inspection_register')
  const admin = createAdminClient()

  if (!input.done) {
    const { error } = await admin
      .from('inspection_defects').update({ action_completed_at: null }).eq('id', input.defectId)
    if (error) return { error: '완료 해제에 실패했습니다.' }
    await syncStepsAndRevalidate(admin, input.inspectionId, user.id)
    return { completedAt: null }
  }

  // data만 보면 없는 컬럼 하나가 조용한 0행이 된다 — error를 함께 본다
  const { data: cur, error: curErr } = await admin
    .from('inspection_defects').select('action_end, action_completed_at').eq('id', input.defectId).single()
  if (curErr) return { error: '조치 완료 저장에 실패했습니다.' }
  const row = cur as { action_end: string | null; action_completed_at: string | null }
  if (row.action_completed_at) return { completedAt: row.action_completed_at.slice(0, 10) }

  const period = await loadActionPeriod(admin, input.inspectionId)
  // 폴백 사다리는 `action-period-derive`가 단일 원천이다 — 여기 다시 적으면 검사가 닿지 않는다
  const completedAt = completionDateFrom(period?.endISO, row.action_end)
  if (!completedAt) {
    return { error: '총 이행기간이 아직 없습니다 — ④ 소방서 제출의 「총 이행기간」을 먼저 정해 주세요.' }
  }

  const { error } = await admin
    .from('inspection_defects').update({ action_completed_at: completedAt }).eq('id', input.defectId)
  if (error) return { error: '조치 완료 저장에 실패했습니다.' }
  await syncStepsAndRevalidate(admin, input.inspectionId, user.id)
  return { completedAt }
}

/** ⑤ 이행계획 — 총 이행기간을 불량들의 계획 기간에 **빈 칸만** 채운다(2026-09-10 사용자 결정).
 *
 *  ⚠ **값이 있는 행은 건너뛴다.** 한 번의 클릭이 손으로 정한 개별 일정을 지우면 되돌릴 방법이 없다.
 *    건너뛴 건수를 함께 돌려주는 이유도 그것이다 — 화면이 「전건 적용됨」으로 읽히면 거짓말이 된다.
 *  ⚠ 시작·종료를 **한 쌍으로** 판정한다(둘 중 하나라도 있으면 건너뜀). 한쪽만 채우면
 *    기간 뒤집힘이 생길 수 있고, 그건 저장 경로가 막는 바로 그 조합이다. */
export async function applyActionPeriodToPlansAction(input: {
  inspectionId: string
}): Promise<{ error?: string; filled?: number; skipped?: number; period?: ActionPeriod }> {
  const user = await requirePermission('inspection_register')
  const admin = createAdminClient()

  const period = await loadActionPeriod(admin, input.inspectionId)
  if (!period) {
    return { error: '총 이행기간이 아직 없습니다 — ④ 소방서 제출의 「총 이행기간」을 먼저 정해 주세요.' }
  }

  const { data, error: listErr } = await admin
    .from('inspection_defects').select('id, action_start, action_end').eq('inspection_id', input.inspectionId)
  if (listErr) return { error: '불량 목록을 불러오지 못했습니다.' }
  const rows = (data ?? []) as Array<{ id: string; action_start: string | null; action_end: string | null }>

  const targets = rows.filter(isPlanFillTarget)
  if (targets.length > 0) {
    const { error } = await admin
      .from('inspection_defects')
      .update({ action_start: period.startISO, action_end: period.endISO })
      .in('id', targets.map(t => t.id))
    if (error) return { error: '이행기간 적용에 실패했습니다.' }
  }
  // 계획이 생기면 ⑤의 분자가 움직인다 — 목록 진행률까지 바뀌므로 alsoChanged
  await syncStepsAndRevalidate(admin, input.inspectionId, user.id, { alsoChanged: true })
  return { filled: targets.length, skipped: rows.length - targets.length, period }
}

// 불량내역 삭제
export async function deleteDefectAction(defectId: string, inspectionId: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  // Storage 사진 삭제 (있으면) — 전·후 둘 다. 종전엔 photo_url만 지워 조치 후 사진이 고아로 남았다.
  // 경로 추출은 extractStoragePath 공용 — 신형식(경로)·구형식(공개 URL)을 모두 받는다.
  const { data: defect } = await admin
    .from('inspection_defects')
    .select('photo_url, after_photo_url')
    .eq('id', defectId)
    .single()

  const d = defect as { photo_url?: string | null; after_photo_url?: string | null } | null
  const paths = [extractStoragePath(d?.photo_url), extractStoragePath(d?.after_photo_url)]
    .filter((p): p is string => !!p)
  if (paths.length > 0) {
    await admin.storage.from('inspection-defects').remove(paths)
  }

  const { error } = await admin
    .from('inspection_defects')
    .delete()
    .eq('id', defectId)

  if (error) return { error: '삭제에 실패했습니다.' }
  // R4-6: 마지막 불량을 지우면 ⑤⑥이 '해당없음'이 되어 분모가 4로 줄어든다
  // 36 S2-5(이웃) — 바뀌는 서버 prop: defects.total·활성 단계 집합. 설계 §2.1 미기재 자리.
  await syncStepsAndRevalidate(admin, inspectionId, null, { alsoChanged: true })
  return {}
}
