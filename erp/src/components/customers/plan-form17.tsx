'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Save, Plus, Trash2, ExternalLink } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { TableWrap, useUnsavedWarning } from '@/components/ui/fields'
import { DateInput } from '@/components/ui/date-input'

/** 서식 1.7 소방안전관리(보조)자 등 일반현황 (1.7.1 선임현황) — sections.managers (소방계획서_4.md §3)
 *
 *  2026-08-20부터 **보조자 전용**이다. 주 선임자(소방안전관리자)는 관계인 탭 [소방안전관리]가 정본이고,
 *  여기 첫 줄에는 그 값을 읽어 보여주기만 한다(수정은 거기서). 종전에는 성명·선임일이 이 표에도,
 *  customers 컬럼에도 있어서 어느 쪽이 문서에 나가는지가 서식마다 달랐다 —
 *  별지 9호는 customers를, 소방계획서는 이 표를 읽었다.
 *
 *  인쇄되는 1.7 표는 조립 시점에 [주 선임자 1행 + 여기 보조자들]로 합성된다(lib/fire-plan-generate). */

export type ManagerRow = { role: string; affiliation: string; name: string; selectedAt: string; eduAt: string; duty: string }

export function PlanForm17({ customerId, canManage, initialRows, initialEmergency = '', autoRow }: {
  customerId: string
  canManage: boolean
  initialRows: ManagerRow[]
  /** M-18(소방계획서_15): 비상연락체계 텍스트(sections.emergencyContact) — 서식 2.2 아래 인쇄 */
  initialEmergency?: string
  /** 주 선임자 — 관계인 탭 [소방안전관리]에서 온 읽기 전용 표시값 */
  autoRow: { name: string; selectedAt: string }
}) {
  const router = useRouter()
  // 보조자만 편집한다 — 과거에 저장된 관리자 행은 화면에서 감추고 저장에서도 뺀다(합성으로 인쇄되므로 유실 아님)
  const [rows, setRows] = useState<ManagerRow[]>(initialRows.filter(r => (r.role ?? '').includes('보조')))
  const [emergency, setEmergency] = useState(initialEmergency)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function set(i: number, p: Partial<ManagerRow>) {
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...p } : r)))
    setDirty(true)
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          // 구분을 강제로 '보조자'로 못박는다 — 이 표는 보조자 전용이고,
          // 인쇄 시 합성부(fire-plan-generate)가 role에 '보조'가 든 행만 골라 쓴다
          managers: rows.filter(r => r.name.trim()).map(r => ({ ...r, role: '보조자' })),
          emergencyContact: emergency.trim(),
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.7 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-form-7 rounded border border-brand-line bg-surface px-1.5 text-form-sm outline-none focus:border-brand w-full'
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <p className="text-form-sm font-semibold text-ink-sub mb-2">1.7.1 소방안전관리(보조)자 선임현황
          <span className="font-normal text-ink-meta ml-2">여기서는 <b>보조자</b>만 입력합니다</span>
        </p>
        {/* 주 선임자 — 관계인 탭이 정본. 읽기 전용으로 보여주고 고치러 갈 곳을 알려준다 */}
        <div className="mb-2 flex items-center gap-2 flex-wrap rounded-lg border border-brand-line-soft bg-surface px-3 py-2 text-form-sm">
          <span className="text-form-xs font-medium text-ink-sub">소방안전관리자</span>
          {autoRow.name
            ? <><span className="font-medium text-ink">{autoRow.name}</span>
              {autoRow.selectedAt && <span className="text-ink-meta">선임 {autoRow.selectedAt}</span>}</>
            : <span className="text-amber-600">미지정</span>}
          <Link href={`/customers/${customerId}?tab=contacts#c-fire-safety-manager`}
            className="ml-auto text-form-xs text-brand hover:underline inline-flex items-center gap-0.5">
            관계인 탭에서 수정 <ExternalLink className="size-2.5" />
          </Link>
        </div>
        {rows.length === 0 && (
          <p className="text-form-xs text-ink-meta py-1">등록된 보조자가 없습니다 — 선임된 보조자가 있으면 아래에서 추가하세요</p>
        )}
        <TableWrap><table className="w-full text-form-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-form-xs text-ink-sub border-b border-brand-line-soft">
              <th className="pb-1 pr-1 w-20 font-medium">구분</th>
              <th className="pb-1 pr-1 w-24 font-medium">소속</th>
              <th className="pb-1 pr-1 w-20 font-medium">성명</th>
              <th className="pb-1 pr-1 w-28 font-medium">선임일자</th>
              <th className="pb-1 pr-1 w-28 font-medium">실무교육 수료일</th>
              <th className="pb-1 pr-1 font-medium">담당 업무</th>
              <th className="pb-1 w-7" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {/* 구분은 보조자로 고정 — 관리자는 관계인 탭이 정본이라 여기서 만들 수 없다 */}
                <td className="py-0.5 pr-1"><span className="text-ink-sub">보조자</span></td>
                <td className="py-0.5 pr-1"><input value={r.affiliation} disabled={!canManage} onChange={e => set(i, { affiliation: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={r.name} disabled={!canManage} onChange={e => set(i, { name: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><DateInput value={r.selectedAt} disabled={!canManage} onChange={e => set(i, { selectedAt: e.target.value })} className="h-form-7 text-form-sm" /></td>
                <td className="py-0.5 pr-1"><DateInput value={r.eduAt} disabled={!canManage} onChange={e => set(i, { eduAt: e.target.value })} className="h-form-7 text-form-sm" /></td>
                <td className="py-0.5 pr-1"><input value={r.duty} disabled={!canManage} onChange={e => set(i, { duty: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5">
                  {canManage && (
                    <button onClick={() => { setRows(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                      className="text-ink-meta hover:text-red-500" aria-label="행 삭제">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></TableWrap>
        {canManage && (
          <button onClick={() => { setRows(p => [...p, { role: '보조자', affiliation: '', name: '', selectedAt: '', eduAt: '', duty: '' }]); setDirty(true) }}
            className="mt-2 inline-flex items-center gap-1 text-form-xs text-brand hover:underline">
            <Plus className="size-3" /> 보조자 추가
          </button>
        )}
      </div>

      {/* M-18(소방계획서_15, 2026-08-11 보강): 비상연락체계 — 서식 2.2 편성표 아래에 인쇄된다 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <p className="text-form-sm font-semibold text-ink-sub mb-2">비상연락체계
          <span className="font-normal text-ink-meta ml-2">연락망·전파 순서를 자유롭게 기재 — 제2장 편성표(서식 2.2) 아래에 인쇄</span>
        </p>
        <textarea value={emergency} disabled={!canManage} rows={3}
          placeholder={'예: 발견자 → 자위소방대장(010-…) → 관계인 대표 → 119\n야간·휴일: 당직자 → 관리자'}
          onChange={e => { setEmergency(e.target.value); setDirty(true) }}
          className="w-full rounded border border-brand-line bg-surface px-2 py-1.5 text-form-sm outline-none focus:border-brand resize-y" />
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg bg-brand text-white text-form-sm font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.7 저장
          </button>
          {msg && <span className="text-form-sm text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
