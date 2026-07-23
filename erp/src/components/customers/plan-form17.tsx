'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { TableWrap, useUnsavedWarning } from '@/components/ui/fields'
import { DateInput } from '@/components/ui/date-input'

/** 서식 1.7 소방안전관리(보조)자 등 일반현황 (1.7.1 선임현황) — sections.managers (소방계획서_4.md §3)
 *  1행은 고객 데이터(소방안전관리자·선임일)로 자동 채움 */

export type ManagerRow = { role: string; affiliation: string; name: string; selectedAt: string; eduAt: string; duty: string }

export function PlanForm17({ customerId, canManage, initialRows, autoRow }: {
  customerId: string
  canManage: boolean
  initialRows: ManagerRow[]
  autoRow: { name: string; selectedAt: string } // 고객 관리자 자동값
}) {
  const router = useRouter()
  const [rows, setRows] = useState<ManagerRow[]>(initialRows.length > 0 ? initialRows : [{
    role: '관리자', affiliation: '', name: autoRow.name, selectedAt: autoRow.selectedAt, eduAt: '', duty: '소방안전관리 업무 총괄',
  }])
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty) // §11-4 이탈 경고
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function set(i: number, p: Partial<ManagerRow>) {
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...p } : r)))
    setDirty(true)
  }
  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, {
        managers: rows.filter(r => r.name.trim()),
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.7 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee] w-full'
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
        <p className="text-xs font-semibold text-[#514b81] mb-2">1.7.1 소방안전관리(보조)자 선임현황
          <span className="font-normal text-[#b0acd6] ml-2">1행은 고객 관리자 정보로 자동 채움</span>
        </p>
        <TableWrap><table className="w-full text-xs min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] text-[#514b81] border-b border-[#e0ddf5]">
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
                <td className="py-0.5 pr-1">
                  <select value={r.role} disabled={!canManage} onChange={e => set(i, { role: e.target.value })}
                    className="h-7 w-full rounded border border-[#d0ccf5] bg-white px-1 text-xs outline-none">
                    <option value="관리자">관리자</option>
                    <option value="보조자">보조자</option>
                  </select>
                </td>
                <td className="py-0.5 pr-1"><input value={r.affiliation} disabled={!canManage} onChange={e => set(i, { affiliation: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={r.name} disabled={!canManage} onChange={e => set(i, { name: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5 pr-1"><DateInput value={r.selectedAt} disabled={!canManage} onChange={e => set(i, { selectedAt: e.target.value })} className="h-7 text-xs" /></td>
                <td className="py-0.5 pr-1"><DateInput value={r.eduAt} disabled={!canManage} onChange={e => set(i, { eduAt: e.target.value })} className="h-7 text-xs" /></td>
                <td className="py-0.5 pr-1"><input value={r.duty} disabled={!canManage} onChange={e => set(i, { duty: e.target.value })} className={inputCls} /></td>
                <td className="py-0.5">
                  {canManage && rows.length > 1 && (
                    <button onClick={() => { setRows(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                      className="text-[#b0acd6] hover:text-red-500" aria-label="행 삭제">
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
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#7b68ee] hover:underline">
            <Plus className="size-3" /> 행 추가
          </button>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.7 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
