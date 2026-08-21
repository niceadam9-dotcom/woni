/** 갑지 워크북 앵커 맵 — 좌표를 쓰되 좌표만 믿지 않는다 (소방계획서_27 S3)
 *
 *  발상은 lib/doc-overrides.ts에서 이식했다: 키+라벨 동시 일치 → 어긋나면 생성 실패
 *  (법정·행정 문서에선 조용히 붙이는 것도 조용히 버리는 것도 안 된다).
 *  갑지의 개요 시트는 A열이 라벨·B열이 값이라 라벨 검증이 그냥 옆 셀이다.
 *
 *  전 좌표는 2026-08-21 실측(scripts/_probe-hub-layout.mjs · _probe-delegation-layout.mjs).
 *  서식이 갱신되면 validateAnchors가 먼저 붉어진다 — 그때 재실측해 재승인한다(Q-4: 재변환). */
import * as XLSX from 'xlsx'

export type Anchor = {
  field: string
  sheet: string
  cell: string
  /** 라벨 검증 축 — 이 셀의 실값이 label과 (공백·콜론 무시) 일치해야 주입을 허용한다 */
  labelCell: string
  label: string
  /** 깨진 참조('1번 입력'! 등) 자리 — <f>를 지우고 값으로 대체 */
  dropFormula?: boolean
}

const HUB = '개요'

/** Phase 1 — 개요 허브 + 위임장 대리인 + 계약서 대표자.
 *  스포크(공문·위임장·계약서·계획서·완료보고서)의 나머지 칸은 허브 수식이 채운다(117수식 실측). */
export const ANCHORS: Anchor[] = [
  // 허브 — 문서 공통
  { field: 'year',            sheet: HUB, cell: 'B9',  labelCell: 'A9',  label: '년도' },
  { field: 'sendDateSerial',  sheet: HUB, cell: 'B10', labelCell: 'A10', label: '발신일자' },
  { field: 'docNo',           sheet: HUB, cell: 'B11', labelCell: 'A11', label: '문서번호', dropFormula: true },
  { field: 'inspectSerial',   sheet: HUB, cell: 'B12', labelCell: 'A12', label: '점검일자' },
  { field: 'customerName',    sheet: HUB, cell: 'B14', labelCell: 'A14', label: '상호' },
  { field: 'station',         sheet: HUB, cell: 'D14', labelCell: 'C14', label: '관할소방서' },
  { field: 'address',         sheet: HUB, cell: 'B16', labelCell: 'A16', label: '소재지' },
  // 허브 — 관계인(소방안전관리자). 위임장 C6~C9가 개요!D10~D13을 거쳐 끌어간다
  { field: 'managerName',     sheet: HUB, cell: 'B17', labelCell: 'A17', label: '소방안전관리자성명' },
  { field: 'managerPosition', sheet: HUB, cell: 'D11', labelCell: 'C11', label: '직위' },
  { field: 'managerPhone',    sheet: HUB, cell: 'B19', labelCell: 'A19', label: '전화번호' },
  { field: 'managerBirth',    sheet: HUB, cell: 'D13', labelCell: 'C13', label: '생년월일' },
  // 허브 — 점검 기간(E1을 E2~E8·위임장 C10이 따라간다) · 주된 점검인력
  { field: 'periodLabel',     sheet: HUB, cell: 'E1',  labelCell: 'A1',  label: '주된점검인력' },
  { field: 'daysLabel',       sheet: HUB, cell: 'F1',  labelCell: 'A1',  label: '주된점검인력' },
  { field: 'mainInspector',   sheet: HUB, cell: 'B1',  labelCell: 'A1',  label: '주된점검인력' },
  // 위임장 — 대리인 4칸. 원본은 존재하지 않는 '1번 입력'! 시트를 참조한다(실측) —
  // 재계산을 안 켜면 #REF!로 드러나지도 않아 캐시값만 보고 지나치기 쉽다. 값으로 대체한다.
  { field: 'agentName',       sheet: '위임장', cell: 'N6', labelCell: 'K6', label: '성명',     dropFormula: true },
  { field: 'agentPosition',   sheet: '위임장', cell: 'N7', labelCell: 'K7', label: '직위',     dropFormula: true },
  { field: 'agentPhone',      sheet: '위임장', cell: 'N8', labelCell: 'K8', label: '연락처',   dropFormula: true },
  { field: 'agentBirth',      sheet: '위임장', cell: 'N9', labelCell: 'K9', label: '생년월일', dropFormula: true },
  // 계약서(Q-2: 공란이 아니라 문서로) — 대표자는 존재하지 않는 '입력'! 참조라 값으로 대체.
  // 보수금액 E11·E14의 NUMBERSTRING은 한국어 Excel 전용 함수다: LibreOffice에선 #NAME?지만
  // 사용자의 실제 도구인 Excel에서는 J11·J14에 금액을 넣으면 한글 금액이 자동으로 살아난다 — 남긴다.
  { field: 'repName',         sheet: '계약서', cell: 'D29', labelCell: 'C29', label: '대표자', dropFormula: true },
]

/** 개요 시트의 **모든 입력 칸** — 완전 덮어쓰기 불변식의 축 (S3-4).
 *  템플릿에는 이 칸 전부가 비어 있어야 하고(잔존 = 다른 고객 문서에 남의 값이 인쇄된다),
 *  런타임 주입은 앵커에 있는 칸만 채우며 나머지는 빈 채로 남는 것이 정상이다.
 *  좌표는 _probe-hub-layout.mjs 실측 — 라벨 칸(A열·C열 등)은 여기 넣지 않는다. */
export const HUB_INPUT_CELLS: string[] = [
  // 점검인력 블록(1~8행): 이름·자격번호·기간·일수. C열(점검자경력수첩)은 고정 라벨이라 제외
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'E1', 'F1',
  // 9~23행 값 칸
  'B9', 'G9', 'I9', 'J9',
  'B10', 'D10', 'G10',
  'B11', 'D11',
  'B12', 'D12',
  'B13', 'D13',
  'B14', 'D14',
  'B15', 'D15', 'M15', 'P15',
  'B16',
  'B17', 'D17',
  'B18', 'D18',
  'B19', 'D19',
  'B20', 'D20',
  'B21', 'B22', 'B23',
]

/** 라벨 비교 정규화 — 서식의 라벨엔 장식 공백·콜론이 섞여 있다('상호 '·'직  위'·'대 표 자 :') */
const normLabel = (s: string) => s.replace(/[\s:：]/g, '')

export type AnchorCheck = { ok: true } | { ok: false; failures: string[] }

/** 앵커 전수 검증 — 하나라도 어긋나면 주입을 시작하지 않는다(조용한 오적용 금지).
 *  SheetJS **읽기**만 쓴다. */
export function validateAnchors(templateBytes: Uint8Array): AnchorCheck {
  const wb = XLSX.read(templateBytes, { cellStyles: false })
  const failures: string[] = []
  for (const a of ANCHORS) {
    const ws = wb.Sheets[a.sheet]
    if (!ws) { failures.push(`${a.field}: 시트 '${a.sheet}' 없음`); continue }
    const lv = String(ws[a.labelCell]?.v ?? '')
    if (normLabel(lv) !== normLabel(a.label)) {
      failures.push(`${a.field}: ${a.sheet}!${a.labelCell} 라벨 불일치 — 기대 '${a.label}', 실제 '${lv || '(빈칸)'}'`)
    }
  }
  return failures.length ? { ok: false, failures } : { ok: true }
}
