'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Loader2, Building2, Shield, Clock, Flame, UserPlus, RefreshCw, Sparkles, Copy, Pencil } from 'lucide-react'
import { saveFirePlanInfoAction, refreshLedgerAction, getFirePlanCopyCandidatesAction, type FirePlanInfoInput, type BrigadeMemberInput, type CopySourceCandidate } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { DateInput } from '@/components/ui/date-input'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { computeFirePlanReadiness, READINESS_TARGET_IDS } from '@/lib/fire-plan-readiness'
import { suggestGrade, suggestOpHours, RECEIVER_LOCATION_PRESETS } from '@/lib/fire-plan-suggest'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import { CardAnchorBar, NumField, PhoneField } from '@/components/ui/fields'

/** 소방계획서 정보 패널 (5+6차) — 아코디언 4그룹 + 준비율 게이지 + 가져오기 (설계 §4·§5) */

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
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'summary' | 'edit'>('summary')  // §6-D-2: 기본은 읽기 요약
  const [d, setD] = useState<FirePlanInfoInput>(initial)
  const [isPending, startTransition] = useTransition()
  const [isLedgerPending, startLedgerTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  // §6-D-1·4: 추천/복사로 채워진 필드 → 앰버 하이라이트 + 근거 툴팁 (저장 시 해제)
  const [suggested, setSuggested] = useState<Record<string, string>>({})
  const [copyList, setCopyList] = useState<CopySourceCandidate[] | null>(null)
  const [showCopy, setShowCopy] = useState(false)

  const markDirty = () => tabs?.setTabDirty('plan', true)
  const set = <K extends keyof FirePlanInfoInput>(k: K, v: FirePlanInfoInput[K]) => { markDirty(); setD(p => ({ ...p, [k]: v })) }
  const setBrigade = (i: number, k: keyof BrigadeMemberInput, v: string) => {
    markDirty()
    setD(p => { const rows = [...p.brigade]; rows[i] = { ...rows[i], [k]: v, ...(k === 'team' && !rows[i].duty ? { duty: TEAM_DUTY[v] ?? '' } : {}) }; return { ...p, brigade: rows } })
  }

  // 준비율 — 설계 §5: 입력 여부 체크 (생성 페이지·워커와 같은 어휘, fire-plan-readiness.ts)
  const { done, total, missing } = computeFirePlanReadiness({
    receiverLocation: d.receiverLocation, structure: d.structure, roof: d.roof,
    managerSelectedAt: d.managerSelectedAt, grade: d.grade, insuranceJoined: d.insuranceJoined,
    opHoursWeekday: d.opHoursWeekday,
    hasHeadcount: !!(d.headcountWorker || d.headcountResident || d.headcountMax),
    hasBrigade: d.brigade.some(m => m.name.trim()),
  })

  // §11-5: 빠른 입력 화면 누락 칩(plan-tab-view) → 이 패널 열고 필드 포커스 — 커스텀 이벤트 수신
  useEffect(() => {
    const onFocusReq = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label
      if (label && READINESS_TARGET_IDS[label]) focusMissing(label)
    }
    window.addEventListener('erp:focus-missing', onFocusReq)
    return () => window.removeEventListener('erp:focus-missing', onFocusReq)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 누락 칩 클릭 → 패널 열고(편집 모드) 해당 입력칸으로 스크롤·포커스 (설계 §5-1)
  function focusMissing(label: string) {
    setOpen(true)
    setMode('edit')
    setTimeout(() => {
      const el = document.getElementById(READINESS_TARGET_IDS[label] ?? '')
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const target = el.matches('input,select,button') ? el : el.querySelector('input,select,button')
      ;(target as HTMLElement | null)?.focus({ preventScroll: true })
    }, 80)
  }

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

  function save(goNext = false) {
    setMsg('')
    startTransition(async () => {
      const res = await saveFirePlanInfoAction(customerId, d)
      setMsg(res.error ? `❌ ${res.error}` : '✅ 저장되었습니다')
      if (!res.error) {
        tabs?.setTabDirty('plan', false)
        setSuggested({})
        setMode('summary')
        router.refresh()
        if (goNext) tabs?.goNextTab()
      }
    })
  }

  // §6-D-1: [추천값 채우기] — 빈 칸만, 앰버 하이라이트 + 근거, 확정은 사용자(저장 전 검토)
  function applySuggestions() {
    const g = !d.grade ? suggestGrade({
      purpose: initial.purpose, totalArea: initial.totalArea,
      floorsAbove: initial.floorsAbove, floorsBelow: initial.floorsBelow,
      height: parseFloat(initial.height) || null, facilityCodes: initial.facilityCodes,
    }) : null
    const oh = !d.opHoursWeekday ? suggestOpHours(initial.purpose) : null
    if (!g && !oh) {
      setMode('edit')
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
    setMode('edit')
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

  // §6-D-4: [다른 고객에서 복사] — 같은 용도 고객 값을 빈 칸에만 적용
  function openCopy() {
    setShowCopy(v => !v)
    if (copyList === null) {
      getFirePlanCopyCandidatesAction(customerId)
        .then(r => setCopyList(r.candidates))
        .catch(() => setCopyList([]))
    }
  }

  const COPY_LABELS: Record<string, string> = {
    receiverLocation: '수신기위치', structure: '구조', roof: '지붕', grade: '급수',
    opHoursWeekday: '운영(평일)', opHoursHoliday: '운영(휴일)', insuranceCompany: '보험사',
  }

  function applyCopy(c: CopySourceCandidate) {
    const entries = Object.entries(c.values) as Array<[keyof typeof c.values, string]>
    const fills = entries.filter(([k, v]) => v && !(d[k as keyof FirePlanInfoInput] as string))
    setShowCopy(false)
    if (fills.length === 0) { setMsg(`'${c.name}'에서 복사할 빈 항목이 없습니다.`); return }
    markDirty()
    setD(prev => {
      const next = { ...prev } as Record<string, unknown>
      for (const [k, v] of fills) if (!(next[k] as string)) next[k] = v
      return next as unknown as FirePlanInfoInput
    })
    setSuggested(prev => ({ ...prev, ...Object.fromEntries(fills.map(([k]) => [k, `'${c.name}'에서 복사`])) }))
    setMode('edit')
    setMsg(`📋 '${c.name}'에서 복사(빈 칸만): ${fills.map(([k]) => COPY_LABELS[k] ?? k).join(' · ')} — 확인 후 저장하세요`)
  }

  // 추천/복사 하이라이트 (앰버) — title에 근거 표시
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
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 shrink-0">
          {open ? <ChevronDown className="size-4 text-[#7b68ee]" /> : <ChevronRight className="size-4 text-[#7b68ee]" />}
          <span className="text-xs font-semibold text-[#090c1d]">계획서 정보</span>
          <span className="ml-2 flex items-center gap-1.5">
            <span className="w-24 h-1.5 rounded-full bg-[#e0ddf5] overflow-hidden">
              <span className="block h-full bg-[#7b68ee]" style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span className="text-[11px] text-[#514b81]">준비율 {done}/{total}</span>
          </span>
        </button>
        {missing.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap ml-auto min-w-0">
            <span className="text-[10px] text-amber-600 shrink-0">누락:</span>
            {missing.map(label => (
              <button key={label} onClick={() => focusMissing(label)}
                title={`${label} 입력칸으로 이동`}
                className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-px hover:bg-amber-100">
                {label}
              </button>
            ))}
          </span>
        )}
      </div>

      {/* §6-D-2: 읽기 요약 모드 (기본) — 값 스캔·누락 확인 후 필요한 것만 [편집] */}
      {open && mode === 'summary' && (() => {
        const brigadeCount = d.brigade.filter(m => m.name.trim()).length
        const items: Array<[string, string]> = [
          ['수신기위치', d.receiverLocation],
          ['구조', d.structure],
          ['지붕', d.roof],
          ['높이(대장)', initial.height ? `${initial.height} m` : ''],
          ['계단·경사로', (d.stairsCount || d.rampCount) ? `계단 ${d.stairsCount || 0} · 경사로 ${d.rampCount || 0}` : ''],
          ['피난용승강기', d.evacElevatorCount ? `${d.evacElevatorCount}대` : ''],
          ['급수', d.grade],
          ['선임일', d.managerSelectedAt],
          ['대표자 구분', d.repRole],
          ['자격·교육', (d.managerLicenseGrade || d.managerEduDate) ? [d.managerLicenseGrade, d.managerEduDate].filter(Boolean).join(' · ') : ''],
          ['화재보험', d.insuranceJoined === null ? '' : d.insuranceJoined ? [d.insuranceCompany || '가입', d.insurancePeriod].filter(Boolean).join(' · ') : '미가입'],
          ['운영시간', d.opHoursWeekday ? `${d.opHoursWeekday}${d.opHoursHoliday ? ` / 휴일 ${d.opHoursHoliday}` : ''}` : ''],
          ['인원', (d.headcountWorker || d.headcountResident || d.headcountMax) ? `근무 ${d.headcountWorker || 0} · 거주 ${d.headcountResident || 0} · 최대 ${d.headcountMax || 0}` : ''],
          ['자위소방대', brigadeCount > 0 ? `${brigadeCount}명 편성` : ''],
        ]
        return (
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5">
              {items.map(([label, val]) => (
                <div key={label} className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[10px] text-[#b0acd6] shrink-0 w-16">{label}</span>
                  {val
                    ? <span className="text-xs text-[#090c1d] truncate">{val}</span>
                    : <span className="text-xs text-amber-600">미입력</span>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setMode('edit')}
                className="h-7 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium inline-flex items-center gap-1">
                <Pencil className="size-3" /> 편집
              </button>
              <button onClick={applySuggestions}
                className="h-7 px-3 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-[11px] inline-flex items-center gap-1">
                <Sparkles className="size-3" /> 추천값 채우기
              </button>
              <button onClick={openCopy}
                className="h-7 px-3 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-[11px] inline-flex items-center gap-1">
                <Copy className="size-3" /> 다른 고객에서 복사
              </button>
              {msg && <span className="text-[11px] text-[#514b81]">{msg}</span>}
            </div>
            {showCopy && (
              <div className="rounded-lg border border-[#d0ccf5] bg-white shadow-lg max-h-48 overflow-y-auto max-w-md">
                {copyList === null ? (
                  <p className="px-3 py-2 text-[11px] text-[#b0acd6]">불러오는 중…</p>
                ) : copyList.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-[#b0acd6]">같은 용도의 복사 후보가 없습니다</p>
                ) : copyList.map(c => (
                  <button key={c.id} onClick={() => applyCopy(c)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff]">
                    <span className="font-medium text-[#090c1d]">{c.name}</span>
                    <span className="text-[#b0acd6] ml-1.5">
                      {[c.purpose, c.values.grade && `급수 ${c.values.grade}`, c.values.opHoursWeekday && `운영 ${c.values.opHoursWeekday}`, c.values.insuranceCompany].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {open && mode === 'edit' && (
        <div className="px-4 pb-4 space-y-4">
          {/* §6-D-1·4 도구 모음 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={applySuggestions}
              className="h-7 px-3 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-[11px] inline-flex items-center gap-1">
              <Sparkles className="size-3" /> 추천값 채우기
            </button>
            <button onClick={openCopy}
              className="h-7 px-3 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-[11px] inline-flex items-center gap-1">
              <Copy className="size-3" /> 다른 고객에서 복사
            </button>
            <button onClick={() => setMode('summary')}
              className="h-7 px-3 rounded-lg border border-[#c8c4d0] text-[#514b81] hover:bg-[#f8f9fa] text-[11px]">
              요약 보기
            </button>
          </div>
          {showCopy && (
            <div className="rounded-lg border border-[#d0ccf5] bg-white shadow-lg max-h-48 overflow-y-auto max-w-md">
              {copyList === null ? (
                <p className="px-3 py-2 text-[11px] text-[#b0acd6]">불러오는 중…</p>
              ) : copyList.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-[#b0acd6]">같은 용도의 복사 후보가 없습니다</p>
              ) : copyList.map(c => (
                <button key={c.id} onClick={() => applyCopy(c)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#f5f4ff]">
                  <span className="font-medium text-[#090c1d]">{c.name}</span>
                  <span className="text-[#b0acd6] ml-1.5">
                    {[c.purpose, c.values.grade && `급수 ${c.values.grade}`, c.values.opHoursWeekday && `운영 ${c.values.opHoursWeekday}`, c.values.insuranceCompany].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* §1-2 카드 앵커 점프 */}
          <CardAnchorBar items={[
            { id: 'c-1.1.1', label: '① 시설현황' }, { id: 'c-1.1.2', label: '② 운영현황' }, { id: 'c-1.1.3', label: '③ 화재보험' },
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
              <div><label className={labelCls}>관리자 선임일</label><br /><DateInput id="fp-manager-date" value={d.managerSelectedAt} onChange={e => set('managerSelectedAt', e.target.value)} className={`${inputCls} w-32`} /></div>
              {/* 신규 (104 — 별지 9호 2쪽 연계): 대표자 구분·자격구분·최근 교육이수일 */}
              <div><label className={labelCls}>대표자 구분</label><br />
                <div className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
                  {['소유자', '관리자', '점유자'].map(r => (
                    <button key={r} onClick={() => set('repRole', d.repRole === r ? '' : r)}
                      className={`px-2.5 h-8 text-xs ${d.repRole === r ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{r}</button>
                  ))}
                </div>
              </div>
              <div><label className={labelCls}>관리자 자격구분</label><br />
                <div className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
                  {GRADES.map(g => (
                    <button key={g} onClick={() => set('managerLicenseGrade', d.managerLicenseGrade === g ? '' : g)}
                      className={`px-2.5 h-8 text-xs ${d.managerLicenseGrade === g ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div><label className={labelCls}>최근 교육이수일</label><br /><DateInput value={d.managerEduDate} onChange={e => set('managerEduDate', e.target.value)} className={`${inputCls} w-32`} /></div>
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
                        <span className="text-[#b0acd6]">{p.phone}</span>
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
            <div className="flex flex-wrap gap-2 items-end">
              <div id="fp-insurance" className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
                {[['가입', true], ['미가입', false]].map(([label, val]) => (
                  <button key={String(label)} onClick={() => set('insuranceJoined', d.insuranceJoined === val ? null : val as boolean)}
                    className={`px-3 h-8 text-xs ${d.insuranceJoined === val ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{label as string}</button>
                ))}
              </div>
              {d.insuranceJoined === true && (<>
                <input value={d.insuranceCompany} onChange={e => set('insuranceCompany', e.target.value)} placeholder="보험사" className={`${inputCls} w-32${sgCls('insuranceCompany')}`} title={sgTitle('insuranceCompany')} />
                <input value={d.insurancePeriod} onChange={e => set('insurancePeriod', e.target.value)} placeholder="가입기간" className={`${inputCls} w-44`} />
                <input value={d.insuranceAmountPerson} onChange={e => set('insuranceAmountPerson', e.target.value)} placeholder="대인 금액" className={`${inputCls} w-28`} />
                <input value={d.insuranceAmountProperty} onChange={e => set('insuranceAmountProperty', e.target.value)} placeholder="대물 금액" className={`${inputCls} w-28`} />
              </>)}
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button onClick={() => save()} disabled={isPending}
              className="h-8 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
              {isPending && <Loader2 className="size-3 animate-spin" />} 저장
            </button>
            {tabs && (
              <button onClick={() => save(true)} disabled={isPending}
                className="h-8 px-4 rounded-lg border border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff] text-xs font-medium disabled:opacity-50">
                저장 후 다음 탭 →
              </button>
            )}
            {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
