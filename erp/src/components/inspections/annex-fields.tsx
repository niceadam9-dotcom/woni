'use client'

import { DateInput } from '@/components/ui/date-input'
import { isEndBeforeStart, DATE_RANGE_ERROR } from '@/lib/date-range'
import { LEGAL_ACTION_PERIODS, DEFAULT_ACTION_PERIOD_DAYS, legalActionFields, legalActionRange, extensionRequestDue } from '@/lib/action-period-legal'
import { daysBetween, todayKst } from '@/lib/kst-date'

/** 별지 ③계층(서식 고유 값) 필드 정의 — 작성 패널과 작업대가 함께 쓴다.
 *  소방계획서_21 R6-6에서 작업대가 이 값을 미리보기 위에 인라인으로 받게 되면서
 *  정의가 두 벌이 되지 않도록 여기로 뺐다. 정의를 고칠 곳은 여기 하나다. */

export type ComposeAnnexNo = 'report9' | 'report10' | 'report11' | 'exterior' | 'official' | 'delegation'

export type FieldDef = {
  key: string
  label: string
  /** mark2: 갑지 「정보」 시트의 (√실시 / 미실시) 칸과 같은 체크쌍 — 둘 다 해제하면 자동 판정
   *  actionperiod: 별지 10호 총 이행기간 전용 — 총일수 select + 시작·종료가 **한 줄**이고 서로를 채운다 */
  type: 'date' | 'daterange' | 'text' | 'textarea' | 'select' | 'mark2' | 'actionperiod'
  placeholder?: string
  hint?: string
  /** type='select'·'mark2' 전용 — 첫 항목이 기본(빈 값=자동 판정) */
  options?: Array<{ value: string; label: string }>
  /** 좁은 2열 그리드(작업대 compact)에서 **행 전체**를 쓴다 — 한 줄에 위젯 세 개가 서는 칸용 */
  fullRow?: true
  /** 그리지 않지만 **정의에는 남긴다**. 다른 위젯이 `onPatch`로 대신 쓰는 짝 값이 여기 해당한다
   *  (총 일수). 🚨 defs에서 빼면 `commit()`의 변경 감지 분모에서도 빠져 **저장이 안 된다**. */
  hidden?: true
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
    // 이 칸은 아래 총 이행기간의 **기산점**이다 — 비어 있으면 위젯이 오늘을 기산점으로 잡는다
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력 — 이 날짜가 총 이행기간의 기산점입니다' },
    // 총일수·시작·종료가 한 위젯이다 — 셋은 따로 뜻이 없다(기간과 일수가 어긋난 채 저장되던 자리).
    // 총일수를 **맨 앞에** 두는 것은 실제 업무 순서다: 수리·정비냐 철거·교체냐를 먼저 정하면 기간이 정해진다.
    { key: 'totalPeriod', label: '총 이행기간 (수동 보정)', type: 'actionperiod', fullRow: true,
      hint: '총일수(10·20일)를 고르거나 시작일을 바꾸면 종료일이 자동으로 정해집니다 — 총일수를 고르지 않고 시작일부터 적으면 기본 10일(수리·정비)로 잡고, 시작·종료일은 그 뒤에도 직접 고칠 수 있습니다(고친 종료일은 덮어쓰지 않습니다). 기산점은 소방서 보고일(제출일)이고, 시행규칙 제23조제5항의 기간은 휴일을 포함한 달력일입니다. 미입력 시 불량별 계획 시작·종료일로 자동 산출 — 문서에는 "○년 ○월 ○일" 형식으로 출력' },
    // 🚨 그리지는 않지만 정의에 남긴다 — 위 위젯이 onPatch로 함께 쓰고, defs에서 빼면 저장이 안 된다
    { key: 'totalDays', label: '총 일수 (수동 보정)', type: 'text', hidden: true },
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
export function AnnexFieldInput({ def, value, onChange, rows = 2, baseDate, onPatch, daysValue }: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
  rows?: number
  /** `actionperiod` 전용 — 짝으로 저장되는 총 일수(`totalDays`)의 현재 값.
   *  기간이 비어 있을 때 select가 무엇에 걸려 있는지 아는 유일한 단서다(구 데이터 호환). */
  daysValue?: string
  /** 법정 기간 빠른 채움의 기산일(별지 10호 제출일). 문서가 제출일을 비우면 오늘로 인쇄하므로
   *  호출부가 `fields.reportDate || todayKst()`를 넘긴다 — 화면과 인쇄물이 같은 날을 본다. */
  baseDate?: string
  /** 한 번에 두 칸(총 이행기간·총 일수)을 함께 바꾼다. 없으면 빠른 채움을 그리지 않는다 —
   *  두 칸을 따로 누르게 하면 기간과 일수가 어긋난 채 저장된다. */
  onPatch?: (patch: Record<string, string>) => void
}) {
  if (def.type === 'date') {
    return <DateInput value={value} aria-label={def.label} onChange={e => onChange(e.target.value)} className={`${inputCls} w-40 min-w-0 max-w-full`} />
  }
  /* 별지 10호 총 이행기간 — 총일수·시작·종료가 **한 위젯**이다(2026-09-09).
   *
   *  종전에는 셋이 따로 놓여 ① 좁은 칸에서 `daterange`가 flex-wrap으로 접혀 종료일이 다음 줄로
   *  내려가고 ② 총 일수는 또 다른 줄의 자유 텍스트라 기간과 어긋난 채 저장될 수 있었다.
   *
   *  🎯 사용자 요구: **어느 쪽을 먼저 건드려도 종료일이 정해질 것.** 그래서 진입로가 둘이다 —
   *    총일수를 고르거나(수리·정비 10일 / 철거·교체 20일), 시작일을 바꾸거나.
   *  ⚠ 기산점은 **소방서 보고일 = 별지 10호 제출일**이다(호출부가 baseDate로 넘긴다).
   *    「소방승인일」이 아니다 — 그 날짜는 시스템이 알지 못하고 조문에도 없다.
   *  ⚠ 셋은 **항상 함께** 나간다(onPatch). 따로 쓰면 문서에 「2026-08-05 ~ 2026-08-15 (총 20일)」
   *    같은 자기모순이 인쇄된다. */
  if (def.type === 'actionperiod') {
    const [ps = '', pe = ''] = (value ?? '').split(/\s*~\s*/)
    const bad = isEndBeforeStart(ps, pe)
    // 지금 걸린 법정 일수 — **날짜가 정답**이고 저장된 총일수는 기간이 없을 때의 폴백이다.
    // (종료일을 손으로 고쳐 10·20 어느 쪽도 아니게 되면 select가 「직접 입력」으로 스스로 떨어진다.)
    const legalDays = LEGAL_ACTION_PERIODS.map(p => p.days as number)
    const span = ps && pe && !bad ? daysBetween(ps, pe) : null
    const selected = span !== null
      ? (legalDays.includes(span) ? String(span) : '')
      : (legalDays.includes(Number(daysValue)) ? String(Number(daysValue)) : '')
    const curDays = selected ? Number(selected) : null
    // 시작일이 비어 있으면 제출일에서 시작한다 — 「제출일부터 n일 이내」가 조문 문언이다
    const anchor = ps || (baseDate ?? '')
    const canAuto = !!onPatch && !!anchor

    /** 기간과 일수를 한 번에. onPatch가 없는 호출부(구 경로)면 기간만이라도 쓴다 */
    const patchBoth = (period: string, days: string) =>
      onPatch ? onPatch({ [def.key]: period, totalDays: days }) : onChange(period)
    const join = (s: string, e2: string) => onChange(!s && !e2 ? '' : `${s} ~ ${e2}`.trim())

    const pickDays = (d: number) => {
      const next = legalActionFields(anchor, d)
      if (next) patchBoth(next.totalPeriod, next.totalDays)
    }
    const changeStart = (s: string) => {
      // 일수가 정해져 있으면 종료일이 따라온다.
      // 아직 안 정해졌는데 **종료일도 비어 있으면** 기본 10일(1호 수리·정비)로 잡는다 — 총일수를
      // 고르기 전에 시작일부터 적는 순서를 그대로 받아 준다(2026-09-11 사용자 지시).
      // 🚨 **종료일이 이미 있으면 건드리지 않는다.** 10·20 어느 쪽도 아닌 기간은 사용자가 손으로
      //    정한 것이고, 기본값으로 덮으면 되돌릴 방법이 없다(수기 수정이 가능해야 한다는 같은 지시).
      const days = curDays ?? (pe.trim() ? null : DEFAULT_ACTION_PERIOD_DAYS)
      if (days !== null) {
        const r = legalActionRange(s, days)
        if (r) { patchBoth(`${r.startISO} ~ ${r.endISO}`, String(r.days)); return }
      }
      join(s, pe)
    }
    const changeEnd = (e2: string) => {
      // 손으로 고친 종료일이 곧 새 총일수다 — 안 맞추면 문서의 「(총 N일)」이 기간과 어긋난다
      const n = ps && e2 ? daysBetween(ps, e2) : null
      if (n !== null && n >= 0) { patchBoth(`${ps} ~ ${e2}`, String(n)); return }
      join(ps, e2)
    }

    const extDue = extensionRequestDue(pe)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {/* 총일수가 **맨 앞**이다 — 업무 순서가 그렇다(수리·정비냐 철거·교체냐를 먼저 정한다).
            옵션 글자가 곧 라벨이라 앞에 「총 일수」를 또 적지 않는다(좁은 칸에서 폭이 곧 줄 수다).

            🎯 2026-09-11 사용자 지시 — **드롭다운이 아니라 라디오**다. 법정 선택지가 둘뿐이라
            (시행규칙 제23조제5항 1호·2호) 열어 봐야 아는 위젯일 이유가 없고, 종전 select는
            펼치기 전까지 다른 선택지가 있다는 것조차 보이지 않았다.
            ⚠ 값·저장 계약은 **그대로**다 — 고르면 pickDays로 기간·총일수가 짝으로 나간다.
            ⚠ 「직접 입력」은 **고르는 칸이 아니라 지금 상태를 비추는 칸**이다: 날짜가 정답이고
              저장된 총일수는 폴백이라(위 selected 계산), 종료일을 손으로 10·20 아닌 값으로
              고치면 여기로 **스스로** 떨어진다. 그래서 눌러도 아무것도 바꾸지 않는다 —
              누르는 것이 곧 '날짜를 직접 고치겠다'는 뜻이고, 그 행위는 아래 두 달력에서 한다. */}
        <span role="radiogroup" aria-label={`${def.label} 총 일수`} data-testid="legal-period-select"
          className="inline-flex shrink-0 flex-wrap items-center gap-1">
          {[{ days: 0, label: '직접 입력', basis: '시작·종료일을 직접 고치면 자동으로 여기로 옵니다' },
            ...LEGAL_ACTION_PERIODS.map(p => ({ days: p.days as number, label: `${p.days}일 ${p.label}`, basis: p.basis }))]
            .map(o => {
              const v = o.days ? String(o.days) : ''
              const on = selected === v
              // 법정 기간 둘만 실제 선택지다 — 기산일이 없으면(제출일 미정) 계산할 수 없어 잠근다
              const off = !!o.days && !canAuto
              return (
                <label key={v || 'manual'} title={off ? '제출일을 먼저 정하면 법정 기간이 계산됩니다' : o.basis}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-form-2xs transition-colors ${on
                    ? 'border-brand bg-brand-tint font-semibold text-brand'
                    : off ? 'border-line text-ink-soft opacity-50'
                    : 'border-line text-ink-sub hover:border-brand hover:bg-brand-tint'}`}>
                  <input type="radio" name={`legal-period-${def.key}`} value={v} checked={on} disabled={off}
                    data-testid={`legal-period-opt-${v || 'manual'}`}
                    onChange={() => { if (o.days) pickDays(o.days) }}
                    className="size-3 shrink-0 accent-brand" />
                  {o.label}
                </label>
              )
            })}
        </span>
        {/* 🎯 시작·종료는 **한 덩어리**다(nowrap). 원래 지적(image-22)이 이 둘이 세로로 갈라진 것이라,
            폭이 모자라면 이 묶음이 통째로 다음 줄로 내려갈 뿐 둘이 갈라지지는 않는다. */}
        {/* 🚨 폭은 **줄이지 않는다**(2026-09-10 지적 image-23: 「2026-08-」까지만 보였다).
            종전 `w-28 shrink`는 112px인데, DateInput은 안쪽에 달력 버튼 자리 `pr-7`(28px)을 떼고
            좌우 패딩(12px)까지 빼면 글자에 **72px**만 남는다 — `2026-08-18` 열 글자가 안 들어간다.
            게다가 `shrink`가 붙어 있어 칸이 좁아지면 그보다 더 줄었다.
            `daterange`(같은 파일 :226)는 처음부터 `w-36`(144 → 글자 104px)이라 멀쩡했다 —
            그 규약을 따른다. 폭이 모자라면 줄이는 대신 이 묶음이 통째로 다음 줄로 내려간다. */}
        <span className="flex shrink-0 flex-nowrap items-center gap-1">
          <DateInput value={ps} aria-label={`${def.label} 시작일`} onChange={e => changeStart(e.target.value)}
            className={`${inputBase} w-36 shrink-0 px-1.5`} />
          <span className="shrink-0 text-xs text-ink-soft">~</span>
          <DateInput value={pe} aria-label={`${def.label} 종료일`} onChange={e => changeEnd(e.target.value)}
            aria-invalid={bad} className={`${inputBase} w-36 shrink-0 px-1.5${bad ? ' !border-red-400' : ''}`} />
        </span>
        {bad && <span className="w-full text-form-2xs text-red-600" data-testid="annex-range-error">❌ {DATE_RANGE_ERROR}</span>}
        {/* 연기 신청 안내 — 기간이 없으면 **줄 자체를 안 그린다**(없는 날짜를 지어내지 않는다) */}
        {!bad && extDue && (
          <span data-testid="extension-request-due"
            className={`w-full text-form-2xs ${extDue < todayKst() ? 'text-ink-faint' : 'text-ink-soft'}`}>
            이행 기간 연기 신청은 <b className="text-ink-sub">{extDue}</b>까지 (만료일 3일 전)
          </span>
        )}
      </span>
    )
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
    // 법정 기간 빠른 채움 — 「총 이행기간」 칸에서만, 기산일과 두 칸 동시 갱신 수단이 다 있을 때만 그린다.
    // 조문이 정한 값이 10·20 둘뿐이라 자유 입력보다 버튼이 옳다(손으로 세면 하루씩 어긋난다).
    const quick = def.key === 'totalPeriod' && onPatch ? LEGAL_ACTION_PERIODS : []
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <DateInput value={ps} aria-label={`${def.label} 시작일`} onChange={e => join(e.target.value, pe)} className={`${inputBase} w-36 min-w-0 max-w-full`} />
        <span className="text-xs text-ink-soft shrink-0">~</span>
        <DateInput value={pe} aria-label={`${def.label} 종료일`} onChange={e => join(ps, e.target.value)}
          aria-invalid={bad} className={`${inputBase} w-36 min-w-0 max-w-full${bad ? ' !border-red-400' : ''}`} />
        {quick.map(p => {
          const next = legalActionFields(baseDate ?? '', p.days)
          return (
            <button key={p.kind} type="button" disabled={!next}
              data-testid={`legal-period-${p.days}`}
              title={next
                ? `${p.label} — ${p.basis} (${next.totalPeriod})`
                : '제출일을 먼저 정하면 법정 기간이 계산됩니다'}
              onClick={() => next && onPatch?.(next)}
              className={`shrink-0 rounded-lg border px-2 py-1 text-form-2xs transition-colors ${next
                ? 'border-line text-ink-sub hover:border-brand hover:bg-brand-tint hover:text-brand'
                : 'border-line text-ink-soft opacity-50'}`}>
              {p.days}일 <span className="text-form-3xs">{p.label}</span>
            </button>
          )
        })}
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
