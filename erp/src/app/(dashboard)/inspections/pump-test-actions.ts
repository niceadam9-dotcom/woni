'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser, requirePermission } from '@/lib/auth'
import {
  PUMP_TEST_SHEETS, PUMP_KINDS, emptyPumpRow, pumpRowHasValue,
  type PumpKind, type PumpTestRow,
} from '@/lib/pump-test'

/** 펌프성능시험 실측치 (소방계획서_21 R5-7 후속) — 법정 별지 4호 "※ 펌프성능시험" 표의 원천.
 *  ⚠ 'use server' 파일의 export는 그 자체가 공개 엔드포인트다 — 액션마다 스스로 권한을 검사한다. */

type DbRow = {
  sheet_no: number; pump_kind: string
  shutoff_flow: number | null; shutoff_press: number | null
  rated_flow: number | null; rated_press: number | null
  over_flow: number | null; over_press: number | null
  set_start_press: number | null; set_stop_press: number | null
  judge1: string | null; judge2: string | null; judge3: string | null; note: string | null
}

const toRow = (d: DbRow): PumpTestRow => ({
  sheetNo: d.sheet_no,
  pumpKind: (d.pump_kind === '예비' ? '예비' : '주') as PumpKind,
  shutoffFlow: d.shutoff_flow, shutoffPress: d.shutoff_press,
  ratedFlow: d.rated_flow, ratedPress: d.rated_press,
  overFlow: d.over_flow, overPress: d.over_press,
  setStartPress: d.set_start_press, setStopPress: d.set_stop_press,
  judge1: d.judge1 === 'O' || d.judge1 === 'X' ? d.judge1 : null,
  judge2: d.judge2 === 'O' || d.judge2 === 'X' ? d.judge2 : null,
  judge3: d.judge3 === 'O' || d.judge3 === 'X' ? d.judge3 : null,
  note: d.note,
})

/** 저장된 실측치 조회 — 서버 컴포넌트·별지 조립이 함께 쓴다(조회 경로 하나) */
export async function listPumpTestsAction(inspectionId: string): Promise<{
  rows: PumpTestRow[]; error?: string
}> {
  const user = await getSessionUser()
  if (!user) return { rows: [], error: '인증이 필요합니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspection_pump_tests')
    .select('sheet_no, pump_kind, shutoff_flow, shutoff_press, rated_flow, rated_press,'
      + ' over_flow, over_press, set_start_press, set_stop_press, judge1, judge2, judge3, note')
    .eq('inspection_id', inspectionId)
    .order('sheet_no')
  // 131 미적용 환경에서 화면 전체가 죽지 않게 — 표만 비고 나머지는 정상 동작한다
  if (error) return { rows: [], error: error.message }
  return { rows: ((data ?? []) as unknown as DbRow[]).map(toRow) }
}

/** 실측 수치 정규화. **음수는 버린다**(V21-4) — 토출량·토출압·설정압력은 물리적으로 음수가 될 수 없고,
 *  음수가 들어오면 판정식(체절 ≤ 정격×1.4, 150% ≥ 정격×0.65)이 조용히 뒤집혀 잘못된 O가 찍힌다.
 *  0은 유효하다 — 체절운전 토출량은 통상 0이다. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return null
  return n
}
const mark = (v: unknown): 'O' | 'X' | null => (v === 'O' || v === 'X' ? v : null)

/** 한 설비·한 펌프의 실측치 저장. 값이 전부 비면 행을 지운다 —
 *  빈 행을 남기면 별지에 '측정했는데 공란'인지 '측정 안 함'인지 구분되지 않는다. */
export async function savePumpTestAction(
  inspectionId: string,
  sheetNo: number,
  pumpKind: PumpKind,
  input: Partial<Record<
    'shutoffFlow' | 'shutoffPress' | 'ratedFlow' | 'ratedPress' | 'overFlow' | 'overPress'
    | 'setStartPress' | 'setStopPress' | 'judge1' | 'judge2' | 'judge3' | 'note', unknown>>,
): Promise<{ error?: string }> {
  const profile = await requirePermission('inspection_status_edit')
  if (!(PUMP_TEST_SHEETS as readonly number[]).includes(sheetNo)) {
    return { error: '이 설비에는 펌프성능시험 표가 없습니다.' }
  }
  if (!(PUMP_KINDS as readonly string[]).includes(pumpKind)) return { error: '펌프 구분이 올바르지 않습니다.' }

  const row: PumpTestRow = {
    ...emptyPumpRow(sheetNo, pumpKind),
    shutoffFlow: num(input.shutoffFlow), shutoffPress: num(input.shutoffPress),
    ratedFlow: num(input.ratedFlow), ratedPress: num(input.ratedPress),
    overFlow: num(input.overFlow), overPress: num(input.overPress),
    setStartPress: num(input.setStartPress), setStopPress: num(input.setStopPress),
    judge1: mark(input.judge1), judge2: mark(input.judge2), judge3: mark(input.judge3),
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null,
  }

  const admin = createAdminClient()
  if (!pumpRowHasValue(row)) {
    const { error } = await admin.from('inspection_pump_tests').delete()
      .eq('inspection_id', inspectionId).eq('sheet_no', sheetNo).eq('pump_kind', pumpKind)
    return error ? { error: error.message } : {}
  }

  const { error } = await admin.from('inspection_pump_tests').upsert({
    inspection_id: inspectionId, sheet_no: sheetNo, pump_kind: pumpKind,
    shutoff_flow: row.shutoffFlow, shutoff_press: row.shutoffPress,
    rated_flow: row.ratedFlow, rated_press: row.ratedPress,
    over_flow: row.overFlow, over_press: row.overPress,
    set_start_press: row.setStartPress, set_stop_press: row.setStopPress,
    judge1: row.judge1, judge2: row.judge2, judge3: row.judge3, note: row.note,
    updated_by: profile.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'inspection_id,sheet_no,pump_kind' })
  return error ? { error: error.message } : {}
}
