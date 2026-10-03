import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export type CompanyProfile = {
  company_name: string
  representative: string | null
  business_number: string | null
  phone: string | null
  /** 팩스 — 결과보고서 표지·공문 레터헤드가 인쇄(소방계획서_22 P-8). 테이블엔 있었는데 select에서 빠져 있었다 */
  fax: string | null
  email: string | null
  address: string | null
  logo_url: string | null
  mark_url: string | null
  default_region_si: string | null
  default_region_myeon: string | null
  /** 공문 발신 명의 (147) — 법인 정식 상호. 비우면 company_name.
   *  레터헤드·표지·위임장은 이 값을 쓰지 않는다: 거기에 법인격을 붙이면 세 곳이 같이 바뀐다 */
  official_sender_name: string | null
  /** 공문 발신 명의 대표 직함 (147) — 비우면 '대표이사' */
  official_rep_title: string | null
  /** 소방시설관리업 등록번호 (예: '경기양평 제2020-01호') — 엑셀 템플릿 운영사 칸 치환(C5)이 읽는다 */
  management_reg_no: string | null
  /** 지번 주소 전체 (173) — 비우면 도로명 주소로 대신 */
  address_jibun: string | null
}

/** 회사 프로필 조회 — 기본 지역·로고 등. 없으면 null
 *
 *  ⚠ '단일 행'을 전제하지만 실제로는 **여러 행이 있을 수 있다**(스테이징 실측: 2행, 2026-08-18).
 *  ORDER BY 없이 `.limit(1)`만 쓰면 Postgres가 매번 같은 행을 준다는 보장이 없어,
 *  읽는 곳과 쓰는 곳이 서로 다른 행을 잡는다 — 실제로 사전 안내 시점(sms_lead_rules)을
 *  저장했는데 배너가 옛 값을 읽는 증상으로 드러났다(소방계획서_24 구현 중 발견).
 *  정렬을 고정해 **모든 읽기·쓰기가 같은 행**을 보게 한다.
 *  행 정리(2026-10-02, 통합 실행계획 A5): 스테이징 2행을 운영과 같은 id(ee612786…) 1행으로 합쳤다
 *  (기본 담당자 이관 뒤 0b8f50b8… 삭제, 백업은 그 세션 scratchpad). 운영은 원래 1행. 정렬 고정은 계속 둔다 —
 *  누가 다시 행을 넣어도 읽기·쓰기가 갈라지지 않게. */
export const COMPANY_PROFILE_ORDER = 'id'

/** 문서 하단 발신 명의 — 상호·직함·대표자 (147 규칙의 단일 원천, C5 2026-10-02).
 *  상호는 [공문 발신 명의](official_sender_name)가 있으면 그것, 없으면 회사명. 직함은 비우면 '대표이사'.
 *  공문(annex-cover-official)과 증명서(hr/certificates)가 같은 규칙을 쓴다 — 종전 증명서는
 *  '(주) 승진소방 대표'를 코드에 박아 두어 회사정보를 바꿔도 따라오지 않았다. */
export type CompanyIssuer = { name: string; title: string; rep: string }
export function companyIssuer(p: Pick<CompanyProfile, 'company_name' | 'official_sender_name' | 'official_rep_title' | 'representative'> | null): CompanyIssuer {
  return {
    name: (p?.official_sender_name ?? '').trim() || (p?.company_name ?? '').trim(),
    title: (p?.official_rep_title ?? '').trim() || '대표이사',
    rep: (p?.representative ?? '').trim(),
  }
}

const BASE_COLS = 'company_name, representative, business_number, phone, fax, email, address, logo_url, mark_url, default_region_si, default_region_myeon'
/** 147 신설 — 아직 적용되지 않은 DB가 있을 수 있다 */
const OFFICIAL_COLS = 'official_sender_name, official_rep_title'
/** C5(2026-10-02) — 등록번호는 열이 오래전부터 있었지만 여기서 안 읽었다. address_jibun은 173 신설 */
const C5_COLS = 'management_reg_no, address_jibun'

export const getCompanyProfile = cache(async (): Promise<CompanyProfile | null> => {
  const admin = createAdminClient()
  const pick = (cols: string) => admin
    .from('company_profile')
    .select(cols)
    .order(COMPANY_PROFILE_ORDER, { ascending: true })
    .limit(1)
    .maybeSingle()

  // 147(OFFICIAL)·173(C5) 미적용 DB는 컬럼이 없어 PostgREST가 거부한다. 이 함수는 표지·공문·위임장·
  // 소방계획서·별지 9호가 전부 쓰는 길목이라, 마이그레이션 한 건 때문에 문서 생성이 통째로 멈추면 안 된다 —
  // 기존 zipcode 재시도(customers/actions.ts)와 같은 관례로 **새 묶음부터 하나씩 떼며** 다시 읽는다.
  let data: unknown = null
  for (const cols of [`${BASE_COLS}, ${OFFICIAL_COLS}, ${C5_COLS}`, `${BASE_COLS}, ${OFFICIAL_COLS}`, BASE_COLS]) {
    const r = await pick(cols)
    if (!r.error) { data = r.data; break }
  }
  if (!data) return null
  // 폴백 경로에는 새 칸이 없다 — 호출부가 `?? ''`로 받도록 null로 채운다
  return {
    official_sender_name: null, official_rep_title: null, management_reg_no: null, address_jibun: null,
    ...(data as object),
  } as CompanyProfile
})
