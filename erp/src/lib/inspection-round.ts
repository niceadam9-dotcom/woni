import type { InspectionType } from '@/types'
import { daysBetween } from './kst-date'

/** 차수(1차/2차)에 따른 **행 축** 점검 종류 — 소방계획서_33 D33-1의 단일 원천.
 *
 *  왜 별도 축인가: 종합점검 대상 건물은 사용승인월에 종합(1차), +6개월에 작동(2차)을 한다.
 *  즉 **2차는 법적으로 작동점검**이다. 그런데 '이 고객이 종합 대상인가'(고객 축)와
 *  '이 행이 무슨 점검인가'(행 축)를 같은 값으로 다루면 2차가 종합으로 저장되고,
 *  별지 9호 체크박스·표지 제목·갑지 A2·점검표 범위가 전부 2차를 종합으로 인쇄한다.
 *
 *  이 규칙을 쓰는 곳이 5군데(생성기·수동추가·초과해결·고객동기화·수동등록)라 한 곳에 모은다.
 *  호출부마다 따로 쓰면 한 곳을 놓쳤을 때 그 경로만 조용히 옛 축으로 되돌린다.
 */
export type SubType = '종합' | '작동'

/** 행의 점검 종류. 고객이 종합 대상이어도 2차 행은 '작동'이다. */
export function rowSubType(customerSubType: SubType, sequenceNum: number): SubType {
  return sequenceNum === 2 ? '작동' : customerSubType
}

/** 행의 plan_type. 유형 필터·인쇄물 분기가 전부 이 축을 본다. */
export function rowPlanType(customerSubType: SubType, sequenceNum: number): string {
  return `special_${rowSubType(customerSubType, sequenceNum)}`
}

/** 행의 inspection_type.
 *
 *  ⚠ 일반관리 행에서 이 컬럼은 점검의 성격이 아니라 **관리유형 축**을 나른다. 2차라고 '작동'으로
 *  덮으면 그 고객이 일반관리였다는 정보가 사라지므로 그대로 둔다(점검 종류는 sub_type/plan_type이 나른다).
 */
export function rowInspectionType(
  customerInspectionType: InspectionType,
  customerSubType: SubType,
  sequenceNum: number,
): InspectionType {
  if (customerInspectionType === '일반관리') return '일반관리'
  return rowSubType(customerSubType, sequenceNum)
}

/** 점검종류 라벨 — 표지·공문·위임장 제목(annex-cover-official에서 re-export).
 *  report9-assemble의 ckOp/ckInitial과 같은 축:
 *  '작동' → 작동점검 / '최초' 또는 (종합 && is_initial) → 최초점검 / 그 외 → 종합점검
 *
 *  planType이 **정본**이다 (소방계획서_33 S3-2). 두 가지를 함께 고친다:
 *   ① 종합 대상의 2차는 작동점검인데, 일반관리 행에서는 inspection_type이 점검 성격이 아니라
 *      관리유형 축('일반관리')을 나르므로 그 축만 봐서는 종류를 알 수 없다.
 *   ② 선재 결함 — '일반관리'가 아래 fall-through에 걸려 **'종합점검'으로 오식**되고 있었다.
 *      plan_type(special_종합/special_작동)을 우선 보면 자체점검 행은 전부 정확히 갈린다.
 *      (실측: 자체점검 행은 예외 없이 special_* 를 갖는다. 남는 event·null 레거시는
 *       애초에 표지·공문 생성 대상이 아니다 — INV-D1)
 *
 *  ⚠ 이 파일에 두는 이유: annex-cover-official은 server-only 모듈(supabase/admin 등)을
 *  값으로 끌어와 테스트 스크립트에서 불러올 수 없다. 순수 함수는 순수 모듈에 둔다. */
export function inspectionTypeLabel(
  inspectionType: string | null, isInitial: boolean, planType?: string | null,
): string {
  const t = effectiveSub(inspectionType, planType)
  if (t === '작동') return '작동점검'
  if (t === '최초' || (t === '종합' && isInitial)) return '최초점검'
  return '종합점검'
}

/** 라벨 축과 체크박스 축이 **같은 값**을 보게 하는 공용 유도식.
 *  planType이 정본이고 inspectionType은 폴백이다(위 S3-2 규약). */
function effectiveSub(inspectionType: string | null, planType?: string | null): string {
  const sub = planType?.startsWith('special_') ? planType.slice('special_'.length) : null
  return sub ?? inspectionType ?? ''
}

/** 별지 9호·4호·갑지 머리의 3분기 체크 —
 *  `[ ] 작동점검, 종합점검([ ]최초점검, [ ]그 밖의 종합점검)`
 *
 *  ⚠ **`inspectionTypeLabel`과 반드시 같은 유도식을 쓴다.** 종전 `report9-assemble`은 여기서
 *  `inspection_type`만 봤고 라벨 쪽은 `plan_type`을 봐서 두 축이 갈라져 있었다 — 그 결과
 *  **일반관리 고객의 별지 9호는 세 칸이 모두 빈칸**으로 나갔다(표지는 '작동점검'으로 정확했다).
 *  한 문서 세트 안에서 어긋난 것이라, 축을 하나로 묶는 것이 수리의 본체다.
 *
 *  ⚠ `ckCompEtc`가 라벨의 fall-through('종합점검')와 같게 `!ckOp && !ckInitial`이다.
 *  자체점검 행은 예외 없이 `special_*`를 갖고(INV-D1이 비-자체점검의 별지 생성을 막는다)
 *  서식 생성 경로에서 `t`가 빌 일은 없다 — 그래도 셋 중 하나는 반드시 켜지게 둔다.
 *  세 칸이 모두 빈 서식보다는 낫다. */
export function inspectionCheckboxes(
  inspectionType: string | null, isInitial: boolean, planType?: string | null,
): { ckOp: boolean; ckInitial: boolean; ckCompEtc: boolean } {
  const t = effectiveSub(inspectionType, planType)
  const ckOp = t === '작동'
  const ckInitial = !ckOp && (t === '최초' || (t === '종합' && isInitial))
  return { ckOp, ckInitial, ckCompEtc: !ckOp && !ckInitial }
}

/** `plan_type` → 행의 점검 종류. 자체점검(`special_*`)이 아니면 null.
 *  정기(monthly)·레거시 event는 점검 종류 축이 없다 — 별지 9호 대상도 아니다(INV-D1). */
export function planTypeSub(planType: string | null | undefined): SubType | null {
  if (!planType?.startsWith('special_')) return null
  const s = planType.slice('special_'.length)
  return s === '종합' || s === '작동' ? s : null
}

/** 법정 최초점검 기간 — 사용승인일부터 **60일**(시행규칙 [별표 3]) */
export const INITIAL_INSPECTION_DAYS = 60

/** 법령상 **최초점검**인가 — 사용승인일부터 60일 이내에 실시하는 **종합**점검.
 *
 *  ⚠ 종전 판정은 "이 ERP에 그 고객의 종합점검 이력이 0건이면 최초"였다(actions.ts). 그건
 *  **우리 DB에 언제 등록했는가**를 잰 것이지 법령이 정한 축이 아니다 — 2009년 사용승인 건물을
 *  새로 등록하면 별지 9호에 `[√]최초점검`이 찍혔다. 법정 서식 허위 기재다.
 *
 *  판정 불가일 때는 **false**를 준다: 최초점검은 건물 생애에 한 번뿐이라, 모르는 채 켜는 것보다
 *  끄는 쪽이 안전하다(틀린 체크 < 안전한 '그 밖의 종합점검'). */
export function isInitialByLaw(
  useApprovalDate: string | null | undefined,
  inspectionStartDate: string | null | undefined,
  rowSub: SubType,
): boolean {
  // 작동점검은 종합점검의 하위 구분이 아니다 — 2차(=작동)도 여기서 걸러진다
  if (rowSub !== '종합') return false
  if (!useApprovalDate || !inspectionStartDate) return false
  const d = daysBetween(useApprovalDate, inspectionStartDate)
  if (Number.isNaN(d)) return false
  // 사용승인 **이전**에 한 점검은 최초점검이 아니다(음수 차단이 없으면 과거 날짜가 통과한다)
  return d >= 0 && d <= INITIAL_INSPECTION_DAYS
}
