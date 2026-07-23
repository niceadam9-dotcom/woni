'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, Sparkles, FolderOpen, Loader2, Clock3 } from 'lucide-react'
import { requestReport9Action } from '@/app/(dashboard)/inspections/report9-actions'

/** 보고서 센터 ②③ 바로 생성 목록 (소방계획서_5 R3·R4) —
 *  ② 별지 9호(mode=report9) / ③ 이행계획·완료 10·11호(mode=report1011, 불량 보유 건).
 *  인라인 [바로 생성] + 상태 필터 + 최근 완료 우선. HWP/PDF 받기는 문서 현황(R2)으로 연결(단일 큐·보관함 공유). */

export type GenRow = {
  id: string
  customerId: string
  customerName: string
  year: number
  sequenceNum: number
  inspectionType: string
  status: string
  startDate: string | null
  gen9: number
  gen10: number
  gen11: number
  defectsTotal: number
  defectsDone: number
  due9Dday: number | null   // 별지 9호 제출 기한 D-day (미제출 시)
}

const STATUS_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'completed', label: '완료' },
  { key: 'in_progress', label: '진행중' },
] as const

const statusLabel = (s: string) => (s === 'completed' ? '완료' : s === 'in_progress' ? '진행중' : '예정')

export function ReportGenList({ mode, rows }: { mode: 'report9' | 'report1011'; rows: GenRow[] }) {
  const [filter, setFilter] = useState<typeof STATUS_FILTERS[number]['key']>('all')
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null)
  // R3-c: fail-soft 확인은 세션당 1회
  const [confirmedFailSoft, setConfirmedFailSoft] = useState(false)

  const filtered = rows.filter(r => filter === 'all' || r.status === filter)

  function generate(row: GenRow, kind: 'report9' | 'report10' | 'report11') {
    // R3-c/R4-b: 미비 상태 생성은 세션당 1회 확인
    const needsConfirm =
      (kind === 'report9' && row.gen9 === 0 && row.status !== 'completed') ||
      (kind === 'report11' && row.defectsDone < row.defectsTotal)
    if (needsConfirm && !confirmedFailSoft) {
      const label = kind === 'report11' ? '조치가 완료되지 않았습니다' : '점검이 완료 처리되지 않았습니다'
      if (!window.confirm(`${label} — 빈 칸은 비운 채로 생성할까요? (이번 세션에서 다시 묻지 않습니다)`)) return
      setConfirmedFailSoft(true)
    }
    setBusyId(row.id + kind)
    startTransition(async () => {
      const res = await requestReport9Action(row.id, kind)
      setBusyId(null)
      if (res.error) { setMsg({ id: row.id, text: `❌ ${res.error}`, ok: false }); return }
      setMsg({ id: row.id, text: '✅ 생성 요청됨 — 워커 처리 후 문서 현황·타임라인에 등록됩니다', ok: true })
    })
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[#b0acd6] py-6 text-center">
        {mode === 'report9' ? '자체점검 건이 없습니다' : '불량 보유 자체점검 건이 없습니다 — 이행계획·완료 대상이 없습니다'}
      </p>
    )
  }

  return (
    <div>
      {/* R3-d 상태 필터 칩 */}
      <div className="flex items-center gap-1 mb-3">
        {STATUS_FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-2 py-0.5 rounded-full text-[11px] border ${filter === f.key
              ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee] font-medium' : 'border-[#d0ccf5] text-[#514b81] hover:border-[#7b68ee]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="divide-y divide-[#eceafd]">
        {filtered.map(r => (
          <div key={r.id} className="py-2.5">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <Link href={`/reports?form=docs&cust=${r.customerId}`} className="font-medium text-[#090c1d] hover:text-[#7b68ee] w-40 truncate">{r.customerName}</Link>
              <span className="text-[#514b81]">{r.year}년 {r.sequenceNum}차 · {r.inspectionType}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${r.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>{statusLabel(r.status)}</span>

              {mode === 'report1011' && (
                <span className="text-amber-600">불량 {r.defectsTotal}건 → 이행계획서(10호) 제출 대상 · 조치 {r.defectsDone}/{r.defectsTotal}</span>
              )}
              {/* R4-a: 제출 기한 D-day 뱃지 */}
              {r.due9Dday !== null && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${r.due9Dday < 0 ? 'text-red-600' : r.due9Dday <= 7 ? 'text-amber-700' : 'text-[#b0acd6]'}`}>
                  <Clock3 className="size-3" /> {r.due9Dday < 0 ? `기한 초과 ${-r.due9Dday}일` : `D-${r.due9Dday}`}
                </span>
              )}

              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                {mode === 'report9' ? (<>
                  {r.gen9 > 0 && <span className="text-[10px] text-[#7b68ee]">생성 {r.gen9}회</span>}
                  <button onClick={() => generate(r, 'report9')} disabled={pending}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium disabled:opacity-50">
                    {busyId === r.id + 'report9' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {r.gen9 > 0 ? '다시 생성' : '바로 생성'}
                  </button>
                </>) : (<>
                  <button onClick={() => generate(r, 'report10')} disabled={pending}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
                    {busyId === r.id + 'report10' ? <Loader2 className="size-3 animate-spin" /> : null}
                    {r.gen10 > 0 ? '10호 다시' : '10호 생성'}
                  </button>
                  <button onClick={() => generate(r, 'report11')} disabled={pending}
                    title={r.defectsDone < r.defectsTotal ? `조치 완료 ${r.defectsDone}/${r.defectsTotal} — 완료 후 생성 권장` : undefined}
                    className={`inline-flex items-center gap-1 h-6 px-2 rounded border text-[11px] disabled:opacity-50 ${r.defectsDone < r.defectsTotal ? 'border-[#eceafd] text-[#b0acd6]' : 'border-[#d0ccf5] text-[#7b68ee] hover:bg-[#f5f4ff]'}`}>
                    {busyId === r.id + 'report11' ? <Loader2 className="size-3 animate-spin" /> : null}
                    {r.gen11 > 0 ? '11호 다시' : '11호 생성'}
                  </button>
                </>)}
                <Link href={`/reports?form=docs&cust=${r.customerId}`} title="HWP/PDF 받기는 문서 현황에서" className="inline-flex items-center gap-0.5 text-[10px] text-[#514b81] hover:text-[#7b68ee]">
                  <FolderOpen className="size-3" /> 문서
                </Link>
                <Link href={`/inspections/${r.id}`} className="text-[#b0acd6] hover:text-[#7b68ee]"><ChevronRight className="size-3.5" /></Link>
              </span>
            </div>
            {/* R3-b: 생성 직후 행 아래 안내 (발송·제출은 타임라인에서) */}
            {msg?.id === r.id && (
              <p className={`text-[11px] mt-1 ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {msg.text}{msg.ok && ' · 발송·제출 기록은 타임라인에서 →'}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
