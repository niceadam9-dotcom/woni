import itemmap from '@/lib/xlsx-donor-itemmap.json' with { type: 'json' }
import { resultMark } from '@/lib/doc-templates/base'
import type { InjectTarget } from '@/lib/xlsx-inject'

/** 설비별 점검표(도너) 시트에 점검 응답을 주입 (소방계획서_32 D트랙 / 30 S5-3)
 *
 *  **왜 이 파일이 생겼나**: 자산은 점검표 서식을 동봉만 하고 「점검결과」 열은 통째로 비어 나갔다.
 *  화면에서 243건을 입력한 고객의 엑셀에 0건이 실렸다(2026-08-29 신고). 회귀가 아니라 미구현이었고,
 *  기존 검사가 전부 초록이었던 이유는 하나다 — 검사가 '넣은 것이 들어갔나'만 보고
 *  '넣었어야 할 것이 빠졌나'를 본 적이 없다. 그래서 여기서는 **못 넣은 것을 사유별로 세어 돌려준다**.
 *
 *  좌표는 런타임에 XML을 파싱하지 않는다 — 빌드(build-workbook-full.mts ⑤b)가 자산에서 뽑아
 *  xlsx-donor-itemmap.json에 박아 둔 것을 읽는다(S5-1). 그 추출은 세 축(A열 코드 / 「점검결과」
 *  헤더 열 / dv sqref)을 교차검증하며, 어긋나면 자산이 갱신되지 않는다.
 *
 *  ⚠ 결과열은 시트마다 다르다(C 33시트 · J 4시트). C로 고정하면 넓은 서식 4시트에서
 *    **점검항목 문구를 마크로 덮어쓴다** — 파일은 멀쩡히 열리고 주입 누락도 0이라 조용히 나간다. */

type Resp = { item_code: string; result: 'O' | 'X' | 'N'; month: number }

export type DonorInjectPlan = {
  /** 남아 있는 시트에 실제로 착지하는 것만 — injectWorkbook의 missed는 '코드 결함'으로 남겨둔다 */
  targets: InjectTarget[]
  landed: number
  /** 분모 — DB에 있던 응답 수(카탈로그로 거르기 **전**) */
  total: number
  /** 착지 못 한 응답, 사유별. 조용한 누락 금지(S5-4) */
  notLanded: {
    /** 매핑은 있으나 그 설비가 미설치라 시트가 제거됨 — 정상 시나리오다 */
    sheetRemoved: string[]
    /** 자산에 그 항목의 줄 자체가 없다(서식 미보유 설비 등) — 27 S10-2 잔여 */
    noDonorRow: string[]
    /** 같은 코드에 응답이 여러 행(외관 month 축 등) — 마지막을 조용히 쓰지 않고 표면화 */
    duplicated: string[]
  }
}

// JSON 임포트는 배열을 string[]로 넓혀 읽으므로 튜플로 좁힌다(값의 모양은 빌드 ⑤b가 보증)
const CELLS = itemmap.cells as unknown as Record<string, [sheet: string, cell: string]>

/** 코드 → 도너 좌표. 없으면 자산에 그 줄이 없다는 뜻 */
export function donorCellForItem(code: string): { sheet: string; cell: string } | null {
  const v = CELLS[code]
  return v ? { sheet: v[0], cell: v[1] } : null
}
export const DONOR_ITEM_COUNT = Object.keys(CELLS).length
export const DONOR_RESULT_COLS = itemmap.resultCols as Record<string, string>

export function planDonorInjection(responses: Resp[], keptSheets: Set<string>): DonorInjectPlan {
  const sheetRemoved: string[] = []
  const noDonorRow: string[] = []
  const duplicated: string[] = []
  const targets: InjectTarget[] = []

  // 코드별 묶기 — 같은 코드가 두 행 이상이면(외관 month) 임의로 고르지 않고 고지한다
  const byCode = new Map<string, Resp[]>()
  for (const r of responses) (byCode.get(r.item_code) ?? byCode.set(r.item_code, []).get(r.item_code)!).push(r)

  for (const [code, rows] of byCode) {
    const loc = donorCellForItem(code)
    if (!loc) { noDonorRow.push(code); continue }
    if (!keptSheets.has(loc.sheet)) { sheetRemoved.push(code); continue }
    if (rows.length > 1) {
      // month=0(일반)을 우선 쓰되, 그마저 여럿이면 주입하지 않고 고지한다 — 조용한 임의 선택 금지
      const base = rows.filter(r => r.month === 0)
      if (base.length !== 1) { duplicated.push(`${code}(${rows.length}행)`); continue }
      targets.push({ sheet: loc.sheet, cell: loc.cell, value: resultMark(base[0].result) })
      continue
    }
    targets.push({ sheet: loc.sheet, cell: loc.cell, value: resultMark(rows[0].result) })
  }

  return {
    targets,
    landed: targets.length,
    total: byCode.size,
    notLanded: { sheetRemoved, noDonorRow, duplicated },
  }
}

/** 헤더 한 줄 요약 — 코드를 나열하면 600자에서 잘려 고지가 통째로 사라진다(집계로 낸다) */
export function donorInjectSummary(p: DonorInjectPlan): string | null {
  if (p.total === 0) return null
  const parts = [`점검표 응답 ${p.total}건 중 ${p.landed}건 반영`]
  if (p.notLanded.sheetRemoved.length) parts.push(`시트 미동봉 ${p.notLanded.sheetRemoved.length}건`)
  if (p.notLanded.noDonorRow.length) parts.push(`자산 좌표 없음 ${p.notLanded.noDonorRow.length}건`)
  if (p.notLanded.duplicated.length) parts.push(`⚠중복 응답 미반영 ${p.notLanded.duplicated.length}건`)
  return parts.join(' · ')
}
