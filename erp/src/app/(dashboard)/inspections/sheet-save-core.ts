/** 점검표 응답 저장 **코어** — sheet-actions.ts에서 추출 (C1, 2026-10-04)
 *
 *  ⚠ 이 파일에는 `'use server'`를 **넣지 않는다** (step-revalidate.ts 전례).
 *  웹 서버액션(`saveSheetResponsesAction`)과 모바일 라우트(`/api/mobile/sheet-save`)가
 *  **같은 저장 한 벌**을 타기 위해서다 — 인증만 입구에서 각자 하고(쿠키 vs Bearer),
 *  범위 가드·병렬 삭제/upsert·규약 스탬프·1.4 따라잡기·단계 동기화는 전부 여기 한 곳이다.
 *  저장 경로가 두 벌이 되면 모바일 저장만 단계가 영영 미완이고 1.4 대장·웹 캐시가 조용히 낡는다.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { sheetScope } from '@/lib/sheet-scope'
import { getAllSheetItems } from '@/lib/sheet-catalog'
import { CURRENT_SHEET_PROTOCOL } from '@/lib/annex-regen-policy'
import { syncStepsAndRevalidate, type RevalidateContext } from './step-revalidate'
import { runAutoCheck } from './facility-autocheck-core'
import type { AutoCheckResult } from '@/lib/facility-autocheck'

type Admin = ReturnType<typeof createAdminClient>

/** 점검 건의 시트 범위 판정에 필요한 축 조회 — plan_type 우선, 관리유형은 레거시 폴백용 (sheet-scope.ts) */
export async function loadScope(admin: Admin, inspectionId: string) {
  const { data } = await admin.from('inspections')
    .select('customer_id, plan_type, assigned_employee_id, customer:customers(inspection_type)')
    .eq('id', inspectionId).maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    customer_id: string; plan_type: string | null
    assigned_employee_id: string | null; customer: { inspection_type: string } | null
  }
  return {
    customerId: row.customer_id,
    assignedEmployeeId: row.assigned_employee_id,
    scope: sheetScope(row.plan_type, row.customer?.inspection_type ?? null),
  }
}

/** S9-1(2026-08-21) — 첫 점검표 입력이 규약을 확정한다. 규약 미상(NULL, 149 도입 전 생성) 회차에
 *  쓰기 액션이 손을 대는 순간 현재 규약을 스탬프한다 — 규약은 점검 실시일이 아니라
 *  **입력 행위**의 속성이라는 원칙. WHERE ... IS NULL이라 확정된 값(legacy_na 포함)은 절대 안 덮는다.
 *  ⚠ syncInspectionSteps 안에 넣지 않는 이유: 그 함수는 파일 업로드·발송 경로에서도 돌아서,
 *  점검표에 손대지 않은 회차까지 스탬프하게 된다. */
export async function stampSheetProtocol(admin: Admin, inspectionId: string) {
  await admin.from('inspections').update({ sheet_protocol: CURRENT_SHEET_PROTOCOL })
    .eq('id', inspectionId).is('sheet_protocol', null)
}

/** 점검표 응답 저장 본체 (P34-2에서 이동) — 해당 항목들 upsert.
 *  EX-4(소방계획서_19, 125): month는 **외관점검표(X% 항목)의 연간 누적 축**이다.
 *  0 = 월 무관(일반 점검표 전부, 기본값) / 1~12 = 그 달의 외관점검 실적.
 *  @param actorId 저장 주체(프로필 id) — updated_by와 단계 동기화 기록에 쓴다. 인증은 호출부 책임. */
export async function saveSheetResponsesCore(
  admin: Admin,
  actorId: string,
  inspectionId: string,
  rows: Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null }>,
  month = 0,
  /** 해당없음(기본)으로 되돌릴 항목 — 종전 O/X 행을 **지운다**.
   *  2026-08-13 기본값이 ／(해당없음)이 되면서 필요해졌다. upsert만으로는 해제가 반영되지 않아
   *  화면에서는 풀렸는데 DB에는 O가 남는다(문서에도 그대로 인쇄된다). */
  clearCodes: string[] = [],
  /** 호출 맥락 — 모바일 라우트는 'route'(updateTag는 Server Action 전용이라 던진다, step-revalidate.ts) */
  ctx: RevalidateContext = 'action',
): Promise<{ error?: string; stepsChanged?: boolean; autoCheck?: AutoCheckResult }> {
  if (!Number.isInteger(month) || month < 0 || month > 12) return { error: '점검 월 값을 확인해주세요.' }

  // 범위 가드(2026-09-02) — 작동 회차의 종합 전용(●) 항목은 저장을 거른다. 화면은 비활성이지만
  // 공개 엔드포인트(액션·라우트)라 서버에서도 같은 축으로 막아야 한다(문서엔 ／ 자동).
  {
    const insp = await loadScope(admin, inspectionId)
    if (insp?.scope.isOperational && rows.length > 0) {
      const comp = new Set((await getAllSheetItems()).filter(i => i.comprehensive_only).map(i => i.item_code))
      rows = rows.filter(r => !comp.has(r.item_code))
    }
  }

  // 저장속도 개선(2026-08-15) — 실측: 저장 1회 완전 종료 5.8초. 지배 요인은 DB가 아니라
  // revalidatePath가 액션 응답에 실어 보내는 상세 페이지 RSC 재렌더(+클라이언트의 중복 refresh)였다.
  // ① 삭제 2종·upsert는 서로소 집합이라 병렬 ② revalidate는 단계 상태가 실제로 바뀐 저장에만.
  // 화면 신선도는 드로어 로컬 상태 + 보드 오버레이(23 S7-24)가 이미 책임진다 — 페이지 서버 props의
  // 응답 사본은 재방문·Realtime(원격 변경)에서 갱신되므로 이 세션에서 낡아도 소비처가 없다.
  const rowCodes = new Set(rows.map(r => r.item_code))
  const clears = clearCodes.filter(c => !rowCodes.has(c))   // 겹치면 값 저장(rows)이 이긴다 — 병렬 안전 보장
  // 외관(X…)만 월 축을 쓴다 — 저장과 같은 규칙으로 지워야 엉뚱한 달이 남지 않는다
  const clrExt = clears.filter(c => c.startsWith('X'))
  const clrStd = clears.filter(c => !c.startsWith('X'))
  const payload = rows.map(r => ({
    inspection_id: inspectionId, item_code: r.item_code, result: r.result,
    // 외관 항목만 월 축을 쓴다 — 일반 점검표에 월이 섞이면 유니크가 갈라져 중복 응답이 생긴다
    month: r.item_code.startsWith('X') ? month : 0,
    memo: r.memo?.trim() || null, updated_by: actorId, updated_at: new Date().toISOString(),
  }))

  const ops: Array<{ label: string; run: PromiseLike<{ error: { message: string } | null }> }> = []
  if (clrStd.length > 0) ops.push({
    label: '해제 반영', run: admin.from('inspection_sheet_responses').delete()
      .eq('inspection_id', inspectionId).eq('month', 0).in('item_code', clrStd),
  })
  if (clrExt.length > 0) ops.push({
    label: '해제 반영', run: admin.from('inspection_sheet_responses').delete()
      .eq('inspection_id', inspectionId).eq('month', month).in('item_code', clrExt),
  })
  if (payload.length > 0) ops.push({
    label: '저장', run: admin.from('inspection_sheet_responses')
      .upsert(payload as Record<string, unknown>[], { onConflict: 'inspection_id,item_code,month' }),
  })
  if (ops.length === 0) return {}
  const results = await Promise.all(ops.map(o => o.run))
  const bad = results.findIndex(r => r.error)
  if (bad >= 0) return { error: `${ops[bad].label} 실패: ${results[bad].error!.message}` }

  // R4-6: ① 점검표 응답이 곧 근거 — 저장 즉시 단계가 스스로 완료된다(버튼 불필요).
  // 해제만 있어도 근거가 줄었으므로 동기화는 항상 돈다.
  await stampSheetProtocol(admin, inspectionId)   // 첫 입력이 규약을 확정한다 (S9-1)

  /* 1.4 대장 **따라잡기**(소방계획서_49 §9, 2026-09-11 사용자 확정) — 관문이 ⓑ경고만이라
     사용자가 1.4를 안 채우고 점검표부터 쓸 수 있다. 그때 대장이 응답을 따라잡지 않으면
     그 설비는 문서에 ／로 인쇄되고(대장이 정본), 필수 미입력 카운터·이탈 팝업·단계 완료 보류·
     별지 경고가 **동시에 침묵**한다(분모가 0이 되므로).
     ⚠ best-effort다 — 대장 반영이 실패했다고 **사용자의 점검 입력이 날아가면 안 된다**.
       실패는 삼키되, 성공 결과(added·ambiguous)는 호출부로 올려 화면이 고지한다(§9-7 미결정 4).
     ⚠ 순서: 이 뒤에 `syncStepsAndRevalidate`가 온다. 대장이 켜지면 필수 집계 **분모가 늘어나**
       단계 판정이 달라질 수 있으므로, 따라잡기가 **먼저** 끝나야 한다. */
  let autoCheck: AutoCheckResult | undefined
  try { autoCheck = await runAutoCheck(inspectionId, { write: true }) }
  catch { /* 대장 따라잡기 실패는 점검표 저장을 깨뜨리지 않는다 */ }

  // 36 S2-2 — 가드째로 헬퍼에 위임. alsoChanged 생략 = 단계가 바뀐 저장에만 무효화(종전과 동일).
  // 이 경로만 가드를 쓸 수 있는 이유는 sheet-actions.ts :319-320 주석이 밝힌 전제 때문이다(소비처가 없다).
  const { stepsChanged } = await syncStepsAndRevalidate(admin, inspectionId, actorId, { ctx })
  return { stepsChanged, autoCheck }
}
