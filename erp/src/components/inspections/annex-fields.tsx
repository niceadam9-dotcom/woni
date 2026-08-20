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
  type: 'date' | 'daterange' | 'text' | 'textarea' | 'select'
  placeholder?: string
  hint?: string
  /** type='select' 전용 — 첫 항목이 기본(빈 값=자동 판정) */
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
    // B-2c(소방계획서_19 K-2, Q-1 확정): 교육훈련 '실시' 수동 보정 — 자동 판정(1.11.4 전년도 실적)이
    // 못 보는 경우(종이로만 실시) 구제.
    // A(2026-08-20): '미실시'도 고를 수 있다. 부정 칸(미실시·미작성·미보관)이 종전엔 ck(false)
    // 하드코딩이라 실제로 미실시인 대상물조차 √를 못 찍고 양쪽 공란으로 나갔다. **자동 판정은
    // 여전히 부정을 단정하지 않는다** — 사람이 여기서 고를 때만 부정 칸에 √가 찍힌다(A9-6 유지).
    { key: 'eduDone', label: '소방안전교육 (전년도)', type: 'select',
      options: [
        { value: '', label: '자동 판정 (1.11.4 전년도 실적)' },
        { value: '실시', label: '실시로 기재 (수동 확정)' },
        { value: '미실시', label: '미실시로 기재 (수동 확정)' },
      ],
      hint: '2쪽 교육훈련 칸 — 자동 판정은 실시만 찍는다. 미실시 √는 여기서 확정해야 나간다' },
    { key: 'drillDone', label: '소방훈련 (전년도)', type: 'select',
      options: [
        { value: '', label: '자동 판정 (1.11.4 전년도 실적)' },
        { value: '실시', label: '실시로 기재 (수동 확정)' },
        { value: '미실시', label: '미실시로 기재 (수동 확정)' },
      ],
      hint: '2쪽 교육훈련 칸 — 자동 판정은 실시만 찍는다. 미실시 √는 여기서 확정해야 나간다' },
    { key: 'prevOpDone', label: '자체점검(전년도) 작동점검', type: 'select',
      options: [
        { value: '', label: '자동 판정 (전년도 완료 점검 이력)' },
        { value: '실시', label: '실시로 기재 (수동 확정)' },
        { value: '미실시', label: '미실시로 기재 (수동 확정)' },
      ],
      hint: '2쪽 자체점검 칸 — ERP 도입 전 이력(종이·타사)은 자동 판정에 안 잡힌다' },
    { key: 'prevCompDone', label: '자체점검(전년도) 종합점검', type: 'select',
      options: [
        { value: '', label: '자동 판정 (전년도 완료 점검 이력)' },
        { value: '실시', label: '실시로 기재 (수동 확정)' },
        { value: '미실시', label: '미실시로 기재 (수동 확정)' },
      ],
      hint: '2쪽 자체점검 칸 — ERP 도입 전 이력(종이·타사)은 자동 판정에 안 잡힌다' },
    { key: 'firePlanWritten', label: '소방계획서 작성 여부', type: 'select',
      options: [
        { value: '', label: '자동 판정 (소방계획서 보관함 등록분)' },
        { value: '작성', label: '작성으로 기재 (수동 확정)' },
        { value: '미작성', label: '미작성으로 기재 (수동 확정)' },
      ],
      hint: '2쪽 소방계획서 칸 — 미작성을 고르면 보관 칸은 자동으로 비워진다' },
    { key: 'firePlanStored', label: '소방계획서 보관 여부', type: 'select',
      options: [
        { value: '', label: '자동 판정 (작성 여부를 따름)' },
        { value: '보관', label: '보관으로 기재 (수동 확정)' },
        { value: '미보관', label: '미보관으로 기재 (수동 확정)' },
      ],
      hint: '2쪽 소방계획서 칸 — 작성했으나 현장에 비치되지 않은 경우 미보관' },
  ],
  report10: [
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'totalPeriod', label: '총 이행기간 (수동 보정)', type: 'daterange', hint: '미입력 시 불량별 계획 시작·종료일로 자동 산출 — 문서에는 "○년 ○월 ○일" 형식으로 출력' },
    { key: 'totalDays', label: '총 일수 (수동 보정)', type: 'text', placeholder: '예: 20' },
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
    { key: 'ownerName', label: '관계인 성명', type: 'text', hint: '미입력 시 서식 1.7 선임 소방안전관리자(폴백: 대표)로 출력' },
    { key: 'ownerPosition', label: '관계인 직위', type: 'text', placeholder: '예: 소방안전관리자' },
    { key: 'ownerPhone', label: '관계인 연락처', type: 'text', hint: '선임자와 대표가 다르면 자동으로 채우지 않습니다 — 직접 입력' },
    { key: 'ownerBirth', label: '관계인 생년월일', type: 'text', placeholder: '예: 1972.12.27', hint: '시스템 미보유 값 — 미입력 시 공란 인쇄' },
    { key: 'agentName', label: '대리인 성명', type: 'text', hint: '미입력 시 주된 점검인력(폴백: 담당 직원)으로 출력' },
    { key: 'agentPosition', label: '대리인 직위', type: 'text', placeholder: '예: 과장' },
    { key: 'agentPhone', label: '대리인 연락처', type: 'text' },
    { key: 'agentBirth', label: '대리인 생년월일', type: 'text', placeholder: '예: 1987.10.13', hint: '시스템 미보유 값 — 미입력 시 공란 인쇄' },
    { key: 'submitDate', label: '위임 일자 표기', type: 'text', placeholder: '예: 2026년 7월 16일', hint: '미입력 시 점검 종료일로 출력' },
    { key: 'station', label: '관할 소방서', type: 'text', placeholder: '예: 양평', hint: '미입력 시 고객 정보의 관할 소방서에서 "소방서"를 뗀 이름으로 출력' },
  ],
}

const inputBase = 'text-xs border border-[#c8c4d0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#7b68ee]'
const inputCls = `w-full ${inputBase}`

/** ③ 값 입력 위젯 — 라벨은 호출부가 그린다(패널은 세로 폼, 작업대는 압축 행) */
export function AnnexFieldInput({ def, value, onChange, rows = 2 }: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  if (def.type === 'date') {
    return <DateInput value={value} aria-label={def.label} onChange={e => onChange(e.target.value)} className={`${inputCls} w-40`} />
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
        <span className="text-xs text-[#847ba8] shrink-0">~</span>
        <DateInput value={pe} aria-label={`${def.label} 종료일`} onChange={e => join(ps, e.target.value)}
          aria-invalid={bad} className={`${inputBase} w-36 min-w-0 max-w-full${bad ? ' !border-red-400' : ''}`} />
        {bad && <span className="w-full text-[10px] text-red-600" data-testid="annex-range-error">❌ {DATE_RANGE_ERROR}</span>}
      </span>
    )
  }
  if (def.type === 'select') {
    return (
      <select value={value} aria-label={def.label} onChange={e => onChange(e.target.value)} className={`${inputBase} w-64 bg-white`}>
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
