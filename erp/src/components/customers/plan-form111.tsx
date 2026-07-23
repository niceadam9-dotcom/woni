'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2, Wand2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { useUnsavedWarning } from '@/components/ui/fields'
import { SectionCopyButton } from '@/components/customers/section-copy-button'

/** 서식 1.11 소방훈련 및 교육 — 섹션 카드 4개 (소방계획서_4.md §3, sections.training)
 *  1.11.1 연간계획(교육/훈련 × 12개월 그리드 + [표준 패턴] §11-3) · 1.11.2 세부계획 · 1.11.3 시나리오(유형 프리셋) · 1.11.4 결과 기록부(별지 28호, 2년 보관) */

export type TrainingDetailRow = { name: string; at: string; place: string; target: string; kind: string; form: string; materials: string; plan: string }
export type TrainingRecordRow = { at: string; kind: string; attendees: string; content: string; evaluation: string }
export type TrainingSection = {
  headcount: { worker: string; resident: string; brigade: string }
  eduMonths: number[]
  drillMonths: number[]
  details: TrainingDetailRow[]
  scenario: string
  scenarioType: string
  records: TrainingRecordRow[]
}
export const EMPTY_TRAINING: TrainingSection = {
  headcount: { worker: '', resident: '', brigade: '' },
  eduMonths: [], drillMonths: [], details: [], scenario: '', scenarioType: '', records: [],
}

const SCENARIO_PRESETS: Record<string, string> = {
  '주택형': '① 화재 발견 → "불이야" 전파 및 비상벨 작동 ② 자위소방대장 지휘 — 비상연락반 119 신고 ③ 초기소화반 소화기·옥내소화전으로 초기 진화 ④ 피난유도반 세대별 대피 유도(엘리베이터 금지, 계단 이용) ⑤ 집결지 인원 확인·부상자 응급조치 ⑥ 소방대 도착 시 현황 인계',
  '상가형': '① 화재 발견 → 비상방송으로 전 매장 전파 ② 자위소방대장 지휘 — 비상연락반 119 신고·건물주 통보 ③ 초기소화반 발화층 초기 진화 ④ 피난유도반 고객·종사자 피난 유도(양방향 피난로 안내) ⑤ 방호안전반 전기·가스 차단 ⑥ 집결지 인원 확인 후 소방대 인계',
  '공장형': '① 화재 발견 → 사이렌·방송 전파, 라인 비상정지 ② 자위소방대장 지휘 — 비상연락반 119 신고 ③ 방호안전반 위험물·가스 밸브 차단 ④ 초기소화반 소화설비로 초기 진화 ⑤ 피난유도반 작업자 옥외 집결지 유도 ⑥ 인원 점검·부상자 응급조치 후 소방대 인계',
}
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export function PlanForm111({ customerId, canManage, initial, presetType }: {
  customerId: string
  canManage: boolean
  initial: TrainingSection | null
  presetType: string // 용도 기반 추천 (주택형/상가형/공장형)
}) {
  const router = useRouter()
  const [t, setT] = useState<TrainingSection>(initial ?? EMPTY_TRAINING)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty) // §11-4 이탈 경고
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function patch(p: Partial<TrainingSection>) { setT(v => ({ ...v, ...p })); setDirty(true) }
  function toggleMonth(key: 'eduMonths' | 'drillMonths', m: number) {
    patch({ [key]: t[key].includes(m) ? t[key].filter(x => x !== m) : [...t[key], m].sort((a, b) => a - b) } as Partial<TrainingSection>)
  }
  function standardPattern() {
    // 표준 패턴 (§11-3) — 교육·훈련 연 2회(상·하반기)
    patch({ eduMonths: [5, 11], drillMonths: [5, 11] })
  }
  function loadScenario(type: string) {
    patch({ scenario: SCENARIO_PRESETS[type] ?? '', scenarioType: type })
  }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        training: {
          ...t,
          details: t.details.filter(d => d.name.trim() || d.at.trim()),
          records: t.records.filter(r => r.at.trim() || r.content.trim()),
        },
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.11 저장됨 — 별지 9호 교육훈련 실시 판정에도 사용됩니다')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const monthGrid = (label: string, key: 'eduMonths' | 'drillMonths') => (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[11px] font-medium text-[#514b81] w-10">{label}</span>
      {MONTHS.map(m => (
        <button key={m} disabled={!canManage} onClick={() => toggleMonth(key, m)}
          className={`size-7 rounded text-[11px] border transition-colors ${
            t[key].includes(m) ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}>
          {m}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 1.11.1 연간계획 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-[#514b81]">1.11.1 연간 훈련·교육 계획</p>
          {canManage && (
            <button onClick={standardPattern}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Wand2 className="size-3" /> 표준 패턴 (5·11월)
            </button>
          )}
          {canManage && (
            <span className="ml-auto">
              <SectionCopyButton customerId={customerId} sectionKey="training" sectionLabel="1.11 훈련·교육"
                onApplied={v => { setT({ ...EMPTY_TRAINING, ...(v as Partial<TrainingSection>) }); setDirty(false); setMsg('✅ 다른 고객에서 복사됨 (저장 완료)') }} />
            </span>
          )}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          {([['worker', '근무 인원'], ['resident', '거주 인원'], ['brigade', '자위소방대']] as const).map(([k, label]) => (
            <div key={k}>
              <label className="text-[10px] text-[#b0acd6] block">{label}</label>
              <input value={t.headcount[k]} disabled={!canManage} inputMode="numeric"
                onChange={e => patch({ headcount: { ...t.headcount, [k]: e.target.value } })} className={`${inputCls} w-20`} />
            </div>
          ))}
        </div>
        {monthGrid('교육', 'eduMonths')}
        {monthGrid('훈련', 'drillMonths')}
      </div>

      {/* 1.11.2 세부계획 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">1.11.2 차수별 세부계획</p>
          {canManage && (
            <button onClick={() => { patch({ details: [...t.details, { name: '', at: '', place: '', target: '', kind: '이론', form: '자체', materials: '', plan: '' }] }) }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Plus className="size-3" /> 차수 추가
            </button>
          )}
        </div>
        {t.details.length === 0 && <p className="text-[11px] text-[#b0acd6]">차수별 계획(명칭·일시·장소 등)을 추가하세요.</p>}
        <div className="space-y-1.5">
          {t.details.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={d.name} disabled={!canManage} placeholder="명칭" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} className={`${inputCls} w-32`} />
              <input value={d.at} disabled={!canManage} placeholder="일시" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, at: e.target.value } : x) })} className={`${inputCls} w-28`} />
              <input value={d.place} disabled={!canManage} placeholder="장소" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, place: e.target.value } : x) })} className={`${inputCls} w-24`} />
              <input value={d.target} disabled={!canManage} placeholder="대상" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, target: e.target.value } : x) })} className={`${inputCls} w-24`} />
              <select value={d.kind} disabled={!canManage} onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, kind: e.target.value } : x) })} className="h-7 rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none">
                <option value="이론">이론</option><option value="실습">실습</option>
              </select>
              <select value={d.form} disabled={!canManage} onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, form: e.target.value } : x) })} className="h-7 rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none">
                <option value="자체">자체</option><option value="합동">합동</option>
              </select>
              <input value={d.materials} disabled={!canManage} placeholder="교보재" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, materials: e.target.value } : x) })} className={`${inputCls} w-24`} />
              <input value={d.plan} disabled={!canManage} placeholder="훈련·교육·평가 계획" onChange={e => patch({ details: t.details.map((x, j) => j === i ? { ...x, plan: e.target.value } : x) })} className={`${inputCls} flex-1 min-w-32`} />
              {canManage && (
                <button onClick={() => patch({ details: t.details.filter((_, j) => j !== i) })} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 1.11.3 시나리오 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-[#514b81]">1.11.3 훈련 시나리오</p>
          {canManage && Object.keys(SCENARIO_PRESETS).map(type => (
            <button key={type} onClick={() => loadScenario(type)}
              className={`h-6 px-2 rounded-full text-[11px] border transition-colors ${
                t.scenarioType === type ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff]'}`}>
              {type}{type === presetType ? ' ★' : ''}
            </button>
          ))}
        </div>
        <textarea value={t.scenario} disabled={!canManage} rows={4}
          onChange={e => patch({ scenario: e.target.value })}
          placeholder="유형 프리셋을 불러온 뒤 고객 상황에 맞게 수정하세요."
          className="w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y" />
      </div>

      {/* 1.11.4 결과 기록부 */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-[#514b81]">1.11.4 훈련·교육 실시 결과 기록부
            <span className="font-normal text-[#b0acd6] ml-2">별지 28호 — 2년 보관 · 별지 9호 실시 판정 소스 · 2장 2.14와 공용</span>
          </p>
          {canManage && (
            <button onClick={() => patch({ records: [...t.records, { at: '', kind: '훈련', attendees: '', content: '', evaluation: '' }] })}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]">
              <Plus className="size-3" /> 행 추가
            </button>
          )}
        </div>
        {t.records.length === 0 && <p className="text-[11px] text-[#b0acd6]">실시 후 결과를 기록하세요.</p>}
        <div className="space-y-1.5">
          {t.records.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={r.at} disabled={!canManage} placeholder="실시일" onChange={e => patch({ records: t.records.map((x, j) => j === i ? { ...x, at: e.target.value } : x) })} className={`${inputCls} w-28`} />
              <select value={r.kind} disabled={!canManage} onChange={e => patch({ records: t.records.map((x, j) => j === i ? { ...x, kind: e.target.value } : x) })} className="h-7 rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none">
                <option value="훈련">훈련</option><option value="교육">교육</option><option value="교육·훈련">교육·훈련</option>
              </select>
              <input value={r.attendees} disabled={!canManage} inputMode="numeric" placeholder="참여인원" onChange={e => patch({ records: t.records.map((x, j) => j === i ? { ...x, attendees: e.target.value } : x) })} className={`${inputCls} w-20`} />
              <input value={r.content} disabled={!canManage} placeholder="내용" onChange={e => patch({ records: t.records.map((x, j) => j === i ? { ...x, content: e.target.value } : x) })} className={`${inputCls} flex-1 min-w-32`} />
              <input value={r.evaluation} disabled={!canManage} placeholder="평가" onChange={e => patch({ records: t.records.map((x, j) => j === i ? { ...x, evaluation: e.target.value } : x) })} className={`${inputCls} w-32`} />
              {canManage && (
                <button onClick={() => patch({ records: t.records.filter((_, j) => j !== i) })} className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.11 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
