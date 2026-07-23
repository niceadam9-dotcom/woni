'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight, Upload, Clock3, FileUp, FilePlus2 } from 'lucide-react'
import { DocActionSearch } from '@/components/reports/doc-action-search'
import { CustomerDocsView } from '@/components/reports/customer-docs'
import {
  getCustomerDocsAction, type CustomerDocs, type RecentDoc,
} from '@/app/(dashboard)/reports/docs-actions'
import { uploadTimelineFileAction } from '@/app/(dashboard)/inspections/timeline-actions'
import type { DueReport9Row, MissingCertRow } from '@/lib/doc-status'

/** 보고서 센터 첫 화면 (소방계획서_5 ⓪ R1 + ④ R5 + ⑦ R8) —
 *  검색이 시작·오늘 할 일 우선: 검색창 1개(최상단) → 처리 필요 접힌 뱃지 → (서식 카드는 페이지) → 최근 문서.
 *  고객 선택 시 문서 현황(① R2)이 아래 펼쳐지고 URL 동기화(?form=docs&cust=…). */

const RECENT_KEY = 'reportCenterRecentCustomers'

type RecentChip = { id: string; name: string }

function loadRecentChips(): RecentChip[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentChip[] } catch { return [] }
}

function pushRecentChip(c: RecentChip) {
  const cur = loadRecentChips().filter(x => x.id !== c.id)
  localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...cur].slice(0, 3)))
}

const fmtT = (iso: string) => iso.slice(11, 16)

/** 날짜 구분선 라벨 (R5-a): 오늘 / 어제 / 이번 주 / 그 이전 */
function dayBucket(iso: string, todayYmd: string): string {
  const d = iso.slice(0, 10)
  if (d === todayYmd) return '오늘'
  const y = new Date(todayYmd); y.setDate(y.getDate() - 1)
  if (d === y.toISOString().slice(0, 10)) return '어제'
  const w = new Date(todayYmd); w.setDate(w.getDate() - 7)
  if (d >= w.toISOString().slice(0, 10)) return '이번 주'
  return '이전'
}

const DOC_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'fire_plan', label: '소방계획서' },
  { key: 'report9', label: '9호' },
  { key: 'report1011', label: '10·11호' },
  { key: 'upload', label: '업로드' },
] as const

export function ReportCenterHome({ initialTodo, initialRecent, initialDocs, initialCustId, children }: {
  initialTodo: { dueSoon: DueReport9Row[]; missingCerts: MissingCertRow[] }
  initialRecent: RecentDoc[]
  initialDocs: CustomerDocs | null
  initialCustId: string | null
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [docs, setDocs] = useState<CustomerDocs | null>(initialDocs)
  const [custId, setCustId] = useState<string | null>(initialCustId)
  const [chips, setChips] = useState<RecentChip[]>([])
  const [todoOpen, setTodoOpen] = useState(false)
  const [docFilter, setDocFilter] = useState<typeof DOC_FILTERS[number]['key']>('all')
  const [missingCerts, setMissingCerts] = useState(initialTodo.missingCerts)
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const certFileRef = useRef<HTMLInputElement>(null)
  const certTargetRef = useRef<MissingCertRow | null>(null)

  useEffect(() => { setChips(loadRecentChips()) }, [])
  useEffect(() => {
    if (docs) pushRecentChip({ id: docs.customerId, name: docs.customerName })
  }, [docs])

  function openDocs(customerId: string, customerName: string) {
    setCustId(customerId)
    pushRecentChip({ id: customerId, name: customerName })
    setChips(loadRecentChips())
    // R2-d: URL 동기화 — 새로고침·공유·즐겨찾기
    window.history.replaceState(null, '', `/reports?form=docs&cust=${customerId}`)
    startTransition(async () => {
      const res = await getCustomerDocsAction(customerId)
      if (res.docs) setDocs(res.docs)
    })
  }

  function refetchDocs() {
    if (!custId) return
    startTransition(async () => {
      const res = await getCustomerDocsAction(custId)
      if (res.docs) setDocs(res.docs)
    })
  }

  function uploadCert(row: MissingCertRow) {
    certTargetRef.current = row
    certFileRef.current?.click()
  }

  function onCertPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const target = certTargetRef.current
    e.target.value = ''
    if (!file || !target) return
    const fd = new FormData()
    fd.append('file', file)
    startTransition(async () => {
      const res = await uploadTimelineFileAction(target.inspectionId, 'cert', fd)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ ${target.customerName} 배치확인서 업로드됨`)
      setMissingCerts(prev => prev.filter(r => r.inspectionId !== target.inspectionId))
    })
  }

  const todoCount = initialTodo.dueSoon.length + missingCerts.length
  const todayYmd = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

  const filteredRecent = initialRecent.filter(d => {
    if (docFilter === 'all') return true
    if (docFilter === 'upload') return d.kind === 'upload'
    if (docFilter === 'report1011') return d.docKey === 'report10' || d.docKey === 'report11'
    return d.docKey === docFilter
  })
  let lastBucket = ''

  return (
    <div className="space-y-3">
      {/* 🔍 검색창 — 화면당 1개 원칙 (R1-c) */}
      <DocActionSearch onOpenDocs={openDocs} />
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#b0acd6]">
          최근 조회:
          {chips.map(c => (
            <button key={c.id} onClick={() => openDocs(c.id, c.name)}
              className="px-2 py-0.5 rounded-full border border-[#d0ccf5] text-[#514b81] hover:border-[#7b68ee] hover:text-[#7b68ee]">
              {c.name}
            </button>
          ))}
        </div>
      )}
      <input ref={certFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden" onChange={onCertPicked} />
      {msg && <p className={`text-[11px] ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-600'}`}>{msg}</p>}

      {/* ⚠ 처리 필요 접힌 뱃지 (R8-a + 기한 임박) — 0건이면 미노출 */}
      {todoCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50">
          <button onClick={() => setTodoOpen(v => !v)} className="flex items-center gap-2 w-full px-4 py-2.5 text-xs font-semibold text-amber-800">
            {todoOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <AlertTriangle className="size-3.5" />
            처리 필요 {todoCount}건:
            {initialTodo.dueSoon.length > 0 && <span>제출 기한 임박 {initialTodo.dueSoon.length}</span>}
            {missingCerts.length > 0 && <span>배치확인서 누락 {missingCerts.length}</span>}
          </button>
          {todoOpen && (
            <div className="px-4 pb-3 space-y-1">
              {initialTodo.dueSoon.map(r => (
                <div key={r.inspectionId} className="flex items-center gap-2 text-xs flex-wrap">
                  <Clock3 className="size-3 text-red-500 shrink-0" />
                  <span className="text-[#090c1d] font-medium">{r.customerName}</span>
                  <span className="text-[#514b81]">{r.year}년 {r.sequenceNum}차 · 별지 9호 제출</span>
                  <span className={`font-semibold ${r.dday < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                    {r.dday < 0 ? `기한 초과 ${-r.dday}일` : `D-${r.dday}`} (기한 {r.due})
                  </span>
                  <Link href={`/inspections/${r.inspectionId}`} className="ml-auto text-[11px] text-[#7b68ee] hover:underline">타임라인에서 →</Link>
                </div>
              ))}
              {missingCerts.map(r => (
                <div key={r.inspectionId} className="flex items-center gap-2 text-xs flex-wrap">
                  <FileUp className="size-3 text-amber-600 shrink-0" />
                  <span className="text-[#090c1d] font-medium">{r.customerName}</span>
                  <span className="text-[#514b81]">{r.year}년 {r.sequenceNum}차 · 배치확인서 미업로드</span>
                  {r.daysSince !== null && <span className="text-amber-700">완료 후 {r.daysSince}일 경과</span>}
                  <button onClick={() => uploadCert(r)} disabled={isPending}
                    className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-amber-300 text-[11px] text-amber-800 hover:bg-amber-100">
                    <Upload className="size-3" /> 업로드
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 서식 카드 + 서식별 흐름 (⓪ IA — 검색 아래·문서 현황 위) */}
      {children}

      {/* ① 고객 문서 현황 (R2) — 고객 선택 시 펼침 */}
      {docs && <CustomerDocsView docs={docs} onChanged={refetchDocs} />}

      {/* ④ 최근 문서 (R5) — 기본 표시 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h2 className="text-sm font-semibold text-[#090c1d]">최근 문서</h2>
          <span className="text-[11px] text-[#b0acd6]">생성·업로드 통합 최근 20건</span>
          <span className="ml-auto flex items-center gap-1">
            {DOC_FILTERS.map(f => (
              <button key={f.key} onClick={() => setDocFilter(f.key)}
                className={`px-2 py-0.5 rounded-full text-[11px] border ${docFilter === f.key
                  ? 'border-[#7b68ee] bg-[#f5f4ff] text-[#7b68ee] font-medium' : 'border-[#d0ccf5] text-[#514b81] hover:border-[#7b68ee]'}`}>
                {f.label}
              </button>
            ))}
          </span>
        </div>
        {filteredRecent.length === 0 ? (
          <p className="text-xs text-[#b0acd6] py-4 text-center">최근 생성·업로드된 문서가 없습니다 — 문서는 고객 검색 또는 서식 카드에서 생성하세요</p>
        ) : (
          <div>
            {filteredRecent.map((d, idx) => {
              const bucket = dayBucket(d.at, todayYmd)
              const showDivider = bucket !== lastBucket
              lastBucket = bucket
              return (
                <div key={`${d.at}-${idx}`}>
                  {showDivider && <p className="text-[10px] font-semibold text-[#b0acd6] mt-2 mb-0.5">{bucket}</p>}
                  <div className="flex items-center gap-2 text-xs py-1 border-b border-[#f8f9fa] last:border-0">
                    {d.kind === 'gen'
                      ? <span className="px-1 py-0.5 rounded bg-[#f5f4ff] text-[#7b68ee] text-[10px] font-medium shrink-0"><FilePlus2 className="size-2.5 inline mr-0.5" />생성</span>
                      : <span className="px-1 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium shrink-0"><FileUp className="size-2.5 inline mr-0.5" />업로드</span>}
                    {/* R5-b: 고객명 클릭 → 그 고객 문서 현황 점프 */}
                    {d.customerId ? (
                      <button onClick={() => openDocs(d.customerId!, d.customerName)}
                        className="font-medium text-[#090c1d] hover:text-[#7b68ee] truncate">{d.customerName}</button>
                    ) : (
                      <span className="font-medium text-[#090c1d] truncate">{d.customerName}</span>
                    )}
                    <span className="text-[#514b81] truncate">{d.docLabel}</span>
                    <span className="ml-auto text-[11px] text-[#b0acd6] shrink-0">{d.at.slice(0, 10)} {fmtT(d.at)}</span>
                    {d.inspectionId && (
                      <Link href={`/inspections/${d.inspectionId}`} className="text-[11px] text-[#7b68ee] hover:underline shrink-0">열기 →</Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
