'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BookMarked, Loader2, Save } from 'lucide-react'
import { saveFirePlanSectionsAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { useUnsavedWarning } from '@/components/ui/fields'

/** 보고서 커버 (2026-08-10 사용자 요청) — 생성 문서 마지막 페이지에 업체명·연도 표기.
 *  생성 바의 연도 입력칸 폐지와 짝: 연도 표기의 단일 지점이 이 서식이다.
 *  빈 값은 생성 시 자동값(업체명=고객명, 연도=생성 연도)으로 렌더되므로 미입력이어도 커버는 항상 나온다 —
 *  그래서 필수 완성도 분모에는 넣지 않는다 (sections.reportCover). */

export type ReportCoverSection = { company?: string; year?: string; sub?: string }

export function PlanFormCover({ customerId, canManage, initial, defaults }: {
  customerId: string
  canManage: boolean
  initial: ReportCoverSection
  /** 자동값 미리보기 — 업체명=고객명, 연도=올해 (서버 생성 폴백과 동일 규약) */
  defaults: { company: string; year: string }
}) {
  const router = useRouter()
  const [v, setV] = useState<ReportCoverSection>({ company: '', year: '', sub: '', ...initial })
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  useUnsavedWarning(dirty, save) // 이탈 경고 + 이동 확인창 [저장하고 이동]

  function patch(p: Partial<ReportCoverSection>) { setV(x => ({ ...x, ...p })); setDirty(true) }
  /** 반환 Promise는 이동 확인창이 저장 완료를 기다리는 용도 (true=성공) */
  function save(): Promise<boolean> {
    return new Promise(resolve => {
      startTransition(async () => {
        const res = await saveFirePlanSectionsAction(customerId, {
          reportCover: { company: (v.company ?? '').trim(), year: (v.year ?? '').trim(), sub: (v.sub ?? '').trim() },
        })
        if (res.error) { setMsg(`❌ ${res.error}`); resolve(false); return }
        setDirty(false)
        setMsg('✅ 보고서 커버 저장됨')
        router.refresh()
        resolve(true)
      })
    })
  }

  const inputCls = 'h-7 rounded border border-[#d0ccf5] bg-white px-1.5 text-xs outline-none focus:border-[#7b68ee]'
  const shownYear = (v.year ?? '').trim() || defaults.year
  const shownCompany = (v.company ?? '').trim() || defaults.company

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BookMarked className="size-4 text-[#7b68ee]" />
          <p className="text-xs font-semibold text-[#514b81]">보고서 커버</p>
          <span className="text-[11px] text-[#b0acd6] ml-auto">생성 문서 마지막 페이지 — 비워 두면 자동값</span>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-[10px] text-[#b0acd6] block">업체명 (기본: 고객명)</label>
            <input id="cover-company" value={v.company ?? ''} disabled={!canManage} placeholder={defaults.company}
              onChange={e => patch({ company: e.target.value })} className={`${inputCls} w-64`} />
          </div>
          <div>
            <label className="text-[10px] text-[#b0acd6] block">연도 (기본: 생성 연도)</label>
            <input id="cover-year" value={v.year ?? ''} disabled={!canManage} placeholder={defaults.year}
              inputMode="numeric" onChange={e => patch({ year: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })}
              className={`${inputCls} w-20`} />
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-[10px] text-[#b0acd6] block">부기 문구 (선택 — 비우면 업무대행 회사명)</label>
            <input id="cover-sub" value={v.sub ?? ''} disabled={!canManage} placeholder="예: 소방안전관리 업무대행 ○○소방(주)"
              onChange={e => patch({ sub: e.target.value })} className={`${inputCls} w-full`} />
          </div>
        </div>
      </div>

      {/* 미리보기 — 생성 커버 페이지와 같은 배치(중앙 대형 타이포) */}
      <div className="rounded-xl border border-dashed border-[#d0ccf5] bg-white px-4 py-8 text-center">
        <p className="text-sm text-[#514b81]">{shownYear}년도</p>
        <p className="text-2xl font-bold tracking-[0.4em] text-[#090c1d] my-3">소방계획서</p>
        <p className="text-base text-[#090c1d]">[ {shownCompany} ]</p>
        {(v.sub ?? '').trim() && <p className="text-xs text-[#514b81] mt-2">{(v.sub ?? '').trim()}</p>}
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={() => { void save() }} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 보고서 커버 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
