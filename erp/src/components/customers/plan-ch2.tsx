'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2, Users } from 'lucide-react'
import { saveFirePlanSectionsAction, saveBrigadeAction, type BrigadeRowInput } from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** 2장 자위소방대 운영계획 (소방계획서_4.md §5)
 *  2.1 일반현황(Type Ⅰ/Ⅱ/Ⅲ → sections.brigadeGeneral) · 2.2 편성표(fire_brigade_members — 1.1 패널과 동일 데이터)
 *  · 팀별 임무 2.5~2.13(sections.brigadeTeams — 표준 문구 프리셋+수정, v1) · 2.14는 1.11.4와 공용(§12-2 잠정) */

const TYPES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'I', label: 'Type Ⅰ', desc: '특급 — 지휘조직 + 8개 기능조직' },
  { key: 'II', label: 'Type Ⅱ', desc: '1급 — 지휘조직 + 4개 기능조직' },
  { key: 'III', label: 'Type Ⅲ', desc: '2·3급 — 지휘자 + 초기대응체계' },
]
const TEAMS: Array<{ key: string; label: string; preset: string }> = [
  { key: 'command', label: '지휘통제', preset: '자위소방대장은 화재 상황을 판단하고 대원 임무를 지휘·통제하며, 소방대 도착 시 현장 정보를 인계한다.' },
  { key: 'contact', label: '비상연락', preset: '화재 발견 즉시 119에 신고하고 관계인·인근 협력업체 등 비상연락망에 따라 상황을 전파한다.' },
  { key: 'extinguish', label: '초기소화', preset: '소화기·옥내소화전을 사용해 초기 진화를 실시하고, 확산 시 무리한 진압을 중단하고 대피한다.' },
  { key: 'evacuate', label: '피난유도', preset: '재실자를 피난계단으로 유도하고(엘리베이터 사용 금지) 집결지에서 인원을 확인한다.' },
  { key: 'rescue', label: '응급구조', preset: '부상자를 안전한 장소로 옮기고 응급처치를 실시하며, 구급대 도착 시 인계한다.' },
  { key: 'protect', label: '방호안전', preset: '전기·가스 등 위험 설비를 차단하고 위험물 안전조치와 출입 통제를 실시한다.' },
  { key: 'initial', label: '초기대응체계', preset: '근무 인원 중심으로 상시 초기대응체계를 유지하고, 근무시간 외에는 당직자가 초기 대응을 담당한다.' },
]
const TEAM_OPTIONS = ['자위소방대장', '부대장', '비상연락반', '초기소화반', '피난유도반', '응급구조반', '방호안전반', '반원']

export function PlanCh2({ customerId, canManage, initialType, initialTeams, initialBrigade, people }: {
  customerId: string
  canManage: boolean
  initialType: string
  initialTeams: Record<string, string>
  initialBrigade: BrigadeRowInput[]
  people: Array<{ name: string; phone: string; kind: string }>
}) {
  const router = useRouter()
  const [type, setType] = useState(initialType)
  const [teams, setTeams] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const tm of TEAMS) map[tm.key] = initialTeams[tm.key] ?? ''
    return map
  })
  const [rows, setRows] = useState<BrigadeRowInput[]>(initialBrigade.length > 0 ? initialBrigade : [{ team: '자위소방대장', name: '', duty: '', phone: '' }])
  const [showPeople, setShowPeople] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const res1 = await saveFirePlanSectionsAction(customerId, {
        brigadeGeneral: { type },
        brigadeTeams: teams,
      })
      if (res1.error) { setMsg(`❌ ${res1.error}`); return }
      const res2 = await saveBrigadeAction(customerId, rows)
      if (res2.error) { setMsg(`❌ ${res2.error}`); return }
      setDirty(false)
      setMsg('✅ 2장 저장됨 (편성표는 1.1 계획서 정보 패널과 동일 데이터)')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  return (
    <div className="space-y-4">
      {/* 2.1 일반현황 — Type 선택 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <p className="text-xs font-semibold text-[#514b81] mb-2">2.1 자위소방대 및 초기대응체계 일반현황</p>
        <div className="flex items-stretch gap-2 flex-wrap">
          {TYPES.map(tp => (
            <button key={tp.key} disabled={!canManage}
              onClick={() => { setType(type === tp.key ? '' : tp.key); setDirty(true) }}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                type === tp.key ? 'border-[#7b68ee] bg-[#f5f4ff]' : 'border-[#d0ccf5] hover:bg-[#f5f4ff]'}`}>
              <span className={`text-xs font-semibold ${type === tp.key ? 'text-[#7b68ee]' : 'text-[#090c1d]'}`}>{tp.label}</span>
              <span className="block text-[10px] text-[#514b81] mt-0.5">{tp.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2.2 편성표 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">2.2 편성표
            <span className="font-normal text-[#b0acd6] ml-2">1.1 계획서 정보 패널의 자위소방대와 동일 데이터</span>
          </p>
          {canManage && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowPeople(v => !v)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
                <Users className="size-3" /> 관계인·직원 가져오기
              </button>
              <button onClick={() => { setRows(p => [...p, { team: '반원', name: '', duty: '', phone: '' }]); setDirty(true) }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff]">
                <Plus className="size-3" /> 행 추가
              </button>
            </div>
          )}
        </div>
        {showPeople && (
          <div className="flex items-center gap-1 flex-wrap mb-2">
            {people.slice(0, 12).map((p, i) => (
              <button key={i}
                onClick={() => { setRows(prev => [...prev, { team: '반원', name: p.name, duty: '', phone: p.phone }]); setDirty(true) }}
                className="h-6 px-2 rounded-full border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff]"
                title={p.kind}>
                + {p.name} <span className="text-[#b0acd6]">({p.kind})</span>
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <select value={r.team} disabled={!canManage}
                onChange={e => { setRows(p => p.map((x, j) => j === i ? { ...x, team: e.target.value } : x)); setDirty(true) }}
                className="h-7 rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none w-28">
                {TEAM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <input value={r.name} disabled={!canManage} placeholder="성명"
                onChange={e => { setRows(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-24`} />
              <input value={r.duty} disabled={!canManage} placeholder="임무"
                onChange={e => { setRows(p => p.map((x, j) => j === i ? { ...x, duty: e.target.value } : x)); setDirty(true) }} className={`${inputCls} flex-1 min-w-32`} />
              <input value={r.phone} disabled={!canManage} placeholder="연락처"
                onChange={e => { setRows(p => p.map((x, j) => j === i ? { ...x, phone: e.target.value } : x)); setDirty(true) }} className={`${inputCls} w-32`} />
              {canManage && (
                <button onClick={() => { setRows(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 팀별 임무 (2.5~2.13) — 표준 문구 + 수정 (v1 프리셋) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <p className="text-xs font-semibold text-[#514b81]">팀별 임무 (2.5~2.13)
          <span className="font-normal text-[#b0acd6] ml-2">표준 문구 기본 — 필요 시 수정 (빈 칸이면 표준 문구로 출력)</span>
        </p>
        {TEAMS.map(tm => (
          <div key={tm.key}>
            <label className="text-[11px] font-medium text-[#514b81] block mb-0.5">{tm.label}</label>
            <textarea value={teams[tm.key]} disabled={!canManage} rows={1} placeholder={tm.preset}
              onChange={e => { setTeams(p => ({ ...p, [tm.key]: e.target.value })); setDirty(true) }}
              className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1 text-xs outline-none focus:border-[#7b68ee] resize-y" />
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[#b0acd6]">2.14 교육·훈련 실시 결과 기록부는 서식 1.11.4와 공용입니다 — 1장 &gt; 1.11에서 기록하세요.</p>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 2장 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
