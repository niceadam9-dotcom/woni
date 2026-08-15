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

/** 3층 축(소방계획서_23 134) 입력 — group_*·subgroup_*은 마이그레이션 134 이후에만 온다(옵셔널) */
export type SheetItemGroupInput = {
  item_code: string
  facility_type?: string | null
  group_code?: string | null
  group_name?: string | null
  group_order?: number | null
  subgroup_name?: string | null
  subgroup_order?: number | null
}

export type SheetItemGroupRef = {
  /** 중분류 코드 — STD '1-A' / EXT·MU 서식 구분란 */
  code: string
  /** 중분류 이름 — 134 적용 전 폴백에서는 code와 같을 수 있다(호출부가 name===code로 중복 표기 회피) */
  name: string
  order: number | null
  /** 대괄호 소제목(3층) — null = 소제목 없는 구간 */
  subgroup: string | null
}

/** 항목 → 중분류 참조 — 폴백 순서: group_*(134) → facility_type(EXT/MU) → 코드 접두(STD).
 *  폴백이 있어 134 미적용 DB에서도 안전하다 — UI 작업을 마이그레이션과 병행할 수 있다(23 §5-2). */
export function sheetItemGroupRef(item: SheetItemGroupInput): SheetItemGroupRef {
  const byCode = item.item_code.replace(/-\d+$/, '')
  const isStd = !/^[A-Z]/.test(item.item_code)
  const code = item.group_code ?? (isStd ? byCode : (item.facility_type ?? byCode))
  const name = item.group_name ?? (isStd ? code : (item.facility_type ?? code))
  return { code, name, order: item.group_order ?? null, subgroup: item.subgroup_name ?? null }
}

/** 항목 그룹 라벨(하위호환 래퍼) — 표준(STD, 숫자 시작)은 코드 접두(1-A-001 → 1-A), 외관(X)·안전시설등(MU)은
 *  서식의 구분란. groupName(134)이 오면 STD는 '1-A. 이름' 법정 표기로 자동 개선된다(23 Q-9 — 트리 그룹 헤더). */
export function sheetItemGroup(itemCode: string, facilityType: string | null, groupName?: string | null): string {
  const byCode = itemCode.replace(/-\d+$/, '')
  const isStd = !/^[A-Z]/.test(itemCode)
  if (groupName) return isStd ? `${byCode}. ${groupName}` : groupName
  return isStd ? byCode : (facilityType ?? byCode)
}

/** 화면 우상단 범위 라벨 */
export function scopeLabel(scope: SheetScope): string {
  if (!scope.isSpecial) return '외관점검 (별지 6호)'
  return scope.isOperational ? '작동점검 (○항목)' : '종합점검 (전체)'
}
