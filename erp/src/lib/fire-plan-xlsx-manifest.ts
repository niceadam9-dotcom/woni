/** 소방계획서 엑셀 manifest 접근기 — 소방계획서_42 S3-2 · **단일 원천**.
 *
 *  `scripts/build-fire-plan-template.mts`가 법정 양식 hwpx에서 자산과 함께 뽑아 놓은
 *  `fire-plan-xlsx-manifest.json`을 타입 붙여 읽는다. 시트명·법정 라벨 문구·빈 상자 글자·
 *  반복 행 예산은 **여기서만** 나온다 — 앵커·값·라우트·검증이 저마다 상수를 들면 갈라진다.
 *
 *  ⚠ 라벨을 코드에 베껴 적지 않는다. 법정 자구는 한 글자만 달라도 다른 문서가 되고,
 *    베낀 쪽은 양식이 개정돼도 조용히 옛 문구를 들고 있는다.
 */
import raw from '@/lib/fire-plan-xlsx-manifest.json'

export interface FirePlanSheetManifest {
  name: string
  no: string | null
  tables: number[]
  rows: number
  cols: number
  merges: number
  bannerRows: number[]
  /** 리터럴로 인쇄되는 문구. 'A1' → 글 */
  labels: Record<string, string>
  /** F-6 — 셀별 원본 빈상자 글자('□' 또는 '☐'). 원본이 두 글자를 섞어 쓴다 */
  boxes: Record<string, string>
  /** `■`를 되돌린 칸 → 원본 글자를 얻은 축('row'|'col') */
  restoredBoxes: Record<string, string>
  /** 형제 빈 상자가 없어 체크가 아니라 **법정 불릿**으로 판정한 `■` 칸 */
  bulletCells: Record<string, string>
  /** 앵커 씨앗 — 'A1' → `{{token}}`이 든 원본 문자열. 템플릿에서 그 셀은 **공란**이다 */
  tokenCells: Record<string, string>
  scrubbed: Record<string, string[]>
  /** 0열이 1,2,3…으로 이어지는 구간 — 반복 행 예산의 파생 원천(S4-3) */
  numberedRuns: { startRow: number; rows: number }[]
}

export interface FirePlanManifest {
  version: number
  doc: string
  scope: string
  source: { file: string; sha256: string; tables: number; cells: number }
  /** `sha256`은 '이 manifest와 이 파일이 한 빌드에서 나왔나', `contentSha256`은 '내용이 실제로
   *  달라졌나'를 답한다. 앞은 재빌드마다 바뀐다(JSZip이 zip 엔트리에 현재 시각을 찍는다) */
  asset: { file: string; sha256: string; contentSha256: string; bytes: number; styles: number }
  scrubNeedles: string[]
  sheets: FirePlanSheetManifest[]
}

// ⚠ JSON을 import하면 TS가 **실제 파일의 리터럴 모양**으로 좁게 추론한다(시트마다 다른
//   `labels` 키 집합이 27개의 서로 다른 타입이 된다). `unknown` 경유가 필요한 이유이고,
//   그래서 이 캐스트는 **검사가 아니다** — 모양이 맞는지는 `scripts/test-fire-plan-xlsx.mts`가 본다.
export const FIRE_PLAN_MANIFEST = raw as unknown as FirePlanManifest

const BY_NAME = new Map(FIRE_PLAN_MANIFEST.sheets.map(s => [s.name, s]))

export function sheetManifest(name: string): FirePlanSheetManifest {
  const s = BY_NAME.get(name)
  if (!s) throw new Error(`fire-plan manifest: 시트 '${name}' 없음 (있는 것: ${[...BY_NAME.keys()].join(' · ')})`)
  return s
}

/**
 * manifest에 적힌 **법정 라벨 원문**을 꺼낸다.
 *
 * ⚠ 없으면 `throw` 한다 — `?? '(없음)'` 로 감싸면 오타 난 좌표가 공허 통과한다(S7-2와 같은 축).
 */
export function labelAt(sheet: string, cell: string): string {
  const s = sheetManifest(sheet)
  const v = s.labels[cell]
  if (!v) throw new Error(`fire-plan manifest: ${sheet}!${cell} 에 라벨이 없다 — 좌표가 밀렸거나 오타다`)
  return v
}

/** 셀별 원본 빈 상자 글자. 모르는 칸이면 `□`(전역 다수) */
export function boxGlyphAt(sheet: string, cell: string): string {
  return sheetManifest(sheet).boxes[cell] ?? '□'
}

/** 토큰 씨앗 원문(`[ {{customer_name}} ] 소방계획서` 처럼 리터럴이 섞인 것도 있다) */
export function tokenTemplateAt(sheet: string, cell: string): string {
  const s = sheetManifest(sheet)
  const v = s.tokenCells[cell]
  if (!v) throw new Error(`fire-plan manifest: ${sheet}!${cell} 은 토큰 칸이 아니다`)
  return v
}

/**
 * 반복 행 예산(S4-3) — `zone_r{n}_c{m}` 꼴 토큰이 실제로 몇 행 깔려 있는지 **manifest에서 센다**.
 * 손으로 `8`이라 적으면 양식이 바뀌어도 8로 남아 9번째 구역이 조용히 사라진다.
 */
export function tokenRowBudget(sheet: string, prefix: string): number {
  const s = sheetManifest(sheet)
  const rows = new Set<number>()
  for (const tpl of Object.values(s.tokenCells)) {
    for (const m of tpl.matchAll(new RegExp(`\\{\\{${prefix}_r(\\d+)_c\\d+\\}\\}`, 'g'))) rows.add(Number(m[1]))
  }
  return rows.size
}

/** 번호가 매겨진 반복 구간(개정이력 11행·입주사 15행 등)의 행 수 */
export function numberedRowBudget(sheet: string): number {
  const runs = sheetManifest(sheet).numberedRuns
  return runs.length ? Math.max(...runs.map(r => r.rows)) : 0
}
