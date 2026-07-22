'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, ImagePlus, Trash2 } from 'lucide-react'
import {
  saveFirePlanSectionsAction, uploadPlanAssetAction, deletePlanAssetAction, getPlanAssetUrlAction,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'

/** 서식 1.3 건축물 위치·운영현황 및 소방차 세부진입 계획 — 섹션 카드 2개 (소방계획서_4.md §3)
 *  sections.location(위치도·주변 현황·관할 소방서·거리·도착예상·운영 개요) + sections.fireAccess(진입경로·경로도·진입장소·주변 소방시설) */

export type LocationSection = { mapImage: string | null; surroundings: string; fireStation: string; distance: string; eta: string; operation: string }
export type FireAccessSection = { routeDesc: string; routeImage: string | null; entryPoint: string; nearbyFacilities: string }

export function ImageSlot({ customerId, canManage, path, onChange, label }: {
  customerId: string
  canManage: boolean
  path: string | null
  onChange: (path: string | null) => void
  label: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!path) return
    let alive = true
    getPlanAssetUrlAction(customerId, path).then(r => { if (alive && r.url) setSigned({ path, url: r.url }) })
    return () => { alive = false }
  }, [customerId, path])
  const url = path && signed?.path === path ? signed.url : null

  async function upload(file: File) {
    setBusy(true)
    setErr('')
    const fd = new FormData()
    fd.set('file', file)
    const res = await uploadPlanAssetAction(customerId, fd)
    setBusy(false)
    if (res.error || !res.path) { setErr(res.error ?? '업로드 실패'); return }
    if (path) await deletePlanAssetAction(customerId, path)
    onChange(res.path)
  }
  async function remove() {
    if (!path) return
    setBusy(true)
    await deletePlanAssetAction(customerId, path)
    setBusy(false)
    onChange(null)
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-[#514b81] mb-1">{label}</p>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="max-h-40 rounded-lg border border-[#e0ddf5]" />
      ) : (
        <p className="text-[11px] text-[#b0acd6]">{path ? '미리보기 로딩…' : '이미지 없음'}</p>
      )}
      {canManage && (
        <div className="flex items-center gap-2 mt-1">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />} {path ? '교체' : '업로드'}
          </button>
          {path && (
            <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#e0ddf5] text-[11px] text-[#b0acd6] hover:text-red-500">
              <Trash2 className="size-3" /> 삭제
            </button>
          )}
          {err && <span className="text-[11px] text-red-500">{err}</span>}
        </div>
      )}
    </div>
  )
}

export function PlanForm13({ customerId, canManage, initialLocation, initialFireAccess }: {
  customerId: string
  canManage: boolean
  initialLocation: LocationSection
  initialFireAccess: FireAccessSection
}) {
  const router = useRouter()
  const [loc, setLoc] = useState(initialLocation)
  const [fa, setFa] = useState(initialFireAccess)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  function patchLoc(p: Partial<LocationSection>) { setLoc(v => ({ ...v, ...p })); setDirty(true) }
  function patchFa(p: Partial<FireAccessSection>) { setFa(v => ({ ...v, ...p })); setDirty(true) }

  function save() {
    startTransition(async () => {
      const res = await saveFirePlanSectionsAction(customerId, { location: loc, fireAccess: fa })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setDirty(false)
      setMsg('✅ 서식 1.3 저장됨')
      router.refresh()
    })
  }

  const inputCls = 'h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]'
  const taCls = 'w-full rounded-lg border border-[#d0ccf5] bg-white px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] resize-y'
  return (
    <div className="space-y-4">
      {/* 위치·운영현황 (2.1+2.2) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">건축물 위치·운영현황</p>
        <ImageSlot customerId={customerId} canManage={canManage} path={loc.mapImage}
          onChange={p => patchLoc({ mapImage: p })} label="위치도 (지도 이미지)" />
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">주변 현황</label>
          <textarea value={loc.surroundings} onChange={e => patchLoc({ surroundings: e.target.value })} disabled={!canManage}
            rows={2} placeholder="인접 건물·도로 등 주변 현황" className={taCls} />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">관할 소방서</label>
            <input value={loc.fireStation} onChange={e => patchLoc({ fireStation: e.target.value })} disabled={!canManage} className={`${inputCls} w-36`} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">거리(km)</label>
            <input value={loc.distance} onChange={e => patchLoc({ distance: e.target.value })} disabled={!canManage} inputMode="decimal" className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#514b81] block mb-1">도착 예상(분)</label>
            <input value={loc.eta} onChange={e => patchLoc({ eta: e.target.value })} disabled={!canManage} inputMode="numeric" className={`${inputCls} w-24`} />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">운영 개요</label>
          <textarea value={loc.operation} onChange={e => patchLoc({ operation: e.target.value })} disabled={!canManage}
            rows={2} placeholder="건물 운영 개요 (용도·운영시간 등)" className={taCls} />
        </div>
      </div>

      {/* 소방차 진입 (2.3+2.4) */}
      <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">소방차 세부진입 계획</p>
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">진입경로 서술</label>
          <textarea value={fa.routeDesc} onChange={e => patchFa({ routeDesc: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: ○○로에서 정문 방면 진입 후 우측 주차장" className={taCls} />
        </div>
        <ImageSlot customerId={customerId} canManage={canManage} path={fa.routeImage}
          onChange={p => patchFa({ routeImage: p })} label="진입 경로도 (이미지)" />
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">진입 장소</label>
          <input value={fa.entryPoint} onChange={e => patchFa({ entryPoint: e.target.value })} disabled={!canManage}
            placeholder="예: 정문 앞 도로, 후문 주차장" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#514b81] block mb-1">주변 소방시설 현황</label>
          <textarea value={fa.nearbyFacilities} onChange={e => patchFa({ nearbyFacilities: e.target.value })} disabled={!canManage}
            rows={2} placeholder="예: 정문 앞 지상식 소화전 1개소" className={taCls} />
        </div>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={!dirty || isPending}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 서식 1.3 저장
          </button>
          {msg && <span className="text-xs text-[#514b81]">{msg}</span>}
        </div>
      )}
    </div>
  )
}
