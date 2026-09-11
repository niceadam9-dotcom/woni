/** 문서 요구 매트릭스 — 고객 유형별 필요 문서·필수 필드 (소방계획서_6 §1-1, 2026-07-28 확정)
 *
 *  유형 분기를 화면에 하드코딩하지 않는다 — 모든 화면이 이 상수만 읽는다.
 *  일반관리도 소방안전관리와 완전 동일 프로세스(D-1) — 문서 의무는 관리유형이 아니라
 *  점검 종류(종합/작동)로만 갈린다. 외관점검표는 레거시 event 건 조회 전용(D-4 읽기 보존).
 *  | 종류  | 소방계획서 | 점검표           | 별지 9호            | 10·11호 |
 *  | 종합  | 필요      | 소방시설등점검표  | 작동+종합(15일 보고) | 불량 시 |
 *  | 작동  | 필요      | 소방시설등점검표  | 작동(15일 보고)     | 불량 시 |
 */

export type CustomerDocProfile = {
  inspection_type: string // '종합' | '작동' | '일반관리'
  /** 일반관리 고객의 점검 종류 — inspection_type이 '일반관리'일 때 종합 판정에 사용 (W-14) */
  inspection_sub_type?: string | null
}

export type DocKey = 'fire_plan' | 'checklist' | 'report9_operate' | 'report9_comprehensive' | 'exterior'

export type DocRequirement = {
  doc: DocKey
  label: string
  need: boolean
  note?: string // 기한·보관 규칙 등 안내
}

/** 종합점검 대상 여부 — 소방안전관리는 inspection_type, 일반관리는 sub_type으로 판정 (W-14) */
function isComprehensive(c: CustomerDocProfile): boolean {
  return c.inspection_type === '종합' || c.inspection_sub_type === '종합'
}

/** 고객 유형별 필요 문서 목록 — 칩·카드·준비 화면 공용.
 *  일반관리 특례 없음(소방계획서_6 W-14) — 자체점검 여부는 plan_type(special_*) 축이 판정하고,
 *  고객 단위 문서 의무는 전 유형 동일 */
export function requiredDocs(c: CustomerDocProfile): DocRequirement[] {
  const comprehensive = isComprehensive(c)
  return [
    { doc: 'fire_plan', label: '소방계획서', need: true },
    { doc: 'checklist', label: '소방시설등점검표', need: true, note: '별지 9호 첨부' },
    { doc: 'report9_operate', label: '별지 9호(작동)', need: true, note: '점검 후 15일 내 보고' },
    { doc: 'report9_comprehensive', label: '별지 9호(종합)', need: comprehensive, note: comprehensive ? '점검 후 15일 내 보고' : undefined },
  ]
}

/** ⑤⑥이 '해당없음'인 **사유**만 떼어 둔다 (소방계획서_45 R-5).
 *  칩 라벨(naAllPass)은 이것으로 조립한다 — ④ 안내 같은 **문장** 안에서는 사유만 필요한데,
 *  라벨을 `.replace('해당없음 — ','')`로 잘라 쓰면 ① 문장이 "점검표 모두 합격 — …점검표 모두
 *  합격이라"로 자기를 반복하고 ② 라벨 문구를 바꾸는 순간 그 수술이 조용히 깨진다(독립 판정 지적). */
export const NA_ALL_PASS_REASON = '점검표 모두 합격'

/** ── 용어 사전 (소방계획서_5 §3-5, D-3) — 화면 라벨은 반드시 여기서만 가져다 쓴다 ──
 *  실무·법정 용어 통일: 특별점검→자체점검, 별지 표기는 풀네임(넓은 곳)/축약(좁은 곳)+툴팁 병행 */
export const DOC_TERMS = {
  selfInspection: '자체점검',              // 구 '특별점검' (2차는 '자체점검 2차')
  selfInspection2: '자체점검 2차',
  monthly: '정기점검',                     // D-7: 월 방문 건 호칭 유지
  report9Full: '자체점검 실시결과 보고서 (별지 9호)',
  report9Short: '실시결과 보고서',
  report10Full: '이행계획서 (별지 10호)',
  report11Full: '이행완료 보고서 (별지 11호)',
  checklistStd: '소방시설등점검표',        // 자체점검 점검표
  checklistExterior: '외관점검표',         // 일반관리 점검표 (2년 보관)
  // 2026-09-07 — 축이 '문서 보관'에서 '신고 행위'로 바뀌었다. 대표가 협회에서 직접 신고하고
  // 확인서도 직접 보관하므로 ERP는 파일이 아니라 **신고했다는 사실과 날짜**만 받는다.
  // 옛 이름(배치확인서)은 화면이 문서를 요구한다고 말해 업로드 창구를 찾게 만들었다.
  certFull: '점검인력 배치신고',           // 첫 표기 풀네임, 이후 축약 허용
  certShort: '배치신고',
  ownerReport: '관계인 보고서 발급',
  firePlan: '소방계획서',
  // 소방계획서_45 — ⑤⑥·별지 10·11호가 '해당없음'인 이유. 종전에는 이 문장이 작업대와 고객 문서
  // 현황에 각각 하드코딩돼('해당없음 — 불량 0건') 판정축을 넓힐 때 한쪽만 고쳐질 위험이 있었다.
  // 판정은 hasSheetDefect(inspection-step-status.ts)가, 문장은 여기가 단일 원천이다.
  naAllPass: `해당없음 — ${NA_ALL_PASS_REASON}`,
} as const

/** ── §9-9a: 문서 타임라인 단계 구성 — (점검 종류 × 불량 유무)로 결정, 088 분기 흡수 ──
 *  자체점검 여부 = plan_type 축 단독 판정(special_*·null=자체점검) — 관리유형 무관 (소방계획서_6 W-4)
 *  자체점검 = ①~⑥ 상시 표시(D-4 — 점검표 모두 합격이면 ⑤⑥ 해당없음 흐림, 소방계획서_45)
 *  정기(monthly)·레거시 일반 event = ① 하나만 + 안내 1줄 (D-6 (a)안) */
export type TimelineStepKey = 'checklist' | 'cert' | 'ownerReport' | 'submit9' | 'repair' | 'submit11'

export const TIMELINE_STEP_LABELS: Record<TimelineStepKey, string> = {
  checklist: '① 점검표',
  cert: `② ${DOC_TERMS.certFull}`,
  // ③ = 점검 결과를 관계인에게 보고하고 개선·변경을 협의하는 단계 (소방계획서_7 §4-E-1)
  ownerReport: '③ 관계인 보고·협의',
  submit9: '④ 소방서 제출 (별지 9호)',
  repair: '⑤ 보수·증빙 (별지 10호 이행)',
  submit11: '⑥ 이행완료 (별지 11호)',
}

/** 축약 라벨 풀네임·완료 조건 툴팁 (R12-d·R10-a) — hover 시 설명 */
export const TIMELINE_STEP_TOOLTIPS: Record<TimelineStepKey, string> = {
  checklist: `${DOC_TERMS.checklistStd}(자체점검) / ${DOC_TERMS.checklistExterior}(일반관리) — 별지 9호 첨부`,
  cert: `${DOC_TERMS.certFull} — 협회에 배치신고 후 완료 표시 (자체점검 대행 시 필수)`,
  ownerReport: `${DOC_TERMS.ownerReport} — 점검 후 10일 내`,
  submit9: `${DOC_TERMS.report9Full} — 점검 후 15일 내 제출`,
  repair: '⑤ 완료 = 불량 전건 조치 완료 (수리 계약서·전/후 사진은 선택 증빙)',
  submit11: `${DOC_TERMS.report11Full} — 이행기간 종료까지 제출`,
}

export function stepDocs(i: { isSpecial: boolean }): TimelineStepKey[] {
  if (!i.isSpecial) return ['checklist'] // 정기·일반 — 보고 의무 없음(작성·2년 보관만, 기한·알림 없음)
  // D-4: 불량 0건이어도 ⑤⑥을 숨기지 않는다 — 화면에서 '해당없음' 흐림 처리
  return ['checklist', 'cert', 'ownerReport', 'submit9', 'repair', 'submit11']
}

/** 생성물 파일 접두어 → 문서명 (⑩ R11 문서 단위 그룹핑 공용 — 점검 상세·타임라인·보고서 센터) */
export const GENERATED_DOC_KINDS: Record<string, { label: string; full: string }> = {
  report4: { label: '소방시설등점검표 (별지 4호)', full: `${DOC_TERMS.checklistStd} (별지 4호 — 자체점검 고시 서식, 작성 후 2년 보관)` },
  report9: { label: '실시결과 보고서 (별지 9호)', full: DOC_TERMS.report9Full },
  report10: { label: '이행계획서 (별지 10호)', full: DOC_TERMS.report10Full },
  report11: { label: '이행완료 보고서 (별지 11호)', full: DOC_TERMS.report11Full },
  exterior: { label: '외관점검표', full: `${DOC_TERMS.checklistExterior} (별지 6호 — 작성 후 2년 보관)` },
  // 소방계획서_22 S5·S7 — 결과보고서 납품 번들의 앞장 2종 (번들 순서: 공문 → 표지 → 본문, bundle TYPE_ORDER)
  official: { label: '제출 공문', full: '점검 결과보고서 제출 공문 (문서번호·수신·결재란 — 관계인 제출용 앞장)' },
  // 소방계획서_22 S8 — 관계인이 결과보고서 제출을 관리업체에 위임하는 서식 (원천: 사내 실무 서식)
  delegation: { label: '위임장', full: '점검결과 보고서 제출용 위임장 (관계인 → 관리업체 대리 제출)' },
  cover: { label: '보고서 표지', full: '점검 결과보고서 표지 (연도·건물명·건물 사진·회사 레터헤드)' },
  fire_plan: { label: '소방계획서', full: DOC_TERMS.firePlan },
}

/** 생성물 목록 **조회 순서** (2026-08-20).
 *
 *  종전 generated-doc-list는 `kind_stamp` 문자열 내림차순으로 정렬했다. 주석은 "최신 우선"이라
 *  적혀 있었지만 키가 종류로 시작하므로 실제로는 **종류 알파벳 역순**이 먼저 걸려
 *  `report9 → report4 → report11 → report10 → official → fire_plan → exterior → delegation → cover`
 *  가 됐다 — 위임장·소방계획서가 이행계획서(10호) 아래로 밀리던 원인.
 *
 *  그래서 순서를 명시한다. 축은 **인쇄 번들 순서**(bundle/route TYPE_ORDER: 공문 → 위임장 → 표지 →
 *  9호 → 4호 → 10호 → 11호 → 외관)와 같게 두고, 소방계획서만 맨 앞에 얹는다 — 점검 산출물이 아니라
 *  고객 단위 문서이고 보고서 센터의 고정 행 순서도 소방계획서가 먼저다(customer-docs).
 *  같은 종류가 여러 번 생성된 건의 '최신' 판정은 이 순서와 무관하게 생성 시각으로 한다.
 *
 *  ⚠ 인쇄 순서와 어긋나면 "화면에서 본 차례"와 "인쇄물의 차례"가 달라진다 —
 *     두 배열이 같은 축인지는 scripts/_probe-doc-order.mjs가 고정한다. */
export const GENERATED_DOC_ORDER: readonly string[] = [
  'fire_plan', 'official', 'delegation', 'cover', 'report9', 'report4', 'report10', 'report11', 'exterior',
]

/** 정렬 키 — 모르는 종류(규칙 밖 파일 포함)는 맨 뒤로 보낸다(순서를 지어내지 않는다) */
export function generatedDocRank(kind: string): number {
  const i = GENERATED_DOC_ORDER.indexOf(kind)
  return i < 0 ? GENERATED_DOC_ORDER.length : i
}

/** 단계 창구가 다루는 생성물 종류 (2026-09-10).
 *
 *  작업대는 **차수 탭이 곧 단계**인데 어느 탭에서나 생성물 7종을 통째로 늘어놓고 있었다.
 *  ④(소방서 제출)에서 표지·위임장까지 같이 보이니 목록이 그 단계와 무관해지고, 문서명이
 *  한 글자로 짜부라진 상태와 겹쳐 「필요 없는 목록」으로 읽혔다. 탭마다 자기 문서만 준다.
 *
 *  ⚠ 여기서 빠진 종류는 **어느 탭에도 안 보인다** — 추림이 만드는 새 실패 모드다.
 *    종류를 새로 만들면 반드시 한 단계 이상에 올려야 하고, 고아 0건은 _probe-doc-order가 고정한다.
 *  ⚠ fire_plan은 고객 단위 문서라 점검 폴더에 없다(lib/generated-docs 주석) — 여기 대상이 아니다. */
export const STEP_DOC_KINDS: Record<TimelineStepKey, readonly string[]> = {
  /* 🚨 2026-09-11 — ①은 **DocPane을 쓰지 않는다**(사용자 지시로 셋째 칸 「점검 인력·생성물」을
   *  없앴다). 그래서 빈 배열이다. ① 문서 두 종류의 창구는 이미 따로 있었고, 그것이 셋째 칸이
   *  중복이었던 이유다:
   *    · report4  = ④ 생성물 목록(아래 submit9)에 있고, 만들기도 ④ `report4` 칩이 한다
   *    · exterior = 월간 건 ① 첫째 칸의 `slots.exterior`가 **자체 GeneratedDocList를 들고 있다**
   *                 (inspection-report9-client.tsx — files.length > 0일 때 렌더)
   *  ⚠ 그래서 `exterior`는 이 표 어디에도 없다. 고아로 보이지만 아니다 — `_probe-doc-order`의
   *    고아 판정이 그 **예외를 소스로 확인**하므로, 저 창구를 지우면 프로브가 먼저 빨개진다. */
  checklist: [],
  cert: [],
  ownerReport: ['report9'],
  // ④는 소방서에 내는 자리 — 본문(9·10호)에 첨부(별지 4호)와 제출 앞장 3종이 함께 나간다.
  // 앞장 3종은 작업대에서 만들어지지만 **대응 단계가 따로 없다**(2026-09-10 사용자 확정: ④에 묶는다).
  submit9: ['official', 'cover', 'delegation', 'report9', 'report4', 'report10'],
  repair: [],
  submit11: ['report11'],
}

/** 빠른 입력 필수 필드 정의 (§1-1) — 별지 9호 1~2쪽 ∪ 소방계획서 준비율 어휘.
 *  일반관리 포함 전 유형 동일 18개(소방계획서_6 W-14·D-6 — 미입력 노출은 '할 일'로서 정상).
 *  경사로·계단·피난용승강기 등 컬럼 미비 항목은 P4 서식 확장에서 추가. */
export type RequiredFieldDef = { key: string; label: string; optional?: boolean }

export const QUICK_REQUIRED_FIELDS: RequiredFieldDef[] = [
  // 대상물 기본 (별지 9호 1~2쪽)
  { key: 'address', label: '주소' },
  { key: 'purpose', label: '건물 용도' },
  { key: 'useApprovalDate', label: '사용승인일' },
  { key: 'permitDate', label: '건축허가일' },
  { key: 'totalArea', label: '연면적' },
  { key: 'buildingArea', label: '건축면적' },
  { key: 'floors', label: '층수' },
  // 높이·세대수·승강기: 별지 9호 2쪽 인쇄 항목 — 건물 폼에 수기 입력칸이 생겨(소방계획서_9 B안, 2026-08-06)
  // 대장에 값이 없어도 채울 수 있으므로 필수로 환원 (2026-08-05 optional 처리 해제)
  { key: 'height', label: '높이' },
  { key: 'households', label: '세대수' },
  { key: 'buildingCount', label: '건물동수' },
  { key: 'elevator', label: '승강기' },
  { key: 'parking', label: '주차장' },
  // 소방계획서 준비율 어휘 (fire-plan-readiness 9종)
  { key: 'receiverLocation', label: '수신기위치' },
  { key: 'structure', label: '구조' },
  { key: 'roof', label: '지붕' },
  { key: 'managerSelectedAt', label: '선임일' },
  { key: 'grade', label: '급수' },
  { key: 'insurance', label: '화재보험' },
  { key: 'opHours', label: '운영시간' },
  { key: 'headcount', label: '인원' },
  { key: 'brigade', label: '자위소방대' },
  // 별지 9호 1쪽 송달 (098)
  { key: 'emailConsent', label: '송달 동의' },
]

export function requiredFields(_c: CustomerDocProfile): RequiredFieldDef[] {
  return QUICK_REQUIRED_FIELDS
}

/** 다중이용업소 업종 — 별지 9호 2쪽 선택형 (§9-6④, 상수 1곳). 서식 1.10.3 입력과 별지 9호 병합이 공유 */
export const MULTI_USE_CATEGORIES: string[] = [
  '휴게음식점영업', '제과점영업', '일반음식점영업', '단란주점영업', '유흥주점영업',
  '영화상영관', '비디오물감상실업', '비디오물소극장업', '복합영상물제공업',
  '학원', '독서실', '목욕장업', '찜질방업', '게임제공업', '복합유통게임제공업',
  '인터넷컴퓨터게임시설제공업', '노래연습장업', '산후조리업', '고시원업',
  '가상체험 체육시설업', '안마시술소', '전화방업', '화상대화방업',
  '수면방업', '콜라텍업', '권총사격장',
]

/** 빠른 입력 필수 완성도 — 값 존재 여부 맵으로 done/missing 산출 (준비율 이원화의 '필수' 게이지).
 *  optional 필드는 값이 있을 때만 분모·분자에 포함 — 비어 있어도 누락으로 표시하지 않는다 */
export function computeQuickReadiness(
  c: CustomerDocProfile,
  filled: Record<string, boolean>,
): { done: number; total: number; missing: string[] } {
  const defs = requiredFields(c).filter(d => !d.optional || filled[d.key])
  const missing = defs.filter(d => !filled[d.key]).map(d => d.label)
  return { done: defs.length - missing.length, total: defs.length, missing }
}
