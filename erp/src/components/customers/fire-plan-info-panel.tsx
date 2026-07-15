'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Loader2, Building2, Shield, Clock, Flame, UserPlus } from 'lucide-react'
import { saveFirePlanInfoAction, type FirePlanInfoInput, type BrigadeMemberInput } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { DateInput } from '@/components/ui/date-input'

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

export type FirePlanInfoInitial = FirePlanInfoInput & { height: string; hasBuilding: boolean }

export function FirePlanInfoPanel({ customerId, initial, people }: {
  customerId: string
  initial: FirePlanInfoInitial
  people: Array<{ name: string; phone: string; kind: string }>  // 관계인 + 직원 (가져오기 후보)
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<FirePlanInfoInput>(initial)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  const set = <K extends keyof FirePlanInfoInput>(k: K, v: FirePlanInfoInput[K]) => setD(p => ({ ...p, [k]: v }))
  const setBrigade = (i: number, k: keyof BrigadeMemberInput, v: string) =>
    setD(p => { const rows = [...p.brigade]; rows[i] = { ...rows[i], [k]: v, ...(k === 'team' && !rows[i].duty ? { duty: TEAM_DUTY[v] ?? '' } : {}) }; return { ...p, brigade: rows } })

  // 준비율 — 설계 §5: 입력 여부 체크 목록
  const checks: Array<[string, boolean]> = [
    ['수신기위치', !!d.receiverLocation.trim()], ['구조', !!d.structure.trim()], ['지붕', !!d.roof.trim()],
    ['선임일', !!d.managerSelectedAt], ['급수', !!d.grade],
    ['화재보험', d.insuranceJoined !== null], ['운영시간', !!d.opHoursWeekday],
    ['인원', !!(d.headcountWorker || d.headcountResident || d.headcountMax)],
    ['자위소방대', d.brigade.some(m => m.name.trim())],
  ]
  const done = checks.filter(c => c[1]).length
  const missing = checks.filter(c => !c[1]).map(c => c[0])

  function save() {
    setMsg('')
    startTransition(async () => {
      const res = await saveFirePlanInfoAction(customerId, d)
      setMsg(res.error ? `❌ ${res.error}` : '✅ 저장되었습니다')
      if (!res.error) router.refresh()
    })
  }

  function addFromPerson(p: { name: string; phone: string }) {
    setD(prev => {
      const team = prev.brigade.length === 0 ? '자위소방대장' : prev.brigade.length === 1 ? '부대장' : '비상연락'
      return { ...prev, brigade: [...prev.brigade, { team, name: p.name, duty: TEAM_DUTY[team] ?? '', phone: p.phone }] }
    })
    setShowPicker(false)
  }

  return (
    <div className="mb-4 rounded-xl border border-[#e0ddf5] bg-[#fafaff]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3">
        {open ? <ChevronDown className="size-4 text-[#7b68ee]" /> : <ChevronRight className="size-4 text-[#7b68ee]" />}
        <span className="text-xs font-semibold text-[#090c1d]">계획서 정보</span>
        <span className="ml-2 flex items-center gap-1.5">
          <span className="w-24 h-1.5 rounded-full bg-[#e0ddf5] overflow-hidden">
            <span className="block h-full bg-[#7b68ee]" style={{ width: `${(done / checks.length) * 100}%` }} />
          </span>
          <span className="text-[11px] text-[#514b81]">준비율 {done}/{checks.length}</span>
        </span>
        {missing.length > 0 && (
          <span className="text-[10px] text-amber-600 truncate ml-auto">누락: {missing.join(' · ')}</span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* 🏢 건물 개요 */}
          <section>
            <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Building2 className="size-3" /> 건물 개요 {!initial.hasBuilding && <span className="text-amber-600 font-normal">(건물 미등록 — 건물 관리에서 먼저 등록)</span>}</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div><label className={labelCls}>수신기 위치</label><br /><input value={d.receiverLocation} onChange={e => set('receiverLocation', e.target.value)} placeholder="예: 1층 관리실" disabled={!initial.hasBuilding} className={`${inputCls} w-36`} /></div>
              <div><label className={labelCls}>구조</label><br />
                <input value={d.structure} onChange={e => set('structure', e.target.value)} list="fp-structures" placeholder="선택/입력" disabled={!initial.hasBuilding} className={`${inputCls} w-32`} />
                <datalist id="fp-structures">{STRUCTURES.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div><label className={labelCls}>지붕</label><br />
                <input value={d.roof} onChange={e => set('roof', e.target.value)} list="fp-roofs" placeholder="선택/입력" disabled={!initial.hasBuilding} className={`${inputCls} w-28`} />
                <datalist id="fp-roofs">{ROOFS.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              {initial.height && <div><label className={labelCls}>높이(대장)</label><br /><span className="text-xs text-[#514b81]">{initial.height} m</span></div>}
              <div><label className={labelCls}>급수</label><br />
                <div className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
                  {GRADES.map(g => (
                    <button key={g} onClick={() => set('grade', d.grade === g ? '' : g)}
                      className={`px-2.5 h-8 text-xs ${d.grade === g ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div><label className={labelCls}>관리자 선임일</label><br /><DateInput value={d.managerSelectedAt} onChange={e => set('managerSelectedAt', e.target.value)} className={`${inputCls} w-32`} /></div>
            </div>
            <p className="text-[10px] text-[#b0acd6] mt-1">구조·지붕·높이는 건축물대장에서 자동 입력됩니다 (고객 등록 시 주소 검색) — 빈 값만 직접 입력</p>
          </section>

          {/* 🛡 화재보험 */}
          <section>
            <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Shield className="size-3" /> 화재보험</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
                {[['가입', true], ['미가입', false]].map(([label, val]) => (
                  <button key={String(label)} onClick={() => set('insuranceJoined', d.insuranceJoined === val ? null : val as boolean)}
                    className={`px-3 h-8 text-xs ${d.insuranceJoined === val ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>{label as string}</button>
                ))}
              </div>
              {d.insuranceJoined === true && (<>
                <input value={d.insuranceCompany} onChange={e => set('insuranceCompany', e.target.value)} placeholder="보험사" className={`${inputCls} w-32`} />
                <input value={d.insurancePeriod} onChange={e => set('insurancePeriod', e.target.value)} placeholder="가입기간" className={`${inputCls} w-44`} />
                <input value={d.insuranceAmountPerson} onChange={e => set('insuranceAmountPerson', e.target.value)} placeholder="대인 금액" className={`${inputCls} w-28`} />
                <input value={d.insuranceAmountProperty} onChange={e => set('insuranceAmountProperty', e.target.value)} placeholder="대물 금액" className={`${inputCls} w-28`} />
              </>)}
            </div>
          </section>

          {/* ⏰ 운영·인원 */}
          <section>
            <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Clock className="size-3" /> 운영·인원</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div><label className={labelCls}>평일</label><br />
                <input value={d.opHoursWeekday} onChange={e => set('opHoursWeekday', e.target.value)} list="fp-ophours" placeholder="선택/입력" className={`${inputCls} w-28`} />
                <datalist id="fp-ophours">{OP_HOURS.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div><label className={labelCls}>휴일</label><br /><input value={d.opHoursHoliday} onChange={e => set('opHoursHoliday', e.target.value)} list="fp-ophours" placeholder="선택/입력" className={`${inputCls} w-28`} /></div>
              <div><label className={labelCls}>근무(명)</label><br /><input type="number" value={d.headcountWorker} onChange={e => set('headcountWorker', e.target.value)} className={`${inputCls} w-20`} /></div>
              <div><label className={labelCls}>거주(명)</label><br /><input type="number" value={d.headcountResident} onChange={e => set('headcountResident', e.target.value)} className={`${inputCls} w-20`} /></div>
              <div><label className={labelCls}>최대수용(명)</label><br /><input type="number" value={d.headcountMax} onChange={e => set('headcountMax', e.target.value)} className={`${inputCls} w-24`} /></div>
            </div>
          </section>

          {/* 🚒 자위소방대 */}
          <section>
            <p className="text-[11px] font-bold text-[#7b68ee] mb-1.5 flex items-center gap-1"><Flame className="size-3" /> 자위소방대 편성</p>
            <div className="space-y-1.5">
              {d.brigade.map((m, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <select value={m.team} onChange={e => setBrigade(i, 'team', e.target.value)} className={`${inputCls} w-32`}>
                    {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={m.name} onChange={e => setBrigade(i, 'name', e.target.value)} placeholder="성명" className={`${inputCls} w-24`} />
                  <input value={m.duty} onChange={e => setBrigade(i, 'duty', e.target.value)} placeholder="개별임무 (자동)" className={`${inputCls} flex-1 min-w-40`} />
                  <input value={m.phone} onChange={e => setBrigade(i, 'phone', e.target.value)} placeholder="연락처" className={`${inputCls} w-32`} />
                  <button onClick={() => set('brigade', d.brigade.filter((_, j) => j !== i))} className="text-[#b0acd6] hover:text-red-500 text-xs px-1">✕</button>
                </div>
              ))}
              <div className="flex gap-2 relative">
                <button onClick={() => set('brigade', [...d.brigade, { team: TEAMS[Math.min(d.brigade.length, TEAMS.length - 1)], name: '', duty: '', phone: '' }])}
                  className="text-[11px] text-[#7b68ee] hover:underline">+ 행 추가</button>
                <button onClick={() => setShowPicker(!showPicker)} className="text-[11px] text-[#7b68ee] hover:underline inline-flex items-center gap-0.5">
                  <UserPlus className="size-3" /> 가져오기 (관계인·직원)
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
          </section>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={isPending}
              className="h-8 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
              {isPending && <Loader2 className="size-3 animate-spin" />} 저장
            </button>
            {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
