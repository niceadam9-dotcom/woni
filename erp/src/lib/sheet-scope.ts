/** 점검표 시트 범위 판정 — 버전 분기·종합전용 필터·그룹 계산의 단일 소스.
 *
 *  §9-9a: 자체점검 여부는 plan_type 축 단독 판정 (special_*·null=자체점검 / monthly·레거시 event=정기·일반).
 *  inspection_type(관리유형)은 plan_type=null 레거시 건의 종류(작동/종합) 구분에만 쓴다.
 *
 *  관리유형으로 버전을 고르면 안 된다 — 일반관리 자체점검(inspection_type='일반관리' + plan_type='special_작동',
 *  소방계획서_6 W-4)에서 화면은 v2025(STD)를 그리는데 저장은 v2022(EXT) 항목코드가 되는 축 불일치가 난다.
 *  화면(점검 상세·회차별 조회)과 서버 액션(전체 양호·불량 검색·진행률 집계)이 모두 이 함수를 거친다. */

export type SheetVersion = 'v2025' | 'v2022'

export type SheetScope = {
  isSpecial: boolean       // 자체점검 = 소방시설등점검표(STD v2025) / 아니면 외관점검표(EXT v2022)
  isOperational: boolean   // 작동점검 — 종합전용(●) 항목 숨김
  version: SheetVersion
}

export function sheetScope(planType: string | null | undefined, inspectionType?: string | null): SheetScope {
  const pt = planType ?? null
  const isSpecial = !pt || pt.startsWith('special')
  // plan_type이 있으면 그것으로, 없는 레거시 건만 관리유형으로 종류 판정
  const isOperational = isSpecial && (pt === 'special_작동' || (!pt && inspectionType === '작동'))
  return { isSpecial, isOperational, version: isSpecial ? 'v2025' : 'v2022' }
}

/** 이 점검 건에서 표시·집계 대상인 항목인지 — 작동점검이면 종합전용(●) 제외 */
export function isItemInScope(item: { comprehensive_only: boolean }, scope: SheetScope): boolean {
  return !scope.isOperational || !item.comprehensive_only
}

/** 항목 그룹 라벨 — 표준(STD, 숫자 시작)은 코드 접두(1-A-001 → 1-A), 외관(X)·안전시설등(MU)은 서식의 구분란 */
export function sheetItemGroup(itemCode: string, facilityType: string | null): string {
  const byCode = itemCode.replace(/-\d+$/, '')
  return /^[A-Z]/.test(itemCode) ? (facilityType ?? byCode) : byCode
}

/** 화면 우상단 범위 라벨 */
export function scopeLabel(scope: SheetScope): string {
  if (!scope.isSpecial) return '외관점검 (별지 6호)'
  return scope.isOperational ? '작동점검 (○항목)' : '종합점검 (전체)'
}
