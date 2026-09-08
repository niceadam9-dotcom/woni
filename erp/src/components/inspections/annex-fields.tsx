'use client'

import { DateInput } from '@/components/ui/date-input'
import { isEndBeforeStart, DATE_RANGE_ERROR } from '@/lib/date-range'

/** 별지 ③계층(서식 고유 값) 필드 정의 — 작성 패널과 작업대가 함께 쓴다.
 *  소방계획서_21 R6-6에서 작업대가 이 값을 미리보기 위에 인라인으로 받게 되면서
 *  정의가 두 벌이 되지 않도록 여기로 뺐다. 정의를 고칠 곳은 여기 하나다. */

export type ComposeAnnexNo = 'report9' | 'report10' | 'report11' | 'exterior' | 'official' | 'delegation'

export type FieldDef = {
  key: string
  label: string
  /** mark2: 갑지 「정보」 시트의 (√실시 / 미실시) 칸과 같은 체크쌍 — 둘 다 해제하면 자동 판정 */
  type: 'date' | 'daterange' | 'text' | 'textarea' | 'select' | 'mark2'
  placeholder?: string
  hint?: string
  /** type='select'·'mark2' 전용 — 첫 항목이 기본(빈 값=자동 판정) */
  options?: Array<{ value: string; label: string }>
}

export const ANNEX_TITLES: Record<ComposeAnnexNo, { title: string; doc: string }> = {
  report9: { title: '별지 9호 작성', doc: '자체점검 실시결과 보고서' },
  report10: { title: '별지 10호 작성', doc: '이행계획서' },
  report11: { title: '별지 11호 작성', doc: '이행완료 보고서' },
  // EX-2(소방계획서_19): 외관점검표는 ③ 계층이 아예 없어 보고일·비고를 수기 보정할 경로가 없었다
  exterior: { title: '외관점검표 작성', doc: '소방시설등 외관점검표' },
  // 소방계획서_22 S7 — 공문은 문서번호(수동+자동 제안 Q-14)·수신·참조가 ③ 계층
  official: { title: '공문 작성', doc: '점검 결과보고서 제출 공문' },
  // 소방계획서_22 S8 — 위임장은 생년월일 등 시스템 미보유 값이 ③ 계층(자동 기본값 위에 수동 우선)
  delegation: { title: '위임장 작성', doc: '점검결과 보고서 제출용 위임장' },
}

/** ③ 서식 고유 값 폼 정의 — 별지 MD §3 계층 매핑 기준 (문서 레벨 값만, 불량별 값은 불량 카드가 원본) */
export const FIELD_DEFS: Record<ComposeAnnexNo, FieldDef[]> = {
  report9: [
    { key: 'reportDate', label: '보고일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'note', label: '비고·보완 문구', type: 'textarea', hint: '1쪽 하단(유의사항 위)에 1줄 출력 — 없으면 미출력' },
    // ⚠ 2쪽 3행(소방계획서·자체점검(전년도)·교육훈련(전년도))의 6칸은 **여기 없다** —
    //   소방계획서_44로 소방계획서 서식 1.10 「전년도 업무 실시사항」으로 이관했다.
    //   이 6칸은 별지 9호 고유값이 아니라 (고객, 연도) 사실이었다: 점검 건 단위로 저장하니
    //   값에 연도가 없어 전 회차 이어받기(annex-compose-panel:98-111)가 작년 실적을 올해 칸에
    //   실을 수 있었다. 확정 자리가 하나뿐이어야 하므로 **여기에 되살리지 말 것**.
    //   레거시 annex_inputs 값은 조립기가 폴백으로만 읽는다(lib/prev-year-duty.ts).
  ],
  report10: [
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'totalPeriod', label: '총 이행기간 (수동 보정)', type: 'daterange', hint: '[10일]·[20일]을 누르면 제출일 기준 법정 기간이 채워집니다(시행규칙 제23조제5항 — 휴일 포함 달력일). 미입력 시 불량별 계획 시작·종료일로 자동 산출 — 문서에는 "○년 ○월 ○일" 형식으로 출력' },
    { key: 'totalDays', label: '총 일수 (수동 보정)', type: 'text', placeholder: '예: 20', hint: '수리·정비 10일 / 철거·교체 20일 — 위 [10일]·[20일] 버튼이 이 칸도 함께 채웁니다' },
    { key: 'summary', label: '계획 내용 요약', type: 'textarea', hint: '이행조치 사항 표의 첫 행으로 출력' },
    { key: 'contractor', label: '공사업체 메모', type: 'text', hint: '내부 메모 — 문서에는 출력되지 않습니다' },
    { key: 'budget', label: '예산 메모', type: 'text', hint: '내부 메모 — 문서에는 출력되지 않습니다' },
  ],
  report11: [
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'note', label: '완료 보고 문구', type: 'textarea', hint: '서명 블록 위에 1줄 출력 — 없으면 미출력' },
    { key: 'evidence', label: '증빙 목록 메모', type: 'textarea', hint: '내부 메모 — 전/후 사진·계약서 첨부는 제출 패키지에 자동 포함' },
  ],
  exterior: [
    { key: 'reportDate', label: '점검일(보고일)', type: 'date', hint: '미입력 시 점검 시작일로 출력' },
    { key: 'note', label: '비고', type: 'textarea', hint: '표 아래 비고란에 출력 — 없으면 미출력' },
  ],
  official: [
    { key: 'docNo', label: '문서번호', type: 'text', placeholder: '예: 승 진 2511-977',
      hint: '비워 두면 "{회사 약칭} {YYMM}-{동월 마지막 번호+1}"로 자동 제안됩니다 (Q-14)' },
    { key: 'sendDate', label: '발신일자 표기', type: 'text', placeholder: '예: 2025년 11월', hint: '미입력 시 점검 종료월로 출력' },
    { key: 'recipient', label: '수신', type: 'text', hint: '미입력 시 고객명(건물명)으로 출력' },
    { key: 'reference', label: '참조', type: 'text', placeholder: '소방안전관리자 및 관계인', hint: '미입력 시 기본 문구로 출력' },
  ],
  delegation: [
    // 146 — 8칸 전부 자동 기본값이 생겼다(관계인=고객 상세 관계인 카드, 대리인=관리자 > 직원 관리).
    // 여기 입력은 그 위에 얹는 **이 점검 건 한정** 덮어쓰기다. 상시 값은 원천에서 고쳐야 다음 회차에도 산다.
    { key: 'ownerName', label: '관계인 성명', type: 'text', hint: '미입력 시 서식 1.7 선임 소방안전관리자(폴백: 대표)로 출력' },
    { key: 'ownerPosition', label: '관계인 직위', type: 'text', placeholder: '예: 소방안전관리자',
      hint: '미입력 시 관계인에 저장된 직위 → 없으면 선임 여부로 추정(소방안전관리자/대표)' },
    { key: 'ownerPhone', label: '관계인 연락처', type: 'text', hint: '선임자와 대표가 다르면 자동으로 채우지 않습니다 — 직접 입력' },
    { key: 'ownerBirth', label: '관계인 생년월일', type: 'text', placeholder: '예: 1972.12.27',
      hint: '미입력 시 고객 상세 > 관계인의 생년월일로 출력' },
    { key: 'agentName', label: '대리인 성명', type: 'text', hint: '미입력 시 주된 점검인력(폴백: 담당 직원)으로 출력' },
    { key: 'agentPosition', label: '대리인 직위', type: 'text', placeholder: '예: 과장',
      hint: '미입력 시 관리자 > 직원 관리의 [직책]으로 출력' },
    { key: 'agentPhone', label: '대리인 연락처', type: 'text', hint: '미입력 시 직원 관리의 [연락처]로 출력' },
    { key: 'agentBirth', label: '대리인 생년월일', type: 'text', placeholder: '예: 1987.10.13',
      hint: '미입력 시 직원 관리의 [생년월일]로 출력' },
    { key: 'submitDate', label: '위임 일자 표기', type: 'text', placeholder: '예: 2026년 7월 16일',
      hint: '미입력 시 별지 9호 보고일과 같은 날짜로 출력 (보고일도 미지정이면 오늘)' },
    { key: 'station', label: '관할 소방서', type: 'text', placeholder: '예: 양평', hint: '미입력 시 고객 정보의 관할 소방서에서 "소방서"를 뗀 이름으로 출력' },
  ],
}

const inputBase = 'text-xs border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-brand'
const inputCls = `w-full ${inputBase}`

/** ③ 값 입력 위젯 — 라벨은 호출부가 그린다(패널은 세로 폼, 작업대는 압축 행) */
export function AnnexFieldInput({ def, value, onChange, rows = 2 }: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  if (def.type === 'date') {
    return <DateInput value={value} aria-label={def.label} onChange={e => onChange(e.target.value)} className={`${inputCls} w-40 min-w-0 max-w-full`} />
  }
  if (def.type === 'daterange') {
    // 가입기간(1.1 일반현황)과 동일 패턴 — "YYYY-MM-DD ~ YYYY-MM-DD"로 저장, 문서 출력 시 한국어 날짜로 변환(report9-actions)
    const [ps = '', pe = ''] = (value ?? '').split(/\s*~\s*/)
    const join = (s: string, e2: string) => onChange(!s && !e2 ? '' : `${s} ~ ${e2}`.trim())
    // 좁은 칸에서는 **접힌다**(flex-wrap + min-w-0). 종전엔 w-36 두 칸이 고정이라 최소 312px를 요구해
    // 작업대 3칸 폭 재배분의 병목이었다(실측 2026-08-18: 1:0.9:1.8에서 이 한 줄이 +38px 넘침).
    // 접히면 세로로 한 줄 늘 뿐이고, 그 칸은 세로 여유가 있다.
    // 뒤집힌 기간은 서버(saveAnnexInputsAction)가 거절한다 — 여기서는 그 전에 눈에 보이게 한다
    const bad = isEndBeforeStart(ps, pe)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <DateInput value={ps} aria-label={`${def.label} 시작일`} onChange={e => join(e.target.value, pe)} className={`${inputBase} w-36 min-w-0 max-w-full`} />
        <span className="text-xs text-ink-soft shrink-0">~</span>
        <DateInput value={pe} aria-label={`${def.label} 종료일`} onChange={e => join(ps, e.target.value)}
          aria-invalid={bad} className={`${inputBase} w-36 min-w-0 max-w-full${bad ? ' !border-red-400' : ''}`} />
        {bad && <span className="w-full text-form-2xs text-red-600" data-testid="annex-range-error">❌ {DATE_RANGE_ERROR}</span>}
      </span>
    )
  }
  if (def.type === 'mark2') {
    // 갑지 「정보」 시트의 「(√실시 / 미실시)」 칸과 같은 모양 — 체크 하나가 하나의 확정값이고,
    // 켜진 것을 다시 누르면 해제되어 자동 판정('')으로 돌아간다(select 시절의 3상태 유지).
    const marks = (def.options ?? []).filter(o => o.value)
    const autoLabel = (def.options ?? []).find(o => !o.value)?.label ?? '자동 판정'
    return (
      <span role="group" aria-label={def.label} className="inline-flex flex-wrap items-center gap-1.5">
        {marks.map(o => {
          const on = value === o.value
          return (
            <button key={o.value} type="button" aria-pressed={on}
              onClick={() => onChange(on ? '' : o.value)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors ${on
                ? 'border-brand bg-brand-tint font-semibold text-brand'
                : 'border-line text-ink-sub hover:bg-brand-tint'}`}>
              <span className="font-mono text-form-xs">{on ? '[√]' : '[  ]'}</span>{o.value}
            </button>
          )
        })}
        <span className="text-form-2xs text-ink-soft whitespace-nowrap">{value ? '수동 확정' : autoLabel}</span>
      </span>
    )
  }
  if (def.type === 'select') {
    // w-64는 **희망 폭**이다 — 좁은 칸(작업대 ④ 고유값 2열)에서는 칸만큼 줄어야 한다.
    // max-w-full이 없으면 256px 고정이라 셀 밖으로 삐져나온다(daterange와 같은 규약).
    return (
      <select value={value} aria-label={def.label} onChange={e => onChange(e.target.value)}
        className={`${inputBase} w-64 min-w-0 max-w-full bg-surface`}>
        {(def.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }
  if (def.type === 'textarea') {
    return (
      <textarea value={value} aria-label={def.label} rows={rows} placeholder={def.placeholder}
        onChange={e => onChange(e.target.value)} className={`${inputCls} resize-y`} />
    )
  }
  return (
    <input type="text" value={value} aria-label={def.label} placeholder={def.placeholder}
      onChange={e => onChange(e.target.value)} className={inputCls} />
  )
}
