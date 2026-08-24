'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Building2, Shield, Clock, Flame, UserPlus, RefreshCw, Sparkles, Mail, ShieldCheck, ExternalLink } from 'lucide-react'
import { saveFirePlanInfoAction, refreshLedgerAction, type FirePlanInfoInput, type BrigadeMemberInput } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { isEndBeforeStart, DATE_RANGE_ERROR } from '@/lib/date-range'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { computeFirePlanReadiness, READINESS_TARGET_IDS } from '@/lib/fire-plan-readiness'
import { suggestGrade, suggestOpHours, RECEIVER_LOCATION_PRESETS } from '@/lib/fire-plan-suggest'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import { CardAnchorBar, NumField, PhoneField } from '@/components/ui/fields'
import { formatTel } from '@/lib/format-contact'
import { usePlanSaveHandler } from '@/components/ui/unsaved-nav'

/** 소방계획서 정보 패널 (5+6차) — 준비율 게이지 + 항상 편집 폼(①시설 ②운영 ③화재보험) + 가져오기 (설계 §4·§5,
 *  소방계획서_10 §3-4: 요약/편집 모드·아코디언 폐기, 열자마자 편집 폼 노출) */

const GRADES = ['특급', '1급', '2급', '3급']
const STRUCTURES = ['철근콘크리트', '철골', '조적', '목구조', '샌드위치판넬']
const ROOFS = ['슬래브', '기와', '판넬', '징크']
const OP_HOURS = ['24시간', '09~18시', '주간만', '미운영']
const TEAMS = ['자위소방대장', '부대장', '비상연락', '초기소화', '피난유도', '응급구조']
const TEAM_DUTY: Record<string, string> = {
  '자위소방대장': '관리구역 상황통제', '부대장': '대장 부재시 수행', '비상연락': '119신고 및 상황전파',
  '초기소화': '소화기 이용 초기소화', '피난유도': '피난층 또는 옥상으로 피난유도', '응급구조': '응급환자 구조 및 심폐소생',
}

const inputCls = 'h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]'
const labelCls = 'text-[11px] font-medium text-[#514b81]'

export type FirePlanInfoInitial = FirePlanInfoInput & {
  height: string
  hasBuilding: boolean
  // §6-D-1 추천값 판정용 (건물·시설 데이터)
  purpose: string | null
  totalArea: number | null
  floorsAbove: number | null
  floorsBelow: number | null
  facilityCodes: string[]
}

export function FirePlanInfoPanel({ customerId, initial, people }: {
  customerId: string
  initial: FirePlanInfoInitial
  people: Array<{ name: string; phone: string; kind: string }>  // 관계인 + 직원 (가져오기 후보)
}) {
  const router = useRouter()
  const openPostcode = useDaumPostcode()
  const tabs = useCustomerTabs()   // 탭 셸 안에서만 non-null (§6-C-4·5)
  const [d, setD] = useState<FirePlanInfoInput>(initial)
  const [isPending, startTransition] = useTransition()
  const [isLedgerPending, startLedgerTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  // §6-D-1: 추천값으로 채워진 필드 → 앰버 하이라이트 + 근거 툴팁 (저장 시 해제)
  const [suggested, setSuggested] = useState<Record<string, string>>({})

  // 미저장 여부는 탭 셸(setTabDirty)과 이동 확인창 양쪽이 쓴다 — 로컬 상태로도 들고 있어야 [저장하고 이동] 등록 조건이 된다
  const [dirty, setDirty] = useState(false)
  const markDirty = () => { setDirty(true); tabs?.setTabDirty('plan', true) }
  const set = <K extends keyof FirePlanInfoInput>(k: K, v: FirePlanInfoInput[K]) => { markDirty(); setD(p => ({ ...p, [k]: v })) }
  const setBrigade = (i: number, k: keyof BrigadeMemberInput, v: string) => {
    markDirty()
    setD(p => { const rows = [...p.brigade]; rows[i] = { ...rows[i], [k]: v, ...(k === 'team' && !rows[i].duty ? { duty: TEAM_DUTY[v] ?? '' } : {}) }; return { ...p, brigade: rows } })
  }

  // 가입기간 — 저장은 기존 "YYYY-MM-DD ~ YYYY-MM-DD" 문자열 그대로(별지 9호·소방계획서 출력 호환), 입력만 시작·종료 달력 2개로 분해
  const [insStart = '', insEnd = ''] = d.insurancePeriod.split(/\s*~\s*/)
  const setInsPeriod = (start: string, end: string) => {
    // 시작일이 완성되고 종료일이 비어 있으면 1년 뒤로 자동 채움 (화재보험 통상 1년 단위 — 수정 가능)
    if (start && !end && isCompleteDate(start)) {
      const [y, m, dd] = start.split('-').map(Number)
      const plus1y = new Date(y + 1, m - 1, dd)   // 윤년 2/29는 Date가 3/1로 보정
      end = `${plus1y.getFullYear()}-${String(plus1y.getMonth() + 1).padStart(2, '0')}-${String(plus1y.getDate()).padStart(2, '0')}`
    }
    set('insurancePeriod', !start && !end ? '' : `${start} ~ ${end}`.trim())
  }

  // 준비율 — 설계 §5: 입력 여부 체크 (생성 페이지·워커와 같은 어휘, fire-plan-readiness.ts)
  // missing 목록은 상단 생성 바가 단독 담당(2026-08-06 중복 제거) — 여기선 게이지 수치만 사용
  const { done, total } = computeFirePlanReadiness({
    receiverLocation: d.receiverLocation, structure: d.structure, roof: d.roof,
    managerSelectedAt: d.managerSelectedAt, grade: d.grade, insuranceJoined: d.insuranceJoined,
    opHoursWeekday: d.opHoursWeekday,
    hasHeadcount: !!(d.headcountWorker || d.headcountResident || d.headcountMax),
    managerAppointType: d.managerAppointType,
    hasBrigade: d.brigade.some(m => m.name.trim()),
  })

  // 상단 생성 바 누락 칩 → 이 패널의 필드로 스크롤·포커스 (erp:focus-missing 수신).
  // 앰버 펄스 필수 — 화재보험·자위소방대처럼 패널 끝에 있는 칸은 이미 스크롤 끝이라 scrollIntoView가
  // 움직이지 않아 "클릭해도 반응 없음"으로 보였다 (2026-08-06). plan-tab-view focusField와 동일한 피드백.
  function focusMissing(label: string) {
    setTimeout(() => {
      const el = document.getElementById(READINESS_TARGET_IDS[label] ?? '')
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const target = el.matches('input,select,textarea,button') ? el : el.querySelector('input,select,textarea,button')
      ;(target as HTMLElement | null)?.focus({ preventScroll: true })
      el.classList.add('ring-2', 'ring-amber-400', 'rounded-lg')
      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'rounded-lg'), 2500)
    }, 80)
  }

  // §11-5: 상단 누락 칩(plan-tab-view) → 이 패널의 필드 포커스 — 커스텀 이벤트 수신
  useEffect(() => {
    const onFocusReq = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label
      if (label && READINESS_TARGET_IDS[label]) focusMissing(label)
    }
    window.addEventListener('erp:focus-missing', onFocusReq)
    return () => window.removeEventListener('erp:focus-missing', onFocusReq)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // [건축물대장에서 다시 가져오기] — §5-A-3: 저장된 bcode(092)로 원클릭, 없으면 주소창 1회 확인 후 백필
  function applyLedgerResult(res: Awaited<ReturnType<typeof refreshLedgerAction>>) {
    if (res.error) { setMsg(`❌ ${res.error}`); return }
    setD(prev => ({
      ...prev,
      structure: res.structure ?? prev.structure,
      roof: res.roof ?? prev.roof,
    }))
    const got = [res.structure && `구조 ${res.structure}`, res.roof && `지붕 ${res.roof}`,
      res.height && `높이 ${res.height}m`].filter(Boolean).join(' · ')
    setMsg(`✅ 건축물대장 갱신 완료${got ? ` — ${got}` : ' (대장에 구조·지붕·높이 값 없음)'}`)
    router.refresh()
  }

  function refetchLedger() {
    setMsg('')
    startLedgerTransition(async () => {
      const res = await refreshLedgerAction(customerId)
      if (res.needAddress) {
        // 저장된 bcode 없음(092 적용 전 등록 건물 등) — 주소창 1회 확인, 이후 백필되어 다음부터 원클릭
        openPostcode(data => {
          if (!data.bcode) { setMsg('❌ 선택한 주소에 법정동코드가 없습니다.'); return }
          startLedgerTransition(async () => {
            applyLedgerResult(await refreshLedgerAction(customerId, data.bcode!, data.jibunAddress))
          })
        })
        return
      }
      applyLedgerResult(res)
    })
  }

  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    setMsg('')
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanInfoAction(customerId, d)
        setMsg(res.error ? `❌ ${res.error}` : '✅ 저장되었습니다')
        if (res.error) { resolve(false); return }
        setDirty(false)
        tabs?.setTabDirty('plan', false)
        setSuggested({})
        router.refresh()
        resolve(true)
      })
    })
  }
  // 이동 확인창(서식 트리·탭 전환)의 [저장하고 이동]
  usePlanSaveHandler(save, dirty)

  // §6-D-1: [추천값 채우기] — 빈 칸만, 앰버 하이라이트 + 근거, 확정은 사용자(저장 전 검토)
  function applySuggestions() {
    const g = !d.grade ? suggestGrade({
      purpose: initial.purpose, totalArea: initial.totalArea,
      floorsAbove: initial.floorsAbove, floorsBelow: initial.floorsBelow,
      height: parseFloat(initial.height) || null, facilityCodes: initial.facilityCodes,
    }) : null
    const oh = !d.opHoursWeekday ? suggestOpHours(initial.purpose) : null
    if (!g && !oh) {
      setMsg('💡 추천할 빈 항목이 없습니다 — 구조·지붕·높이는 [건축물대장에서 다시 가져오기]를 사용하세요.')
      return
    }
    markDirty()
    setD(prev => ({
      ...prev,
      ...(g ? { grade: g.grade } : {}),
      ...(oh ? { opHoursWeekday: prev.opHoursWeekday || oh.weekday, opHoursHoliday: prev.opHoursHoliday || oh.holiday } : {}),
    }))
    const nextSug: Record<string, string> = {}
    const filled: string[] = []
    if (g) { nextSug.grade = g.reason; filled.push(`급수 ${g.grade}`) }
    if (oh) { nextSug.opHoursWeekday = oh.reason; nextSug.opHoursHoliday = oh.reason; filled.push(`운영시간 ${oh.weekday}`) }
    setSuggested(prev => ({ ...prev, ...nextSug }))
    setMsg(`💡 추천값 적용(빈 칸만): ${filled.join(' · ')} — 표시된 항목을 확인 후 저장하세요`)
  }

  // §6-D-3: 자위소방대 [자동 편성] — 관계인·직원을 대장→부대장→… 순 일괄 배정
  function autoAssignBrigade() {
    if (people.length === 0) { setMsg('❌ 편성할 관계인·직원이 없습니다.'); return }
    if (d.brigade.some(m => m.name.trim()) &&
        !window.confirm('기존 편성을 자동 편성으로 대체할까요?')) return
    markDirty()
    const rows = people.slice(0, TEAMS.length).map((p, i) => ({
      team: TEAMS[i], name: p.name, duty: TEAM_DUTY[TEAMS[i]] ?? '', phone: p.phone,
    }))
    setD(prev => ({ ...prev, brigade: rows }))
    setMsg(`✅ ${rows.length}명 자동 편성 (관계인 → 직원 순) — 확인 후 저장하세요`)
  }

  // 추천값 하이라이트 (앰버) — title에 근거 표시
  const sgCls = (k: string) => (suggested[k] ? ' !border-amber-400 !bg-amber-50' : '')
  const sgTitle = (k: string) => suggested[k]

  function addFromPerson(p: { name: string; phone: string }) {
    markDirty()
    setD(prev => {
      const team = prev.brigade.length === 0 ? '자위소방대장' : prev.brigade.length === 1 ? '부대장' : '비상연락'
      return { ...prev, brigade: [...prev.brigade, { team, name: p.name, duty: TEAM_DUTY[team] ?? '', phone: p.phone }] }
    })
    setShowPicker(false)
  }

  return (
    <div className="mb-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff]">
      {/* 헤더 — 준비율 게이지(입력 즉시 반영). 누락 칩은 상단 생성 바와 완전 중복이라 제거(2026-08-06):
          같은 computeFirePlanReadiness 항목을 두 번 그리고 있었고, 상단 칩은 다른 탭(건물·기본정보 등)까지
          보낼 수 있어 기능이 더 넓다. focusMissing은 상단 칩이 보내는 erp:focus-missing 수신용으로 존치. */}
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-[#090c1d]">계획서 정보</span>
          <span className="ml-2 flex items-center gap-1.5">
            <span className="w-24 h-1.5 rounded-full bg-[#e0ddf5] overflow-hidden">
              <span className="block h-full bg-[#7b68ee]" style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span className="text-[11px] text-[#514b81]">준비율 {done}/{total}</span>
          </span>
        </span>
      </div>

      <div className="px-4 pb-4 space-y-4">
        {/* §6-D-1 도구 모음 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={applySuggestions}
            className="h-7 px-3 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-[11px] inline-flex items-center gap-1">
            <Sparkles className="size-3" /> 추천값 채우기
          </button>
          {msg && <span className="text-[11px] text-[#514b81]">{msg}</span>}
        </div>

        {/* §1-2 카드 앵커 점프 */}
        <CardAnchorBar items={[
          { id: 'c-1.1.1', label: '① 시설현황' }, { id: 'c-1.1.2', label: '② 운영현황' }, { id: 'c-1.1.3', label: '③ 화재보험' },
          { id: 'consent-section', label: '④ 송달 동의' },
        ]} />

        {/* ① 시설현황 (섹션 카드 — §3-1.1) */}
        <section id="c-1.1.1" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-white p-3">
          <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Building2 className="size-3" /> ① 시설현황 {!initial.hasBuilding && (
            <span className="text-amber-600 font-normal">
              (건물 미등록 —{' '}
              {tabs ? (
                <button onClick={() => tabs.goTab('buildings')} className="underline hover:text-amber-700">건물·시설 탭에서 등록</button>
              ) : '건물·시설 탭에서 먼저 등록'})
            </span>
          )}</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className={labelCls}>수신기 위치</label><br />
              <input id="fp-receiver" value={d.receiverLocation} onChange={e => set('receiverLocation', e.target.value)} list="fp-receiver-list" placeholder="예: 1층 관리실" disabled={!initial.hasBuilding} className={`${inputCls} w-36${sgCls('receiverLocation')}`} title={sgTitle('receiverLocation')} />
              <datalist id="fp-receiver-list">{RECEIVER_LOCATION_PRESETS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div><label className={labelCls}>구조</label><br />
              <input id="fp-structure" value={d.structure} onChange={e => set('structure', e.target.value)} list="fp-structures" placeholder="선택/입력" disabled={!initial.hasBuilding} className={`${inputCls} w-32${sgCls('structure')}`} title={sgTitle('structure')} />
              <datalist id="fp-structures">{STRUCTURES.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div><label className={labelCls}>지붕</label><br />
              <input id="fp-roof" value={d.roof} onChange={e => set('roof', e.target.value)} list="fp-roofs" placeholder="선택/입력" disabled={!initial.hasBuilding} className={`${inputCls} w-28${sgCls('roof')}`} title={sgTitle('roof')} />
              <datalist id="fp-roofs">{ROOFS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            {initial.height && <div><label className={labelCls}>높이(대장)</label><br /><span className="text-xs text-[#514b81]">{initial.height} m</span></div>}
            {/* 신규 (104 — 별지 9호 연계): 계단·경사로·피난용승강기 (§11-4 NumField) */}
            <div><label className={labelCls}>계단</label><br /><NumField value={d.stairsCount} onChange={v => set('stairsCount', v)} unit="개소" disabled={!initial.hasBuilding} className={`${inputCls} w-16`} /></div>
            <div><label className={labelCls}>경사로</label><br /><NumField value={d.rampCount} onChange={v => set('rampCount', v)} unit="개소" disabled={!initial.hasBuilding} className={`${inputCls} w-16`} /></div>
            <div><label className={labelCls}>피난용승강기</label><br /><NumField value={d.evacElevatorCount} onChange={v => set('evacElevatorCount', v)} unit="대" disabled={!initial.hasBuilding} className={`${inputCls} w-16`} /></div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-[10px] text-[#b0acd6]">구조·지붕·높이는 건축물대장에서 자동 입력됩니다 (고객 등록 시 주소 검색) — 빈 값만 직접 입력</p>
            <button onClick={refetchLedger} disabled={!initial.hasBuilding || isLedgerPending}
              className="text-[10px] text-[#7b68ee] hover:underline disabled:opacity-50 inline-flex items-center gap-0.5 shrink-0">
              {isLedgerPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              건축물대장에서 다시 가져오기
            </button>
          </div>
        </section>

        {/* ② 운영현황 (섹션 카드 — §3-1.1: 급수·선임·대표자·자격·교육 + 운영·인원 + 자위소방대) */}
        <section id="c-1.1.2" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-white p-3 space-y-3">
          <p className="text-[11px] font-bold text-[#7b68ee] flex items-center gap-1"><Clock className="size-3" /> ② 운영현황</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className={labelCls}>급수(대상물 등급)</label><br />
              <div id="fp-grade" className={`flex rounded-lg border border-[#d0ccf5] overflow-hidden${sgCls('grade')}`} title={sgTitle('grade')}>
                {GRADES.map(g => (
                  <button key={g} onClick={() => set('grade', d.grade === g ? '' : g)}
                    className={`px-2.5 h-8 text-xs ${d.grade === g ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{g}</button>
                ))}
              </div>
            </div>
            {/* 사람 축(선임일·대표자 구분·자격구분·교육이수일·선임 형태)은 2026-08-20부터 **관계인 탭
                [소방안전관리]** 한 자리에서 입력한다. 여기서 칸을 지우되 값은 상태에 그대로 두고 함께
                저장한다 — 상태에서 빼면 이 패널 저장이 관계인 탭에서 채운 값을 null로 덮어쓴다.
                누락 칩(READINESS_TARGET_IDS)이 여전히 이 카드로 오므로 앵커 id는 유지한다. */}
            <div id="fp-manager-date" className="scroll-mt-4">
              <label className={labelCls}>소방안전관리자 정보</label><br />
              <Link href={`/customers/${customerId}?tab=contacts#c-fire-safety-manager`}
                id="fp-appoint-type"
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] scroll-mt-4">
                <ShieldCheck className="size-3" />
                선임일·자격구분·교육이수일·선임 형태·대표자 구분 → 관계인 탭
                <ExternalLink className="size-2.5" />
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className={labelCls}>평일</label><br />
              <input id="fp-ophours" value={d.opHoursWeekday} onChange={e => set('opHoursWeekday', e.target.value)} list="fp-ophours-list" placeholder="선택/입력" className={`${inputCls} w-28${sgCls('opHoursWeekday')}`} title={sgTitle('opHoursWeekday')} />
              <datalist id="fp-ophours-list">{OP_HOURS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div><label className={labelCls}>휴일</label><br /><input value={d.opHoursHoliday} onChange={e => set('opHoursHoliday', e.target.value)} list="fp-ophours-list" placeholder="선택/입력" className={`${inputCls} w-28${sgCls('opHoursHoliday')}`} title={sgTitle('opHoursHoliday')} /></div>
            <div><label className={labelCls}>근무</label><br /><NumField id="fp-headcount" value={d.headcountWorker} onChange={v => set('headcountWorker', v)} unit="명" className={`${inputCls} w-16`} /></div>
            <div><label className={labelCls}>거주</label><br /><NumField value={d.headcountResident} onChange={v => set('headcountResident', v)} unit="명" className={`${inputCls} w-16`} /></div>
            <div><label className={labelCls}>최대수용</label><br /><NumField value={d.headcountMax} onChange={v => set('headcountMax', v)} unit="명" className={`${inputCls} w-16`} /></div>
          </div>

          {/* 자위소방대 (운영현황 카드 내) */}
          <div id="fp-brigade">
          <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Flame className="size-3" /> 자위소방대 편성</p>
          <div className="space-y-1.5">
            {d.brigade.map((m, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <select value={m.team} onChange={e => setBrigade(i, 'team', e.target.value)} className={`${inputCls} w-32`}>
                  {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input value={m.name} onChange={e => setBrigade(i, 'name', e.target.value)} placeholder="성명" className={`${inputCls} w-24`} />
                <input value={m.duty} onChange={e => setBrigade(i, 'duty', e.target.value)} placeholder="개별임무 (자동)" className={`${inputCls} flex-1 min-w-40`} />
                <PhoneField value={m.phone} onChange={v => setBrigade(i, 'phone', v)} placeholder="연락처" className={`${inputCls} w-32`} />
                <button onClick={() => set('brigade', d.brigade.filter((_, j) => j !== i))} className="text-[#b0acd6] hover:text-red-500 text-xs px-1">✕</button>
              </div>
            ))}
            <div className="flex gap-2 relative">
              <button onClick={() => set('brigade', [...d.brigade, { team: TEAMS[Math.min(d.brigade.length, TEAMS.length - 1)], name: '', duty: '', phone: '' }])}
                className="text-[11px] text-[#7b68ee] hover:underline">+ 행 추가</button>
              <button onClick={() => setShowPicker(!showPicker)} className="text-[11px] text-[#7b68ee] hover:underline inline-flex items-center gap-0.5">
                <UserPlus className="size-3" /> 가져오기 (관계인·직원)
              </button>
              <button onClick={autoAssignBrigade} className="text-[11px] text-[#7b68ee] hover:underline inline-flex items-center gap-0.5">
                <Sparkles className="size-3" /> 자동 편성
              </button>
              {showPicker && (
                <div className="absolute z-10 top-6 left-0 bg-white border border-[#d0ccf5] rounded-lg shadow-lg max-h-56 overflow-y-auto min-w-64">
                  {people.length === 0 && <p className="text-[11px] text-[#b0acd6] px-3 py-2">후보 없음</p>}
                  {people.map((p, i) => (
                    <button key={i} onClick={() => addFromPerson(p)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff] flex justify-between gap-3">
                      <span>{p.name} <span className="text-[#b0acd6]">({p.kind})</span></span>
                      <span className="text-[#b0acd6]">{formatTel(p.phone)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </section>

        {/* ③ 화재보험 (섹션 카드 — §3-1.1) */}
        <section id="c-1.1.3" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-white p-3">
          <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Shield className="size-3" /> ③ 화재보험</p>
          {/* 2026-08-06: placeholder만 있어 값 입력 시 항목명이 사라지던 문제 수정 — ①②와 동일하게 라벨 부여.
              ⚠2026-08-24 단위 정정: **만원**이다. 종전 주석은 "별지 9호 원문이 '천만원'"이라 적었으나
              원문(_form/별지9호-placeholder.hwpx) 본문은 `가입금액: 대인( {{ins_person}} ) 대물( {{ins_property}} )`로
              **단위 표기가 아예 없다** — '천만원'은 벌금 조항('1천만원 이하의 벌금')에만 나온다. PDF가
              원문에 없는 단위를 발명했던 것이고, 실무 서식(보고서 갑지)이 '만원'이라 사용자가 만원으로
              확정했다(2026-08-24). 이 라벨은 별지 9호 PDF·갑지 엑셀의 접미와 **한 단위여야 한다**. */}
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className={labelCls}>가입 여부</label><br />
              <div id="fp-insurance" className="flex rounded-lg border border-[#d0ccf5] overflow-hidden w-fit">
                {[['가입', true], ['미가입', false]].map(([label, val]) => (
                  <button key={String(label)} onClick={() => set('insuranceJoined', d.insuranceJoined === val ? null : val as boolean)}
                    className={`px-3 h-8 text-xs ${d.insuranceJoined === val ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{label as string}</button>
                ))}
              </div>
            </div>
            {d.insuranceJoined === true && (<>
              <div><label className={labelCls}>보험사</label><br />
                <input value={d.insuranceCompany} onChange={e => set('insuranceCompany', e.target.value)} placeholder="예: 삼성화재" className={`${inputCls} w-32${sgCls('insuranceCompany')}`} title={sgTitle('insuranceCompany')} />
              </div>
              <div><label className={labelCls}>가입기간</label><br />
                <span className="inline-flex flex-wrap items-center gap-1">
                  <DateInput value={insStart} onChange={e => setInsPeriod(e.target.value, insEnd)} className={`${inputCls} w-32`} />
                  <span className="text-[11px] text-[#847ba8] shrink-0">~</span>
                  <DateInput value={insEnd} onChange={e => setInsPeriod(insStart, e.target.value)}
                    aria-invalid={isEndBeforeStart(insStart, insEnd)}
                    className={`${inputCls} w-32${isEndBeforeStart(insStart, insEnd) ? ' !border-red-400' : ''}`} />
                  {/* 저장은 서버(saveFirePlanInfoAction)가 거절한다 — 여기서는 그 전에 보이게만 한다 */}
                  {isEndBeforeStart(insStart, insEnd) && (
                    <span className="w-full text-[10px] text-red-600" data-testid="ins-range-error">❌ {DATE_RANGE_ERROR}</span>
                  )}
                </span>
              </div>
              <div><label className={labelCls}>대인 가입금액</label><br />
                <span className="inline-flex items-center gap-1">
                  <input value={d.insuranceAmountPerson} onChange={e => set('insuranceAmountPerson', e.target.value)} placeholder="예: 10000" className={`${inputCls} w-20`} title="만원 단위 숫자만 — '1억'처럼 단위를 적으면 서식에 '1억 만원'으로 인쇄됩니다" />
                  <span className="text-[11px] text-[#847ba8] shrink-0">만원</span>
                </span>
              </div>
              <div><label className={labelCls}>대물 가입금액</label><br />
                <span className="inline-flex items-center gap-1">
                  <input value={d.insuranceAmountProperty} onChange={e => set('insuranceAmountProperty', e.target.value)} placeholder="예: 100000" className={`${inputCls} w-20`} title="만원 단위 숫자만 — '10억'처럼 단위를 적으면 서식에 '10억 만원'으로 인쇄됩니다" />
                  <span className="text-[11px] text-[#847ba8] shrink-0">만원</span>
                </span>
              </div>
            </>)}
          </div>
        </section>

        {/* ④ 자체점검 보고서 전자우편 송달 동의 (098, 별지 9호 1쪽) —
            빠른 입력 폐기로 1.1로 이관된 뒤 저장 버튼이 둘이 되어, 이 폼 상태·[저장]으로 통합(2026-08-06) */}
        <section id="consent-section" className="scroll-mt-4 rounded-xl border border-[#e0ddf5] bg-white p-3">
          <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1">
            <Mail className="size-3" /> ④ 자체점검 보고서 전자우편 송달 동의
            <span className="font-normal text-[#b0acd6]">(별지 9호 1쪽 — 관계인 이메일 발송 조건)</span>
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className={labelCls}>동의 여부</label><br />
              <div id="fp-consent" className="flex rounded-lg border border-[#d0ccf5] overflow-hidden w-fit">
                {[['동의', true], ['미동의', false]].map(([label, val]) => (
                  <button key={String(label)} onClick={() => set('emailConsent', d.emailConsent === val ? null : val as boolean)}
                    className={`px-3 h-8 text-xs ${d.emailConsent === val ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{label as string}</button>
                ))}
              </div>
            </div>
            <div><label className={labelCls}>송달 이메일</label><br />
              <input value={d.reportEmail} type="email" onChange={e => set('reportEmail', e.target.value)}
                placeholder="예: owner@example.com" className={`${inputCls} w-56`} />
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button onClick={() => { void save() }} disabled={isPending}
            className="h-8 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
            {isPending && <Loader2 className="size-3 animate-spin" />} 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
