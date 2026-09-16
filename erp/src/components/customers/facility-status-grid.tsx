'use client'

/** 서식 1.1 「시설현황」 입력 격자 — 승강기·주차장·계단 세 행 (2026-09-16)
 *
 *  ■ 왜 생겼나
 *    사용자 지적: 「현재 것은 산만합니다」. 실제로 한 축에 입력기가 세 벌 있었다 —
 *    주차장은 자유 텍스트 + 대수 4칸 + 칩 8개, 계단은 **화면 세 곳**(건물 폼·소방계획서 정보
 *    패널·1.5 탭)에 나뉘어 있었다. 화면이 서식과 다른 모양이라 「내가 켠 게 어디 찍히나」를
 *    설명할 길이 없었고, 2026-09-16 실측에서 **채움율이 0~1.6%**였다(승용·비상용 승강기는 0명).
 *
 *  ■ 무엇을 바꿨나
 *    법정 서식 1.1의 12~16행 배치를 그대로 옮긴다. 화면의 ☑ 자리가 곧 인쇄될 □ 자리다.
 *    규칙은 이 파일에 적지 않는다 — 판정은 `lib/facility-status`, 주차장 텍스트 해석은
 *    `doc-templates/report9`가 유일 원천이다(여기 다시 적으면 화면과 검사가 갈라진다).
 *
 *  ■ 상자와 숫자의 관계 — **숫자가 상자를 켠다(단방향)**
 *    승강기는 원래 그랬다(`report9.ts` elvR = 대수 존재). 계단·주차장을 그 모델로 끌어온다.
 *    상자를 직접 누르는 것은 **지름길**이다(빈 상자를 누르면 1, 켠 상자를 누르면 비운다).
 *    두 위젯이 각자 상태를 들면 어긋난 짝이 생긴다 — 그게 종전 「옥내·기계식 칩 ↔ 옥내 기계식
 *    대수칸」이 같은 뜻을 두 번 받던 결함이다.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  STAIR_KINDS, STAIR_LABEL, ELEVATOR_KINDS, ELEVATOR_LABEL,
  checkFromCount, type StairKind, type ElevatorKind,
} from '@/lib/facility-status'
/* 주차장 축은 별지 9호 모듈이 단일 원천 — 판정도 토글도 거기 것을 부른다(사본 금지). */
import {
  isParkingChipOn, toggleParkingChip, tidyParkingText, parseParkingByType,
  PK_EV_WORD, type ParkingChipFlag,
} from '@/lib/doc-templates/report9'

/** 주차장 대수 4분류 — 건축물대장 조회(fetchBuildingLedgerAction)가 합성하는 어휘와 **같은 자구**여야 한다.
 *  숫자칸은 요약 텍스트를 읽고 쓰는 창구일 뿐이다(텍스트가 원천, 별도 저장 컬럼 없음). */
export const PARKING_COUNTS = [
  { parent: 'pkIn' as const, label: '옥내 자주식', type: 'inSelf' as const },
  { parent: 'pkIn' as const, label: '옥내 기계식', type: 'inMech' as const },
  { parent: 'pkOut' as const, label: '옥외 자주식', type: 'outSelf' as const },
  { parent: 'pkOut' as const, label: '옥외 기계식', type: 'outMech' as const },
]
const parkingCountRe = (label: string) => new RegExp(label.replace(' ', '\\s*') + '\\s*(\\d+)\\s*대')

/** 주차장 토글 칩 — **한 배열**이다. 화면 위치가 둘로 나뉘어도 목록은 쪼개지 않는다
 *  (쪼개면 「화면에 있는 칩 전부」를 아무도 셀 수 없고, 축 하나가 조용히 사라져도 모른다).
 *
 *  `form11` = 서식 1.1 13행에 칸이 있는 축 · `annex9` = 별지 9호 2쪽에만 있는 하위 구분.
 *  2026-09-16 실측(값 있는 5동): 지하·지상·옥상은 **한 번도 안 쓰였고** 필로티만 1동이라
 *  `annex9` 무리는 접어 둔다 — 서식 1.1 칸과 같은 줄에 섞이면 어디 인쇄되는지 읽을 수 없다.
 *
 *  ⚠ `pkMech`(옥내 기계식)는 **여기 없다.** 그 축은 14행 「옥내 기계식」 **대수칸**이 받는다
 *    (`PARKING_COUNTS`). 종전엔 칩과 대수칸이 같은 뜻을 두 벌로 받아 어긋날 수 있었다 —
 *    산만함의 실체가 그것이었다. 대수를 모르는 채 「있다」만 적어야 하면 원문 칸을 쓴다. */
export const PARKING_CHIPS: Array<{ flag: ParkingChipFlag; word: string; label: string; group: 'form11' | 'annex9' }> = [
  { flag: 'pkIn', word: '옥내', label: '옥내', group: 'form11' },
  { flag: 'pkOut', word: '옥외', label: '옥외', group: 'form11' },
  /* 전기차충전소 — 법정 양식이 **주차장 행 안**에 둔 칸이다(서식 1.1 `AS13`).
   * ⚠ 별지 9호 2쪽엔 이 칸이 없다 — 켜도 그쪽 상자는 하나도 안 켜지는 것이 계약이다. */
  { flag: 'ev', word: PK_EV_WORD, label: '전기차충전소', group: 'form11' },
  { flag: 'pkInUg', word: '지하', label: '옥내·지하', group: 'annex9' },
  { flag: 'pkInGround', word: '지상', label: '옥내·지상', group: 'annex9' },
  { flag: 'pkInPiloti', word: '필로티', label: '옥내·필로티', group: 'annex9' },
  { flag: 'pkRoof', word: '옥상', label: '옥상', group: 'annex9' },
]
const chipOf = (flag: ParkingChipFlag) => PARKING_CHIPS.find(c => c.flag === flag)!
const ANNEX9_CHIPS = PARKING_CHIPS.filter(c => c.group === 'annex9')

export type FacilityStatusValue = {
  elevators: Record<ElevatorKind, string>
  stairs: Record<StairKind, string>
  parkingSummary: string
}

type Props = {
  value: FacilityStatusValue
  onElevator: (k: ElevatorKind, v: string) => void
  onStair: (k: StairKind, v: string) => void
  onParking: (summary: string) => void
  disabled?: boolean
  /** 입력칸 id 접두사 — `bf`(건물·시설 탭) · `fp`(소방계획서 정보 패널).
   *
   *  🚨 **두 패널은 동시에 마운트된다**(탭 셸이 전 탭을 hidden으로 들고 있다 — 2026-09-14에
   *    그 성질이 저장값을 덮어쓴 적이 있다). 같은 id를 두 곳에 찍으면 `getElementById`가
   *    엉뚱한 쪽을 집어 누락 칩 포커스가 보이지 않는 탭으로 간다. 그래서 이름공간을 나눈다. */
  idPrefix: 'bf' | 'fp'
}

const boxCls = (on: boolean, disabled: boolean) =>
  `inline-flex items-center gap-1 h-6 px-1.5 rounded border text-form-xs transition-colors ${
    disabled ? 'opacity-60 cursor-default ' : 'cursor-pointer '}${
    on ? 'border-brand text-brand font-medium bg-brand-tint' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`
const numCls = 'h-6 w-12 rounded border border-brand-line bg-surface px-1 text-form-xs text-right outline-none focus:border-brand'
const rowHead = 'text-form-xs font-medium text-ink-sub w-16 shrink-0 pt-1'

/** 상자 + 숫자칸 한 쌍 — 격자의 최소 단위.
 *
 *  ⚠ **상자는 표시 전용이다. 누를 수 없다.** 처음엔 「빈 상자를 누르면 1」로 뒀다가 물렸다 —
 *    그 1은 사용자가 말한 적 없는 수인데 별지 9호가 `(1 개소)`로, PDF가 `(1대)`로 **그대로 인쇄한다**.
 *    「있다」와 「한 개다」는 다른 주장이고, 서식에 없는 주장을 화면이 지어내면 안 된다
 *    (같은 이유로 `checkFromCount`도 숫자로 못 읽는 값을 안 켠다 — 모르면 안 켠다).
 *    그래서 **숫자칸이 유일한 입력**이고 상자는 그 결과를 비출 뿐이다.
 *
 *  `on`을 넘기면 그 값이 상자를 켠다 — 주차장 14행처럼 켜짐의 근거가 대수가 아니라
 *  **원문 낱말**인 칸이 있다(「옥내 기계식」이라고만 적혀 대수가 없을 수 있다). */
function BoxCount({ label, unit, value, onChange, disabled, id, on }: {
  label: string; unit: string; value: string
  onChange: (v: string) => void; disabled: boolean; id?: string; on?: boolean
}) {
  const lit = on ?? checkFromCount(value)
  return (
    <span className="inline-flex items-center gap-1">
      <span role="img" aria-label={`${label} ${lit ? '설치' : '미설치'}`} className={boxCls(lit, true)}>
        <span aria-hidden>{lit ? '☑' : '☐'}</span>{label}
      </span>
      <input id={id} type="number" min={0} inputMode="numeric" disabled={disabled} aria-label={`${label} ${unit}`}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, ''))} className={numCls} />
      <span className="text-form-xs text-ink-meta">{unit}</span>
    </span>
  )
}

export function FacilityStatusGrid({ value, onElevator, onStair, onParking, disabled = false, idPrefix }: Props) {
  const [showAnnex9, setShowAnnex9] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const pkText = value.parkingSummary
  const rawId = `${idPrefix}-parking`
  /* 14행 네 칸의 켜짐 — 엑셀·PDF가 쓰는 그 함수. 「옥내 기계식, 옥외 자주식」을 편별로 가른다 */
  const pkt = parseParkingByType(pkText)

  /* 🚨 접은 칸은 **DOM에 없다**. 누락 칩이 「주차장」을 찍어 보내면 `getElementById(bf-parking)`이
   *   8번 폴링하다 조용히 포기한다 — 눌러도 아무 일도 안 일어나는 결함이 된다.
   *   접기를 도입한 쪽이 그 책임을 진다: 우리 칸을 부르면 먼저 펼친다(포커스는 저쪽이 폴링으로 잡는다). */
  useEffect(() => {
    const onFocus = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; label?: string }>).detail
      if (d?.id === rawId || d?.label === '주차장') setShowRaw(true)
    }
    window.addEventListener('erp:focus-missing', onFocus)
    return () => window.removeEventListener('erp:focus-missing', onFocus)
  }, [rawId])

  /** 대수칸 — 텍스트에서 「옥내 자주식 12대」 세그먼트를 읽고(표시) 고쳐 쓴다(입력).
   *  숫자를 지우면 세그먼트째 제거하고, 분류가 텍스트에 없으면 뒤에 덧붙인다(대장 합성과 같은 형식). */
  const countOfLabel = (label: string) => (pkText.match(parkingCountRe(label))?.[1]) ?? ''
  const setCountOfLabel = (label: string, raw: string) => {
    const re = parkingCountRe(label)
    const n = raw.replace(/\D/g, '')
    if (re.test(pkText)) onParking(n ? pkText.replace(re, `${label} ${n}대`) : tidyParkingText(pkText.replace(re, '')))
    else if (n) onParking(pkText ? `${pkText}, ${label} ${n}대` : `${label} ${n}대`)
  }

  const chip = (c: { flag: ParkingChipFlag; word: string; label: string }) => {
    const on = isParkingChipOn(pkText, c.flag)
    return (
      <button key={c.word} type="button" role="checkbox" aria-checked={on} disabled={disabled}
        title={on ? `'${c.label}' 체크 끄기` : `'${c.label}' 체크 켜기`}
        onClick={() => onParking(toggleParkingChip(pkText, c.flag, c.word))} className={boxCls(on, disabled)}>
        <span aria-hidden>{on ? '☑' : '☐'}</span>{c.label}
      </button>
    )
  }

  return (
    <div data-testid="facility-status-grid" className="rounded-lg border border-brand-line divide-y divide-brand-line">
      {/* ① 승강기 12행 — L12 승용 · AB12 비상용 · AS12 피난용. 서식엔 대수 칸이 없어 상자만 인쇄된다 */}
      <div className="flex gap-2 p-2">
        <span className={rowHead}>승강기</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {ELEVATOR_KINDS.map(k => (
            <BoxCount key={k} label={ELEVATOR_LABEL[k]} unit="대" value={value.elevators[k] ?? ''}
              id={k === 'passenger' ? `${idPrefix}-elevator` : undefined}
              onChange={v => onElevator(k, v)} disabled={disabled} />
          ))}
        </div>
      </div>

      {/* ② 주차장 13·14행 — 14행 자주식·기계식은 13행 옥내/옥외의 **하위 상자**다.
          그래서 부모는 따로 누르지 않아도 자식 대수를 적으면 켜진다(텍스트에 '옥내'가 실린다). */}
      <div className="flex gap-2 p-2">
        <span className={rowHead}>주차장</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {(['pkIn', 'pkOut'] as const).map(parent => (
            <div key={parent} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {chip(chipOf(parent))}
              {PARKING_COUNTS.filter(c => c.parent === parent).map(c => (
                /* ⚠ 상자의 근거가 **대수가 아니라 원문 낱말**이다 — 「옥내 기계식」이라고만 적히고
                 *   대수가 없는 값이 실재한다. 서식 1.1 14행도 상자만 있고 대수 칸이 없으므로
                 *   판정은 엑셀·PDF와 **같은 함수**(parseParkingByType, 구간 분절)를 쓴다. */
                <BoxCount key={c.label} label={c.label.replace(/^옥[내외]\s*/, '')} unit="대"
                  on={pkt[c.type]}
                  value={countOfLabel(c.label)} onChange={v => setCountOfLabel(c.label, v)} disabled={disabled} />
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {chip(chipOf('ev'))}
            <span className="text-form-xs text-ink-meta">체크하면 [서식 1.6.3] 작성 대상 · 별지 9호엔 칸이 없다</span>
          </div>

          {/* 별지 9호 전용 — 서식 1.1에 칸이 없는 축이라 접어 둔다. 켜져 있으면 접혀 있어도 알려 준다 */}
          <div>
            <button type="button" onClick={() => setShowAnnex9(v => !v)}
              className="inline-flex items-center gap-0.5 text-form-xs text-ink-meta hover:text-brand">
              {showAnnex9 ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              별지 9호 전용 구분
              {/* 접혀 있어도 켜진 축은 말해 준다 — 안 그러면 「분명히 켰는데 사라졌다」가 된다 */}
              {!showAnnex9 && (() => {
                const on = ANNEX9_CHIPS.filter(c => isParkingChipOn(pkText, c.flag))
                return on.length ? <span className="text-brand">· {on.map(c => c.label).join(', ')}</span> : null
              })()}
            </button>
            {showAnnex9 && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {ANNEX9_CHIPS.map(chip)}
                <span className="text-form-xs text-ink-meta ml-1">별지 9호 2쪽 「옥내(지하 지상 필로티 기계식), 옥상, 옥외」에만 √로 인쇄</span>
              </div>
            )}
          </div>

          {/* 원문 — 텍스트가 여전히 **원천**이다. 대장 조회가 합성한 특이 문구는 여기서 고친다 */}
          <div>
            <button type="button" onClick={() => setShowRaw(v => !v)}
              className="inline-flex items-center gap-0.5 text-form-xs text-ink-meta hover:text-brand">
              {showRaw ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              원문 보기
              {!showRaw && pkText && <span className="text-ink-sub">· {pkText}</span>}
            </button>
            {showRaw && (
              <input id={rawId} value={pkText} onChange={e => onParking(e.target.value)} disabled={disabled}
                placeholder="예: 옥내 자주식 12대, 옥외 자주식 6대" aria-label="주차장 원문"
                className="mt-1 h-form-8 w-full rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none focus:border-brand" />
            )}
          </div>
        </div>
      </div>

      {/* ③ 계단 15·16행 — L15 특별피난 · AJ15 직통 · L16 피난 · AJ16 옥외 */}
      <div className="flex gap-2 p-2">
        <span className={rowHead}>계단</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {STAIR_KINDS.map(k => (
            <BoxCount key={k} label={STAIR_LABEL[k]} unit="개소" value={value.stairs[k] ?? ''}
              id={k === 'direct' ? `${idPrefix}-stairs` : undefined}
              onChange={v => onStair(k, v)} disabled={disabled} />
          ))}
          <p className="w-full text-form-xs text-ink-meta">
            별지 9호 2쪽 「직통(또는 피난계단)」 칸에는 <b>직통 + 피난</b> 합계가 인쇄된다 · 옥외계단은 별지 9호에 칸이 없다
          </p>
        </div>
      </div>
    </div>
  )
}
