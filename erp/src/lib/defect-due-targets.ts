/** 불량 이행기한 알림의 **대상 묶기** — 크론 `defect-action-notify`가 쓰는 순수 함수 (2026-10-02)
 *
 *  🚨 종전 크론은 `inspection_defects.action_end = 기한`으로 행을 골랐다. 그런데 2026-09-11부터
 *    `action_end`를 쓰는 화면 경로가 없다(defect-actions.ts 주석) — 신규 회차의 이행기한은
 *    `annex_inputs(report10).fields.totalPeriod`(사람이 확정한 총 이행기간)에만 있다. 그래서 그 날 이후
 *    회차는 D-7·D-3·당일·경과 알림이 한 건도 나가지 않았다. 대시보드는 같은 값을 `repairEndISO`로
 *    읽고 있었으니 **화면과 크론이 다른 기한을 보고 있던 것**이다.
 *
 *  여기서는 대시보드·별지 10·11호와 **같은 함수**(`repairEndISO`: 총 이행기간 종료일 → 없으면
 *  불량별 action_end 최댓값)로 회차의 실질 기한을 하나 구하고, 회차 단위로 묶어 돌려준다.
 *  크론은 그 결과에서 `end === 규칙 날짜`인 회차만 알림으로 만든다. 사본 산식을 두지 않는다. */
import { repairEndISO } from '@/lib/annex-due'

export type DueDefect = {
  id: string
  inspection_id: string
  defect_name: string
  action_end: string | null
}

export type DueGroup<T extends DueDefect> = {
  /** 회차의 실질 이행기한(YYYY-MM-DD). repairEndISO가 ''면 묶음에서 빠진다(기한 없는 회차는 알릴 것이 없다) */
  end: string
  list: T[]
}

/**
 * 미완료 불량들을 회차별로 묶고, 회차의 실질 기한을 `repairEndISO`로 구한다.
 * @param defects  action_completed_at이 null인 불량 전부(회차 섞여 있어도 됨)
 * @param periodOf 회차 → annex_inputs(report10).fields.totalPeriod 문자열("YYYY-MM-DD ~ YYYY-MM-DD"). 없으면 ''
 */
export function groupDefectsByRepairEnd<T extends DueDefect>(
  defects: ReadonlyArray<T>, periodOf: ReadonlyMap<string, string>,
): Map<string, DueGroup<T>> {
  const byInspection = new Map<string, T[]>()
  for (const d of defects) {
    const list = byInspection.get(d.inspection_id) ?? []
    list.push(d)
    byInspection.set(d.inspection_id, list)
  }
  const out = new Map<string, DueGroup<T>>()
  for (const [inspectionId, list] of byInspection) {
    const end = repairEndISO({
      totalPeriod: periodOf.get(inspectionId) ?? '',
      actionEnds: list.map(d => d.action_end),
    })
    if (!end) continue
    out.set(inspectionId, { end, list })
  }
  return out
}

/** 규칙 날짜에 걸리는 회차만 — 크론의 규칙 루프가 쓴다 */
export function pickDueOn<T extends DueDefect>(
  groups: ReadonlyMap<string, DueGroup<T>>, endDate: string,
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const [id, g] of groups) if (g.end === endDate) out.set(id, g.list)
  return out
}
