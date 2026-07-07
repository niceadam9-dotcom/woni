'use client'

import { useState, useTransition } from 'react'
import { Check, Printer, AlertTriangle } from 'lucide-react'
import {
  updateActionPlanDetailAction,
  upsertPlanStatusAction,
  upsertCompleteReportAction,
} from '@/app/(dashboard)/action-plans/actions'

function fmt(d: string | null | undefined) { return d ? d.slice(0, 10) : '' }

type Defect = {
  id: string; defect_code: string | null; defect_name: string
  defect_detail: string | null; photo_url: string | null
  severity: string; created_at: string
}

const SEV_CLS: Record<string, string> = {
  경미: 'bg-yellow-100 text-yellow-700',
  보통: 'bg-orange-100 text-orange-700',
  중대: 'bg-red-100 text-red-700',
}

export function ActionPlanDetailClient({
  plan,
  defects,
  canManage,
}: {
  plan: Record<string, unknown>
  defects: Record<string, unknown>[]
  canManage: boolean
}) {
  type InspRef = {
    id: string; inspection_type: string; sequence_num: number; year: number
    inspection_start_date: string
    customers: { customer_name: string; customer_code: string; address: string | null } | null
    profiles: { name: string; position: string | null } | null
  }
  type APS = { sent_at: string | null; fire_station_submitted_at: string | null; defect_certificate_count: number }
  type ACR = { id: string; completed_at: string | null; submitted_at: string | null; report_file_url: string | null }

  const insp    = plan.inspections   as InspRef | null
  const aps     = plan.action_plan_status as APS | null
  const acr     = plan.action_complete_reports as ACR | null

  // 이행계획서 상태
  const [targetDate,     setTargetDate]    = useState(fmt(plan.completion_target_date as string))
  const [sentAt,         setSentAt]        = useState(fmt(plan.sent_at as string))
  const [planSubmitted,  setPlanSubmitted] = useState(fmt(plan.submitted_at as string))
  const [fireAt,         setFireAt]        = useState(fmt(aps?.fire_station_submitted_at))
  const [certCount,      setCertCount]     = useState(aps?.defect_certificate_count ?? 0)

  // 이행완료보고서 상태
  const [completeAt,     setCompleteAt]    = useState(fmt(acr?.completed_at))
  const [completeSubmit, setCompleteSubmit] = useState(fmt(acr?.submitted_at))

  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  function save() {
    startTransition(async () => {
      const [r1, r2, r3] = await Promise.all([
        updateActionPlanDetailAction({
          id:                    plan.id as string,
          completionTargetDate:  targetDate   || null,
          submittedAt:           planSubmitted || null,
          sentAt:                sentAt        || null,
        }),
        upsertPlanStatusAction({
          actionPlanId:            plan.id as string,
          sentAt:                  sentAt        || null,
          fireStationSubmittedAt:  fireAt        || null,
          defectCertificateCount:  certCount,
        }),
        (completeAt || completeSubmit) ? upsertCompleteReportAction({
          actionPlanId:   plan.id as string,
          completedAt:    completeAt    || null,
          submittedAt:    completeSubmit || null,
        }) : Promise.resolve({}),
      ])
      const anyErr = (r1 as {error?:string}).error || (r2 as {error?:string}).error || (r3 as {error?:string}).error
      if (anyErr) { setErr(anyErr); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const defectList = defects as unknown as Defect[]

  return (
    <div className="space-y-4">
      {/* 건물정보 카드 */}
      <div className="bg-white rounded-xl border p-5">
        <div className="font-semibold text-lg mb-1">{insp?.customers?.customer_name}</div>
        <div className="text-xs text-gray-400 space-y-0.5">
          <p>{insp?.customers?.customer_code} · {insp?.inspection_type} {insp?.year}년 {insp?.sequence_num}차</p>
          {insp?.customers?.address && <p>{insp.customers.address}</p>}
          <p>담당: {insp?.profiles?.name}{insp?.profiles?.position ? ` (${insp.profiles.position})` : ''}</p>
        </div>
      </div>

      {/* 불량내역 목록 */}
      <div className="bg-white rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={14} className="text-orange-500" />
          <span className="font-semibold text-sm">불량내역 ({defectList.length}건)</span>
        </div>
        {defectList.length === 0 ? (
          <p className="text-xs text-gray-400">불량내역이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {defectList.map((d, idx) => (
              <div key={d.id} className="flex items-start gap-3 text-xs">
                <span className="text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${SEV_CLS[d.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                  {d.severity}
                </span>
                <div>
                  <p className="font-medium">{d.defect_name}</p>
                  {d.defect_detail && <p className="text-gray-500 mt-0.5">{d.defect_detail}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 이행계획서 상태 입력 카드 */}
      <div className="bg-white rounded-xl border p-5">
        <div className="font-semibold text-sm mb-4">이행계획서 정보</div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '완료목표일',    value: targetDate,    set: setTargetDate },
            { label: '관계인 송부일', value: sentAt,        set: setSentAt },
            { label: '이행계획 제출일', value: planSubmitted, set: setPlanSubmitted },
            { label: '소방서 제출일', value: fireAt,        set: setFireAt },
          ].map(f => (
            <div key={f.label}>
              <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
              <input
                type="date"
                value={f.value}
                onChange={e => f.set(e.target.value)}
                disabled={!canManage}
                className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-gray-500 mb-1">증명서 수량</label>
            <input
              type="number" min={0} value={certCount}
              onChange={e => setCertCount(Number(e.target.value))}
              disabled={!canManage}
              className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
            />
          </div>
        </div>
      </div>

      {/* 이행완료보고서 카드 */}
      {planSubmitted && (
        <div className="bg-white rounded-xl border p-5">
          <div className="font-semibold text-sm mb-4">이행완료보고서</div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: '조치 완료일',       value: completeAt,    set: setCompleteAt },
              { label: '이행완료 제출일',    value: completeSubmit, set: setCompleteSubmit },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input
                  type="date"
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  disabled={!canManage}
                  className="w-full border rounded px-2 py-1.5 text-sm disabled:bg-gray-50"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-xs text-red-500 px-1">{err}</p>}

      {/* 액션 버튼 */}
      <div className="flex items-center gap-3 pb-8">
        {canManage && (
          <button
            onClick={save}
            disabled={pending}
            className="bg-[#7b68ee] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {pending ? '저장 중…' : saved ? '✓ 저장됨' : '저장'}
          </button>
        )}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 border px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <Printer size={14} /> 인쇄
        </button>
        {planSubmitted && completeSubmit && (
          <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
            <Check size={14} /> 이행완료
          </span>
        )}
      </div>
    </div>
  )
}
