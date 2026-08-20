import { GENERATED_DOC_KINDS } from '@/lib/doc-requirements'

/** 자체점검 별지 산출물의 **내려받기 저장명** — 전 화면 단일 출처.
 *
 *  Storage 실제 파일명은 `{kind}_{timestamp}.{ext}` 규약이고 그건 바뀌지 않는다(최신본 선별·번들
 *  순서가 전부 그 규약에 의존한다). 여기서 만드는 건 사용자가 받을 때 붙는 이름뿐이다.
 *
 *  별지 4·9호는 관계인에게 그대로 넘어가는 제출 문서라 별도 규약을 쓴다:
 *    4호  {연도}_소방시설_{작동|종합}점검 결과보고서_{고객명}
 *    9호  {연도}_소방시설등 자체점검_실시결과보고서_{고객명}   (작동·종합 동일)
 *  나머지(10·11호·외관·표지·공문·위임장)는 종전 규약 `{고객명}_{문서명}_{YYYY-MM-DD}`를 유지한다.
 *
 *  ⚠ 연도·날짜 축은 **문서 생성일**이지 점검 연도가 아니다 — 해를 넘겨 재생성하면 그 해가 붙는다.
 *  ⚠ 4·9호에는 날짜 접미어가 없다(사용자 확정) — 같은 문서를 두 번 받으면 브라우저가 `(1)`을 붙인다. */

/** 저장명이 붙은 별지 산출물 URL — Storage 전체 경로를 줘도 되고 파일명만 줘도 된다.
 *  이름은 라우트가 정하므로 화면은 이 URL만 열면 된다(PDF=새 탭 열람, HWP=내려받기). */
export function annexDocUrl(inspectionId: string, pathOrName: string): string {
  const name = pathOrName.split('/').pop() ?? pathOrName
  return `/inspections/${inspectionId}/doc?file=${encodeURIComponent(name)}`
}

/* ── 아래 둘은 브라우저 전용 — 전 화면이 같은 동작을 쓰도록 여기 한 쌍만 둔다 ── */

/** HWP = 편집용 원본 내려받기. attachment 응답이라 현재 탭은 그대로 있고 내려받기만 시작된다
 *  (새 탭으로 열면 곧바로 닫히는 빈 탭이 남는다). */
export const openAnnexHwp = (inspectionId: string, pathOrName: string) =>
  window.location.assign(annexDocUrl(inspectionId, pathOrName))

/** PDF = 새 탭 열람·인쇄. inline 응답이라 표시되고, 거기서 저장하면 규약 이름이 붙는다. */
export const openAnnexPdf = (inspectionId: string, pathOrName: string) =>
  window.open(annexDocUrl(inspectionId, pathOrName), '_blank')

/** 파일명에 못 쓰는 문자만 치환 — 공백은 규약상 이름 안에 들어가므로 남긴다 */
const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim()

/** KST 기준 오늘 (createdAt이 비어 있을 때의 폴백) */
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

/** 작동/종합 축 — inspectionNatureBadge와 **같은 우선순위**로 판정한다(plan_type sub_type 우선).
 *  같은 축을 두 곳에서 다르게 풀면 배지는 '종합(자체)'인데 파일명은 '작동점검'이 되는 어긋남이 난다.
 *  별지 4호는 자체점검 건(plan_type null·special_*)에만 생성되므로 sub_type이 없는 건 레거시뿐이고,
 *  그때는 작동점검으로 본다(일반관리 자체점검의 실무 기본값). */
export function annexSubType(inspectionType: string | null | undefined, planType: string | null | undefined): '작동' | '종합' {
  const sub = planType?.startsWith('special_') ? planType.slice('special_'.length) : null
  if (sub === '종합' || sub === '작동') return sub
  if (inspectionType === '종합' || inspectionType === '작동') return inspectionType
  return '작동'
}

export type AnnexNameInput = {
  /** 파일명 접두어 — report4 | report9 | report10 | report11 | exterior | cover | official | delegation */
  kind: string
  /** 확장자 (점 없이) */
  ext: string
  customerName: string
  /** customers·inspections의 inspection_type (작동/종합/일반관리) */
  inspectionType?: string | null
  /** inspections.plan_type (special_작동 / special_종합 / null) */
  planType?: string | null
  /** 문서 생성 시각 ISO — 연도·날짜 축 */
  createdAt?: string | null
}

/** 확장자 포함 최종 저장명 */
export function annexDownloadName(i: AnnexNameInput): string {
  const cust = sanitize(i.customerName || '고객')
  const date = (i.createdAt ?? '').slice(0, 10) || todayKst()
  const year = date.slice(0, 4)
  const ext = i.ext.replace(/^\./, '').toLowerCase()

  if (i.kind === 'report4') {
    const sub = annexSubType(i.inspectionType, i.planType)
    return sanitize(`${year}_소방시설_${sub}점검 결과보고서_${cust}`) + `.${ext}`
  }
  if (i.kind === 'report9') {
    return sanitize(`${year}_소방시설등 자체점검_실시결과보고서_${cust}`) + `.${ext}`
  }
  // 종전 규약 — 문서명은 라벨에서 괄호 서식번호를 뗀 것 (예: '이행계획서 (별지 10호)' → '이행계획서')
  const label = (GENERATED_DOC_KINDS[i.kind]?.label ?? i.kind).replace(/\s*\(.*\)$/, '')
  return sanitize(`${cust}_${label}_${date}`) + `.${ext}`
}
