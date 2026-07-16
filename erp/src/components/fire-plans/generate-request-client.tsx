'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import Link from 'next/link'
import { FileOutput, Search, Loader2, CheckCircle2, XCircle, Clock, Wifi, WifiOff, X } from 'lucide-react'
import {
  searchCustomersForPlanAction, requestFirePlanHwpAction, getFirePlanGenStatusAction,
  getFirePlanReadinessAction, type GenStatus,
} from '@/app/(dashboard)/fire-plans/generate/actions'
import type { FirePlanReadiness } from '@/lib/fire-plan-readiness'
import { PRESET_TYPES, recommendPresetType, type PresetType } from '@/lib/fire-plan-presets'
import { FirePlanPresetManager } from '@/components/fire-plans/fire-plan-preset-manager'

type Candidate = { id: string; name: string; type: string; purpose: string | null }

/** 소방계획서 HWP 생성 요청 화면 — 고객 검색(다중 선택) → 프리셋 선택 → 요청 → 워커 처리 상태 5초 폴링
 *  7차: 공통 수기 프리셋(용도 기반 자동 추천) + 프리셋 공유 고객 일괄 생성 */
export function FirePlanGenerateRequestClient({ initialStatus }: { initialStatus: GenStatus }) {
  const [q, setQ] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Candidate[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [preset, setPreset] = useState<PresetType | ''>('')
  const presetTouched = useRef(false)
  const [status, setStatus] = useState<GenStatus>(initialStatus)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [readiness, setReadiness] = useState<Record<string, FirePlanReadiness>>({})
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 사전 체크(설계 §5-2): 고객 선택 시 준비율·누락 항목 조회 — 누락이 있어도 생성 가능(빈 칸 허용)
  useEffect(() => {
    const need = selected.filter(c => !(c.id in readiness)).map(c => c.id)
    if (need.length === 0) return
    getFirePlanReadinessAction(need)
      .then(r => setReadiness(prev => ({ ...prev, ...Object.fromEntries(r.readiness.map(x => [x.id, x])) })))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // 고객 검색 (300ms 디바운스, 빈 검색어는 즉시 비움)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      if (!q.trim()) { setCandidates([]); return }
      searchCustomersForPlanAction(q).then(r => setCandidates(r.customers)).catch(() => setCandidates([]))
    }, q.trim() ? 300 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q])

  // 상태 5초 폴링
  useEffect(() => {
    const t = setInterval(() => {
      getFirePlanGenStatusAction().then(setStatus).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [])

  function addCustomer(c: Candidate) {
    setQ('')
    setCandidates([])
    setSelected(prev => prev.some(s => s.id === c.id) ? prev : [...prev, c])
    // 프리셋 자동 추천 (용도 기반) — 사용자가 직접 바꾼 뒤에는 유지
    if (!presetTouched.current) setPreset(recommendPresetType(c.purpose))
  }

  function request() {
    if (selected.length === 0) return
    setMessage('')
    startTransition(async () => {
      const res = await requestFirePlanHwpAction(selected.map(s => s.id), year, preset)
      if (res.error) { setMessage(`❌ ${res.error}`); return }
      setMessage(`✅ ${selected.length}건 생성 요청됨 (${year}년${preset ? ` · ${preset} 프리셋` : ''}) — 아래 상태에서 진행을 확인하세요`)
      setSelected([])
      const s = await getFirePlanGenStatusAction()
      setStatus(s)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileOutput className="size-6 text-[#7b68ee]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#090c1d]">소방계획서 HWP 생성</h1>
          <p className="text-sm text-[#514b81] mt-0.5">고객을 선택하면 표준양식(한글 SDK)으로 HWP·PDF를 생성해 보관함에 등록합니다</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${
          status.workerOnline ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
        }`}>
          {status.workerOnline ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          생성기 {status.workerOnline ? '온라인' : '오프라인'}
        </span>
      </div>

      {!status.workerOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          생성기(사무실 PC의 워커)가 꺼져 있습니다 — 요청은 접수되며 워커가 켜지면 순서대로 처리됩니다.
          <span className="text-xs block mt-1 text-amber-600">워커 실행: 개발 PC에서 <code>python scripts/fireplan-worker.py</code></span>
        </div>
      )}

      {/* 요청 폼 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-5 space-y-3">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="relative w-80">
            <label className="text-xs font-medium text-[#514b81]">고객명 (여러 명 선택 가능)</label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
              <input value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="고객명 입력 (부분 검색)"
                className="h-9 w-full rounded-lg border border-[#d0ccf5] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#7b68ee]" />
            </div>
            {candidates.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-[#d0ccf5] rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {candidates.map(c => (
                  <button key={c.id}
                    onClick={() => addCustomer(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#f5f4ff] flex items-center justify-between gap-2">
                    <span className="text-[#090c1d]">{c.name}</span>
                    <span className="text-xs text-[#b0acd6] shrink-0">
                      {c.purpose ? `${c.purpose} · ` : ''}{c.type} · 추천 {recommendPresetType(c.purpose)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-[#514b81]">연도</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value || '0', 10))}
              className="h-9 w-24 mt-1 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm outline-none focus:border-[#7b68ee]" />
          </div>
          <div>
            <label className="text-xs font-medium text-[#514b81]">공통 수기 프리셋</label>
            <select value={preset}
              onChange={e => { presetTouched.current = true; setPreset(e.target.value as PresetType | '') }}
              className="h-9 mt-1 rounded-lg border border-[#d0ccf5] bg-white px-2 text-sm outline-none focus:border-[#7b68ee]">
              <option value="">사용 안 함 (양식 기본값)</option>
              {PRESET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={request} disabled={selected.length === 0 || isPending}
            className="h-9 px-5 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <FileOutput className="size-4" />}
            HWP 생성 요청{selected.length > 1 ? ` (${selected.length}건)` : ''}
          </button>
        </div>
        {selected.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {selected.map(c => {
              const r = readiness[c.id]
              return (
                <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-[#f5f4ff] border border-[#d0ccf5] pl-3 pr-1.5 py-1 text-xs text-[#090c1d]">
                  {c.name}
                  {c.purpose && <span className="text-[#b0acd6]">({c.purpose})</span>}
                  {r && (
                    <span className={`text-[10px] ${r.missing.length > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {r.done}/{r.total}
                    </span>
                  )}
                  <button onClick={() => setSelected(prev => prev.filter(s => s.id !== c.id))}
                    className="rounded-full p-0.5 hover:bg-[#e8e5fb] text-[#514b81]">
                    <X className="size-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {/* 사전 체크: 누락 항목 안내 — '이대로 생성'(빈 칸 허용) 또는 고객 상세에서 입력 후 생성 (설계 §5-2) */}
        {selected.some(c => (readiness[c.id]?.missing.length ?? 0) > 0) && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
            {selected.filter(c => (readiness[c.id]?.missing.length ?? 0) > 0).map(c => {
              const r = readiness[c.id]!
              return (
                <p key={c.id} className="text-[11px] text-amber-800">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-1.5">준비율 {r.done}/{r.total} · 누락: {r.missing.join(', ')}</span>
                  <Link href={`/customers/${c.id}?tab=plan`} className="text-[#7b68ee] hover:underline ml-1.5">
                    → 입력 후 생성
                  </Link>
                </p>
              )
            })}
            <p className="text-[10px] text-amber-600">누락이 있어도 생성할 수 있습니다 — 해당 항목은 빈 칸으로 출력되고 완료 후 누락 안내에 표시됩니다.</p>
          </div>
        )}
        {message && <p className="text-sm text-[#514b81]">{message}</p>}
        <p className="text-[11px] text-[#b0acd6]">
          자동 병합: 대상물명 · 관할소방서 · 계약기간 + 계획서 정보(고객 상세) — 프리셋 선택 시 훈련 시나리오·피난 절차 등 수기 문구도 유형별로 채워집니다.
          우선순위는 고객 데이터 &gt; 프리셋 &gt; 양식 기본값이며, 완료 시 고객 상세의 소방계획서 보관함에 HWP+PDF가 자동 등록됩니다.
        </p>
      </div>

      {/* 7차: 프리셋 관리 */}
      <FirePlanPresetManager />

      {/* 대기 중 */}
      {status.pending.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c8c4d0] p-5">
          <p className="text-xs font-semibold text-[#514b81] mb-2 flex items-center gap-1">
            <Clock className="size-3.5" /> 처리 대기 {status.pending.length}건
          </p>
          <div className="space-y-1">
            {status.pending.map(p => (
              <div key={p.name} className="flex items-center gap-3 text-sm">
                <Loader2 className="size-3.5 animate-spin text-[#7b68ee]" />
                <span className="font-medium text-[#090c1d]">{p.customerName}</span>
                <span className="text-xs text-[#b0acd6]">
                  {p.year}년 {p.presetType ? `· ${p.presetType} ` : ''}· {p.requestedByName} · {p.requestedAt.slice(11, 16)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 최근 결과 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-5">
        <p className="text-xs font-semibold text-[#514b81] mb-2">최근 생성 결과</p>
        {status.results.length === 0 ? (
          <p className="text-sm text-[#b0acd6]">아직 생성 이력이 없습니다</p>
        ) : (
          <div className="space-y-1.5">
            {status.results.map(r => (
              <div key={r.name} className="flex items-center gap-3 text-sm">
                {r.ok
                  ? <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                  : <XCircle className="size-4 text-red-500 shrink-0" />}
                <span className="font-medium text-[#090c1d]">{r.customerName ?? '(알 수 없음)'}</span>
                <span className="text-xs text-[#b0acd6]">
                  {r.year ? `${r.year}년` : ''} {r.preset ? `· ${r.preset}` : ''} {r.finishedAt ? `· ${r.finishedAt.slice(5, 16).replace('T', ' ')}` : ''}
                </span>
                {r.ok && (r.missing?.length ?? 0) > 0 && (
                  <span className="text-[11px] text-amber-600 truncate">
                    누락: {r.missing!.join(', ')}
                    {r.customerId && (
                      <Link href={`/customers/${r.customerId}?tab=plan`} className="text-[#7b68ee] hover:underline ml-1">
                        → 고객 정보 입력
                      </Link>
                    )}
                  </span>
                )}
                {r.ok && r.customerId && (
                  <Link href={`/customers/${r.customerId}?tab=plan`} className="text-xs text-[#7b68ee] hover:underline ml-auto shrink-0">
                    보관함에서 열기 →
                  </Link>
                )}
                {!r.ok && <span className="text-xs text-red-500 truncate">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
