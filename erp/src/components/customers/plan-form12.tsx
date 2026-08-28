'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Plus, Trash2, Layers } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { TableWrap, useUnsavedWarning } from '@/components/ui/fields'

/** 서식 1.2 건축물 세부현황 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  1.2.1 구역별 세부현황(sections.zones) + 1.2.2 화재취약장소(sections.hazards), 저장 버튼은 서식당 1개(§1) */

export type ZoneRow = { zone: string; name: string; area: string; workersWeekday: string; workersHoliday: string; company: string; phone: string }
export type HazardRow = { place: string; loc: string; risks: string[] }

const RISKS = ['전기', '기계', '화학', '가스누출', '부주의', '자연재해'] as const
const HAZARD_PRESETS: HazardRow[] = [
  { place: '보일러실', loc: '', risks: ['기계', '가스누출'] },
  { place: '주방', loc: '', risks: ['가스누출', '부주의'] },
  { place: '전기실', loc: '', risks: ['전기'] },
]
const EMPTY_ZONE: ZoneRow = { zone: '', name: '', area: '', workersWeekday: '', workersHoliday: '', company: '', phone: '' }

export function PlanForm12({ customerId, canManage, initialZones, initialHazards, floorsAbove, floorsBelow, purpose }: {
  customerId: string
  canManage: boolean
  initialZones: ZoneRow[]
  initialHazards: HazardRow[]
  floorsAbove: number | null
  floorsBelow: number | null
  /** 건물 주용도 — [층 자동 생성] 시 명칭/용도 기본값(2026-08-06, 1.2.2 프리셋과 같은 취지) */
  purpose?: string | null
}) {
  const router = useRouter()
  const [zones, setZones] = useState<ZoneRow[]>(initialZones.length > 0 ? initialZones : [{ ...EMPTY_ZONE }])
  const [hazards, setHazards] = useState<HazardRow[]>(initialHazards)
  const [dirty, setDirty] = useState(false)
  useUnsavedWarning(dirty, save) // §11-4 이탈 경고 + 이동 확인창 [저장하고 이동]
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function setZone(i: number, patch: Partial<ZoneRow>) {
    setZones(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  function setHazard(i: number, patch: Partial<HazardRow>) {
    setHazards(p => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  function toggleRisk(i: number, risk: string) {
    setHazards(p => p.map((r, j) => j === i
      ? { ...r, risks: r.risks.includes(risk) ? r.risks.filter(x => x !== risk) : [...r.risks, risk] }
      : r))
    setDirty(true)
  }
  /** 층 목록 일괄 생성 — 기존 행을 '대체'한다([행 추가]는 빈 행 1개만 덧붙임, 역할이 다름).
   *  명칭/용도는 건물 주용도로 미리 채워 빈 표가 아니라 고칠 예시가 보이게 한다(2026-08-06). */
  function autoFloors() {
    const fa = floorsAbove ?? 0
    const fb = floorsBelow ?? 0
    if (fa + fb === 0) { setMsg('⚠ 건물 층수가 없습니다 — 건물·시설 탭에서 층수를 먼저 입력해주세요.'); return }
    // 덮어쓰기 경고 — 입력분이 있는데 경고 없이 날아가던 문제(2026-08-06)
    const hasInput = zones.some(z => Object.values(z).some(v => String(v).trim()))
    if (hasInput && !window.confirm('입력한 구역 내용이 새 층 목록으로 모두 대체됩니다. 계속할까요?')) return
    const name = (purpose ?? '').trim()
    const rows: ZoneRow[] = []
    for (let i = fb; i >= 1; i--) rows.push({ ...EMPTY_ZONE, zone: `지하 ${i}층`, name })
    for (let i = 1; i <= fa; i++) rows.push({ ...EMPTY_ZONE, zone: `지상 ${i}층`, name })
    setZones(rows)
    setDirty(true)
    setMsg(name
      ? `✅ ${rows.length}개 층 생성 — 명칭/용도를 건물 용도(${name})로 채웠습니다. 층별로 수정하세요`
      : `✅ ${rows.length}개 층 생성 — 명칭/용도·인원을 층별로 입력하세요`)
  }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          zones: zones.filter(z => Object.values(z).some(v => String(v).trim())),
          hazards: hazards.filter(h => h.place.trim() || h.loc.trim() || h.risks.length > 0),
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 서식 1.2 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-7 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand w-full'
  return (
    <div className="space-y-4">
      {/* 1.2.1 구역별 세부현황 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-ink-sub">1.2.1 구역별 세부현황</p>
          {canManage && (
            <button onClick={autoFloors} className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
              <Layers className="size-3" /> 층 자동 생성
            </button>
          )}
        </div>
        <TableWrap><table className="w-full text-xs min-w-[560px]">
          <thead>
            {/* 머리글은 서식 1.2.1 원문 표기에 맞춤 — 인원은 '주간/야간' 두 값을 한 칸에 적는 서식이다
                (fire-plan-template.ts: 인원 평일(주간/야간)). 기존 '평일(명)'은 단일 숫자로 오해를 유발했다. */}
            <tr className="text-left text-[11px] text-ink-sub border-b border-brand-line-soft">
              <th className="pb-1 pr-1 w-24 font-medium">구역별(동/층)</th>
              <th className="pb-1 pr-1 font-medium">명칭/용도</th>
              <th className="pb-1 pr-1 w-20 font-medium">(바닥)면적</th>
              <th className="pb-1 pr-1 w-20 font-medium">평일 인원<br /><span className="font-normal text-ink-faint">주간/야간</span></th>
              <th className="pb-1 pr-1 w-20 font-medium">휴일 인원<br /><span className="font-normal text-ink-faint">주간/야간</span></th>
              <th className="pb-1 pr-1 font-medium">관리주체(입주사)</th>
              <th className="pb-1 pr-1 w-32 font-medium">담당자(연락처)</th>
              <th className="pb-1 w-7" />
            </tr>
          </thead>
          <tbody>
            {zones.map((z, i) => (
              <tr key={i}>
                {/* 예시(placeholder) — 1.2.2 화재취약장소와 달리 안내가 전혀 없어 빈 표가 막막했다(2026-08-06).
                    인원은 서식이 '주간/야간'을 한 칸에 받으므로 숫자 전용 키패드(inputMode)를 걸지 않는다. */}
                <td className="py-0.5 pr-1"><input value={z.zone} onChange={e => setZone(i, { zone: e.target.value })} disabled={!canManage} placeholder="예: 지상 1층" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.name} onChange={e => setZone(i, { name: e.target.value })} disabled={!canManage} placeholder="예: 사무실" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.area} onChange={e => setZone(i, { area: e.target.value })} disabled={!canManage} inputMode="decimal" placeholder="예: 250" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.workersWeekday} onChange={e => setZone(i, { workersWeekday: e.target.value })} disabled={!canManage} placeholder="예: 10/2" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.workersHoliday} onChange={e => setZone(i, { workersHoliday: e.target.value })} disabled={!canManage} placeholder="예: 0/1" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.company} onChange={e => setZone(i, { company: e.target.value })} disabled={!canManage} placeholder="예: 승진소방" className={inputCls} /></td>
                <td className="py-0.5 pr-1"><input value={z.phone} onChange={e => setZone(i, { phone: e.target.value })} disabled={!canManage} placeholder="예: 홍길동 031-000-0000" className={inputCls} /></td>
                <td className="py-0.5">
                  {canManage && (
                    <button onClick={() => { setZones(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-ink-faint hover:text-red-500" aria-label="행 삭제">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></TableWrap>
        {canManage && (
          <button onClick={() => { setZones(p => [...p, { ...EMPTY_ZONE }]); setDirty(true) }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
            <Plus className="size-3" /> 행 추가
          </button>
        )}
      </div>

      {/* 1.2.2 화재취약장소 */}
      <div className="rounded-xl border border-brand-line-soft bg-brand-tint p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <p className="text-xs font-semibold text-ink-sub">1.2.2 화재취약장소</p>
          {canManage && HAZARD_PRESETS.map(pz => (
            <button key={pz.place}
              onClick={() => { setHazards(p => [...p, { ...pz, risks: [...pz.risks] }]); setDirty(true) }}
              className="h-6 px-2 rounded-full border border-brand-line text-[11px] text-brand hover:bg-brand-tint">
              + {pz.place}
            </button>
          ))}
        </div>
        {hazards.length === 0 && <p className="text-[11px] text-ink-faint">프리셋 버튼 또는 [행 추가]로 화재취약장소를 등록하세요.</p>}
        <div className="space-y-1.5">
          {hazards.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-wrap">
              <input value={h.place} onChange={e => setHazard(i, { place: e.target.value })} disabled={!canManage}
                placeholder="장소" className="h-7 w-28 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />
              <input value={h.loc} onChange={e => setHazard(i, { loc: e.target.value })} disabled={!canManage}
                placeholder="위치 (예: 지하 1층)" className="h-7 w-32 rounded border border-brand-line bg-surface px-1.5 text-xs outline-none focus:border-brand" />
              {RISKS.map(r => (
                <button key={r} onClick={() => canManage && toggleRisk(i, r)} disabled={!canManage}
                  className={`h-6 px-2 rounded-full text-[11px] border transition-colors ${
                    h.risks.includes(r) ? 'bg-brand text-white border-brand' : 'border-brand-line text-ink-sub hover:bg-brand-tint'
                  }`}>
                  {r}
                </button>
              ))}
              {canManage && (
                <button onClick={() => { setHazards(p => p.filter((_, j) => j !== i)); setDirty(true) }} className="text-ink-faint hover:text-red-500" aria-label="행 삭제">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <button onClick={() => { setHazards(p => [...p, { place: '', loc: '', risks: [] }]); setDirty(true) }}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
            <Plus className="size-3" /> 행 추가
          </button>
        )}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-brand text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.2 저장
          </button>
          {msg && <span className="text-xs text-ink-sub">{msg}</span>}
        </div>
      )}
    </div>
  )
}
