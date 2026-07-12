'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { MessageSquare, ChevronLeft, ChevronRight, X, Check, Search, MapPin, ExternalLink } from 'lucide-react'
import { upsertStatusLogAction, saveSmsAction, getMonitorItemsAction } from '@/app/(dashboard)/inspection-plans/monitor/actions'
import { TableScroll } from '@/components/ui/table-scroll'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { inspectionTypeLabel } from '@/types'

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(d: string | null | undefined) {
  if (!d) return ''
  return d.slice(0, 10)
}
function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  return new Date(dateStr) < new Date()
}
function cellBg(val: string | null | undefined, isRequired = true) {
  if (val) return 'bg-white'
  if (isRequired) return 'bg-red-50 text-red-500'
  return 'bg-white'
}

// ── types ──────────────────────────────────────────────────────────────────
type ContactInfo = { role: string; name: string; phone: string | null }

type MonitorRow = {
  id: string
  inspection_type: string
  sequence_num: number
  scheduled_date: string | null
  assigned_employee_id: string | null
  status: string
  customers: {
    customer_name: string
    customer_code: string
    address: string | null
    is_active?: boolean
    customer_contacts: ContactInfo[]
  } | null
  contacts: ContactInfo | null
  profiles: { name: string } | null
  inspection_plans: { year: number; month: number } | null
  inspection_status_log: {
    inspection_date: string | null
    report_submitted_at: string | null
    sent_at: string | null
    filed_at: string | null
    step5_completed_at: string | null
    step6_completed_at: string | null
    sms_confirmed: boolean
    sms_sent_at: string | null
    sms_content: string | null
  } | null
}

// Supabase가 inspection_status_log를 배열로 반환하는 경우 단일 객체로 정규화
function normalizeItems(raw: Record<string, unknown>[]): MonitorRow[] {
  return raw.map(item => ({
    ...item,
    inspection_status_log: Array.isArray(item.inspection_status_log)
      ? (item.inspection_status_log[0] ?? null)
      : (item.inspection_status_log ?? null),
  })) as unknown as MonitorRow[]
}

/** 수신번호 우선순위: 지정관계인 → 대표 → 직원1 → 직원2 */
function pickContact(row: MonitorRow): ContactInfo | null {
  if (row.contacts?.phone) return row.contacts
  const contacts = row.customers?.customer_contacts ?? []
  const priority = ['대표', '직원1', '직원2']
  for (const role of priority) {
    const c = contacts.find(c => c.role === role && c.phone)
    if (c) return c
  }
  return null
}

// ── 인라인 날짜 셀 ────────────────────────────────────────────────────────
type StepKey = 'inspectionDate' | 'reportSubmittedAt' | 'sentAt' | 'filedAt' | 'step5CompletedAt' | 'step6CompletedAt'

function DateCell({
  planItemId,
  stepKey,
  value,
  missing,
  onSaved,
}: {
  planItemId: string
  stepKey: StepKey
  value: string | null | undefined
  missing?: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fmt(value))
  const [, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 0)
  }, [editing])

  function save(val: string) {
    const newVal = val || null
    if (newVal === (value ?? null)) { setEditing(false); return }
    // 부분 입력된 날짜는 저장하지 않고 편집 종료 (원래 값 유지)
    if (newVal && !isCompleteDate(newVal)) { setEditing(false); return }
    startTransition(async () => {
      await upsertStatusLogAction({ planItemId, [stepKey]: newVal })
      setEditing(false)
      onSaved()
    })
  }

  if (editing) {
    return (
      <DateInput
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => save(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-full border border-[#7b68ee] rounded px-1 py-0.5 text-xs outline-none"
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(fmt(value)); setEditing(true) }}
      className={`w-full text-center hover:underline cursor-pointer ${missing ? 'text-red-500 font-medium' : value ? 'text-gray-800' : 'text-gray-300'}`}
    >
      {fmt(value) || (missing ? '미입력' : '—')}
    </button>
  )
}

// ── SMS 발송 모달 ─────────────────────────────────────────────────────────
function SmsModal({
  selectedIds,
  items,
  onClose,
  onSent,
}: {
  selectedIds: Set<string>
  items: MonitorRow[]
  onClose: () => void
  onSent: () => void
}) {
  const senderPhone = process.env.NEXT_PUBLIC_SMS_SENDER_PHONE ?? '(발신번호 미설정)'
  const targets = items.filter(i => selectedIds.has(i.id))

  // 수신번호 편집 상태 — 우선순위 자동 선택 후 직접 수정 가능
  const [phones, setPhones] = useState<Record<string, string>>(() =>
    Object.fromEntries(targets.map(t => [t.id, pickContact(t)?.phone ?? '']))
  )

  const SMS_DEFAULT_KEY = 'sms_default_content'
  const DEFAULT_MSG = '[소방안전관리] 점검 일정을 안내드립니다. 확인 후 회신 부탁드립니다.'
  const [content, setContent] = useState(() =>
    (typeof window !== 'undefined' ? localStorage.getItem(SMS_DEFAULT_KEY) : null) ?? DEFAULT_MSG
  )
  const [savedMsg, setSavedMsg] = useState('')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState('')

  function saveDefault() {
    localStorage.setItem(SMS_DEFAULT_KEY, content)
    setSavedMsg('기본값으로 저장됐습니다.')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  const validCount = targets.filter(t => phones[t.id]?.trim()).length

  function send() {
    startTransition(async () => {
      const recipients = targets
        .map(t => {
          const phone = phones[t.id]?.trim()
          if (!phone) return null
          const contact = pickContact(t)
          return { planItemId: t.id, role: contact?.role ?? '', name: contact?.name ?? '', phone }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const res = await saveSmsAction({
        planItemIds: Array.from(selectedIds),
        smsContent:  content,
        senderPhone,
        recipients,
      })
      if (res.error) { setErr(res.error); return }
      onSent()
    })
  }

  const missingCount = targets.length - validCount
  const canSend = validCount > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold">SMS 발송</span>
          <button onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* 발신번호 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f5f4ff] border border-[#d0ccf5]">
            <MessageSquare size={14} className="text-[#7b68ee] shrink-0" />
            <span className="text-xs text-[#514b81]">발신번호</span>
            <span className="text-sm font-semibold text-[#7b68ee] ml-1">{senderPhone}</span>
          </div>

          {/* 수신 대상 목록 */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium">
              수신 대상 {targets.length}건
              {missingCount > 0 && (
                <span className="ml-2 text-red-500">({missingCount}건 번호 없음)</span>
              )}
            </p>
            <ul className="space-y-1.5 max-h-52 overflow-y-auto">
              {targets.map(t => {
                const phone = phones[t.id] ?? ''
                const hasPhone = !!phone.trim()
                const contact = pickContact(t)
                return (
                  <li key={t.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${hasPhone ? 'bg-gray-50' : 'bg-red-50'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasPhone ? 'bg-[#7b68ee]' : 'bg-red-400'}`} />
                    <span className="font-medium text-gray-800 w-24 shrink-0 truncate">{t.customers?.customer_name}</span>
                    <span className="text-gray-400 w-10 shrink-0">{contact?.role ?? ''}</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhones(prev => ({ ...prev, [t.id]: e.target.value }))}
                      placeholder="번호 없음"
                      className={`flex-1 min-w-0 font-mono border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-[#7b68ee] ${hasPhone ? 'border-gray-200' : 'border-red-300 bg-red-50'}`}
                    />
                    <span className="text-gray-400 w-14 shrink-0 truncate text-right">{contact?.name ?? ''}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* SMS 내용 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-600 font-medium">SMS 내용</label>
              <button
                onClick={saveDefault}
                className="text-[11px] text-[#7b68ee] hover:underline"
              >
                기본값으로 저장
              </button>
            </div>
            <textarea
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#7b68ee]"
            />
            <div className="flex items-center justify-between mt-1">
              {savedMsg
                ? <p className="text-[11px] text-[#7b68ee]">{savedMsg}</p>
                : <span />
              }
              <p className="text-xs text-gray-400">{content.length}자</p>
            </div>
          </div>

          {missingCount > 0 && missingCount < targets.length && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              번호가 없는 {missingCount}건은 발송 기록에서 제외됩니다.
            </p>
          )}
          {missingCount === targets.length && (
            <p className="text-xs text-red-500 bg-red-50 rounded px-3 py-2">
              수신번호를 입력해주세요.
            </p>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded hover:bg-gray-50">취소</button>
          <button
            onClick={send}
            disabled={pending || !canSend}
            className="px-4 py-1.5 text-sm bg-[#7b68ee] text-white rounded disabled:opacity-50 hover:bg-[#6a58d6]"
          >
            {pending ? '저장 중…' : `발송 기록 저장 (${validCount}건)`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Kakao 지도 모달 ────────────────────────────────────────────────────────
function KakaoMapModal({
  customerName,
  address,
  onClose,
}: {
  customerName: string
  address: string
  onClose: () => void
}) {
  const encoded = encodeURIComponent(address)
  const kakaoUrl = `https://map.kakao.com/?q=${encoded}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <span className="font-semibold text-sm">{customerName}</span>
            <p className="text-xs text-gray-500 mt-0.5">{address}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#7b68ee] hover:underline"
            >
              <ExternalLink size={12} /> 카카오맵에서 열기
            </a>
            <button onClick={onClose} className="ml-2 p-1 hover:bg-gray-100 rounded">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-[400px] relative">
          <iframe
            src={`https://map.kakao.com/link/search/${encoded}`}
            className="w-full h-full min-h-[400px] border-0"
            title="카카오 지도"
            allowFullScreen
          />
        </div>
        <div className="px-5 py-2 border-t bg-gray-50 text-xs text-gray-400 text-center">
          지도가 표시되지 않으면 위의 &quot;카카오맵에서 열기&quot;를 이용하세요.
        </div>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export function MonitorClient({
  initialItems,
  employees,
  canManage,
  defaultYear,
  defaultMonth,
  currentUserId,
  currentUserRole,
}: {
  initialItems: Record<string, unknown>[]
  employees: Array<{ id: string; name: string; position: string | null }>
  canManage: boolean
  defaultYear: number
  defaultMonth: number
  currentUserId: string
  currentUserRole: string
}) {
  const [rows, setRows]           = useState<MonitorRow[]>(normalizeItems(initialItems))
  const [loadingRows, setLoadingRows] = useState(false)

  // 필터 상태 — employee는 본인 담당 건만 기본 조회
  const [yearMonth,    setYearMonth]    = useState(`${defaultYear}-${String(defaultMonth).padStart(2, '0')}`)
  const [empFilter,    setEmpFilter]    = useState(currentUserRole === 'employee' ? currentUserId : '')
  const [nameFilter,   setNameFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // 선택 상태
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showSms,   setShowSms]   = useState(false)
  const [mapItem,   setMapItem]   = useState<MonitorRow | null>(null)

  // 연/월 빠른 선택 팝업
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [pickerYear,      setPickerYear]      = useState(defaultYear)
  const monthPickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showMonthPicker) return
    function onDown(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node))
        setShowMonthPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMonthPicker])

  // 현재 월 데이터 재조회
  function refresh() {
    setLoadingRows(true)
    getMonitorItemsAction({ yearMonth }).then(res => {
      if (res.items) setRows(normalizeItems(res.items as Record<string, unknown>[]))
      setLoadingRows(false)
    })
  }

  // yearMonth 변경 시 서버에서 해당 월 데이터 재조회
  const isMounted = useRef(false)
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    setLoadingRows(true)
    setSelected(new Set())
    getMonitorItemsAction({ yearMonth }).then(res => {
      if (res.items) setRows(normalizeItems(res.items as Record<string, unknown>[]))
      setLoadingRows(false)
    })
  }, [yearMonth])

  // 필터 적용
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (empFilter && r.assigned_employee_id !== empFilter) return false
      if (nameFilter) {
        const name = (r.customers?.customer_name ?? '').toLowerCase()
        if (!name.includes(nameFilter.toLowerCase())) return false
      }
      // ADD-12: '취소(비활성/삭제)' = plan_item 취소 또는 고객 비활성
      const isCancelled = r.status === 'cancelled' || r.customers?.is_active === false
      if (statusFilter === 'cancelled') {
        if (!isCancelled) return false
      } else if (statusFilter !== 'all') {
        if (r.status !== statusFilter || isCancelled) return false
      }
      // yearMonth 필터
      if (yearMonth) {
        const [y, m] = yearMonth.split('-').map(Number)
        if (r.inspection_plans?.year !== y || r.inspection_plans?.month !== m) return false
      }
      return true
    })
  }, [rows, empFilter, nameFilter, statusFilter, yearMonth])

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(filtered.map(r => r.id)) : new Set())
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // 월 이동
  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split('-').map(Number)
    let nm = m + delta; let ny = y
    if (nm < 1) { nm = 12; ny-- }
    if (nm > 12) { nm = 1; ny++ }
    setYearMonth(`${ny}-${String(nm).padStart(2, '0')}`)
  }

  const statusLabel: Record<string, string> = {
    planned: '계획', confirmed: '확정', completed: '완료', cancelled: '취소',
  }

  const [y, m] = yearMonth.split('-').map(Number)

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <h1 className="text-xl font-bold">점검현황 모니터링</h1>
        <button
          onClick={() => setShowSms(true)}
          disabled={selected.size === 0}
          className="flex items-center gap-2 bg-[#7b68ee] text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40"
        >
          <MessageSquare size={14} />
          SMS 발송{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3 px-6 py-3 bg-gray-50 border-b flex-wrap">
        {/* 월 네비게이션 */}
        <div className="relative flex items-center gap-1 border rounded bg-white" ref={monthPickerRef}>
          <button onClick={() => changeMonth(-1)} className="p-1.5 hover:bg-gray-100 rounded-l" title="이전 달">
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => { setPickerYear(y); setShowMonthPicker(o => !o) }}
            className="px-3 text-sm font-medium hover:bg-gray-100 py-1 rounded transition-colors"
            title="연/월 바로가기"
          >
            {y}년 {m}월
          </button>
          <button onClick={() => changeMonth(1)} className="p-1.5 hover:bg-gray-100 rounded-r" title="다음 달">
            <ChevronRight size={14} />
          </button>
          {showMonthPicker && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#d0ccf5] rounded-xl shadow-xl p-3 w-52">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setPickerYear(y => y - 1)} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-sm font-semibold">{pickerYear}년</span>
                <button onClick={() => setPickerYear(y => y + 1)} className="p-1 hover:bg-gray-100 rounded">
                  <ChevronRight size={14} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                  const isActive = mo === m && pickerYear === y
                  return (
                    <button
                      key={mo}
                      onClick={() => {
                        setYearMonth(`${pickerYear}-${String(mo).padStart(2, '0')}`)
                        setShowMonthPicker(false)
                      }}
                      className={`py-1.5 text-xs font-medium rounded-lg transition-colors ${isActive ? 'bg-[#7b68ee] text-white' : 'hover:bg-[#f5f4ff] text-gray-800'}`}
                    >
                      {mo}월
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 담당자 필터 */}
        <select
          value={empFilter}
          onChange={e => setEmpFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="">전체 담당자</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>

        {/* 건물명 검색 */}
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            placeholder="건물명 검색"
            className="border rounded pl-7 pr-3 py-1.5 text-sm w-40"
          />
        </div>

        {/* 상태 필터 */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="all">전체 상태</option>
          <option value="planned">계획</option>
          <option value="confirmed">확정</option>
          <option value="completed">완료</option>
          <option value="cancelled">취소 (비활성/삭제)</option>
        </select>

        <span className="ml-auto text-xs text-gray-400">{loadingRows ? '조회 중…' : `${filtered.length}건`}</span>
      </div>

      {/* 테이블 — 헤더 고정 + 레코드 스크롤 */}
      <TableScroll offset={280}>
        <table className="w-full text-xs border-collapse min-w-[1100px]">
          <thead className="bg-gray-100 sticky top-0 z-10 shadow-[0_1px_0_0_#c8c4d0]">
            <tr>
              <th className="border px-2 py-2 text-center w-8">No</th>
              <th className="border px-2 py-2 text-center">계획일</th>
              <th className="border px-2 py-2 text-center">구분</th>
              <th className="border px-2 py-2 text-center">점검월</th>
              <th className="border px-2 py-2 text-center min-w-[120px]">건물명</th>
              <th className="border px-2 py-2 text-center">점검자</th>
              <th className="border px-2 py-2 text-center">1단계<br/><span className="font-normal text-gray-500">점검일</span></th>
              <th className="border px-2 py-2 text-center">2단계<br/><span className="font-normal text-gray-500">배치신고</span></th>
              <th className="border px-2 py-2 text-center">3단계<br/><span className="font-normal text-gray-500">송부</span></th>
              <th className="border px-2 py-2 text-center">4단계<br/><span className="font-normal text-gray-500">계출</span></th>
              <th className="border px-2 py-2 text-center">5단계<br/><span className="font-normal text-gray-500">보수완료</span></th>
              <th className="border px-2 py-2 text-center">6단계<br/><span className="font-normal text-gray-500">이행보고서</span></th>
              <th className="border px-2 py-2 text-center">SMS</th>
            </tr>
          </thead>
          <tbody>
            {loadingRows && (
              <tr>
                <td colSpan={12} className="text-center py-10 text-gray-400">
                  조회 중…
                </td>
              </tr>
            )}
            {!loadingRows && filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center py-10 text-gray-400">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {!loadingRows && filtered.map((row, idx) => {
              const log = row.inspection_status_log
              const isCompleted = row.status === 'completed'
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const scheduledPassed = row.scheduled_date ? new Date(row.scheduled_date) <= today : false
              const missingStep1 = !log?.inspection_date && (isCompleted || scheduledPassed)
              const missingStep2 = !!log?.inspection_date && !log?.report_submitted_at && isOverdue(log?.inspection_date)
              const missingStep3 = !!log?.inspection_date && !log?.sent_at
              const missingStep4 = !!log?.inspection_date && !log?.filed_at

              return (
                <tr
                  key={row.id}
                  onClick={() => toggleOne(row.id)}
                  className={`cursor-pointer hover:bg-gray-50 ${selected.has(row.id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="border px-2 py-1.5 text-center text-gray-500">{idx + 1}</td>
                  <td className="border px-2 py-1.5 text-center">{fmt(row.scheduled_date)}</td>
                  <td className="border px-2 py-1.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium
                      ${row.inspection_type === '종합' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {inspectionTypeLabel(row.inspection_type)}
                    </span>
                    <span className="ml-1 text-gray-400">{row.sequence_num}차</span>
                  </td>
                  <td className="border px-2 py-1.5 text-center text-gray-500">
                    {row.inspection_plans ? `${row.inspection_plans.year}.${String(row.inspection_plans.month).padStart(2, '0')}` : ''}
                  </td>
                  <td className="border px-2 py-1.5">
                    <div className={`font-medium ${row.customers?.is_active === false ? 'text-gray-400 line-through' : ''}`}>
                      {row.customers?.customer_name}
                      {row.customers?.is_active === false && (
                        <span className="ml-1 text-[9px] font-medium px-1 py-0.5 rounded bg-gray-100 text-gray-500 inline-block align-middle">비활성/삭제</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {row.customers?.address && (
                        <button
                          onClick={() => setMapItem(row)}
                          className="inline-flex items-center gap-0.5 text-[10px] text-[#7b68ee] hover:underline"
                          title={row.customers.address}
                        >
                          <MapPin size={10} /> 지도
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="border px-2 py-1.5 text-center">{row.profiles?.name ?? '-'}</td>
                  {/* 1단계: 점검일 */}
                  <td className={`border px-2 py-1.5 ${missingStep1 ? 'bg-red-50' : ''}`}>
                    <DateCell planItemId={row.id} stepKey="inspectionDate" value={log?.inspection_date} missing={missingStep1} onSaved={refresh} />
                  </td>
                  {/* 2단계: 배치신고 */}
                  <td className={`border px-2 py-1.5 ${missingStep2 ? 'bg-red-50' : ''}`}>
                    <DateCell planItemId={row.id} stepKey="reportSubmittedAt" value={log?.report_submitted_at} missing={missingStep2} onSaved={refresh} />
                  </td>
                  {/* 3단계: 송부 */}
                  <td className={`border px-2 py-1.5 ${missingStep3 ? 'bg-red-50' : ''}`}>
                    <DateCell planItemId={row.id} stepKey="sentAt" value={log?.sent_at} missing={missingStep3} onSaved={refresh} />
                  </td>
                  {/* 4단계: 계출 */}
                  <td className={`border px-2 py-1.5 ${missingStep4 ? 'bg-red-50' : ''}`}>
                    <DateCell planItemId={row.id} stepKey="filedAt" value={log?.filed_at} missing={missingStep4} onSaved={refresh} />
                  </td>
                  {/* 5단계: 보수완료 */}
                  <td className="border px-2 py-1.5">
                    <DateCell planItemId={row.id} stepKey="step5CompletedAt" value={log?.step5_completed_at} onSaved={refresh} />
                  </td>
                  {/* 6단계: 이행보고서 */}
                  <td className="border px-2 py-1.5">
                    <DateCell planItemId={row.id} stepKey="step6CompletedAt" value={log?.step6_completed_at} onSaved={refresh} />
                  </td>
                  {/* SMS */}
                  <td className="border px-2 py-1.5 text-center">
                    {log?.sms_confirmed
                      ? <span className="inline-flex items-center gap-0.5 text-green-600"><Check size={12} /> 확인</span>
                      : log?.sms_sent_at
                        ? <span className="text-yellow-600">발송됨</span>
                        : <span className="text-gray-300">-</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableScroll>

      {/* SMS 모달 */}
      {showSms && (
        <SmsModal
          selectedIds={selected}
          items={filtered}
          onClose={() => { setShowSms(false); setSelected(new Set()) }}
          onSent={() => { setShowSms(false); setSelected(new Set()); refresh() }}
        />
      )}

      {/* Kakao 지도 모달 */}
      {mapItem && mapItem.customers?.address && (
        <KakaoMapModal
          customerName={mapItem.customers.customer_name}
          address={mapItem.customers.address}
          onClose={() => setMapItem(null)}
        />
      )}
    </div>
  )
}
