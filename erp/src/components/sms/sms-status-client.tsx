'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  MessageSquare, Loader2, SlidersHorizontal, AlertTriangle, CalendarDays,
  ChevronRight, RefreshCw, Send, MapPin,
} from 'lucide-react'
import { listSmsStatusAction, bulkMovePlanDatesAction, listSmsCustomerOptionsAction } from '@/app/(dashboard)/inspections/sms-actions'
import { InspectionSmsModal, type SmsModalSource } from '@/components/sms/inspection-sms-modal'
import { CustomerFilterSearch } from '@/components/ui/customer-filter-search'
import { todayKst, addDays, groupByRegion } from '@/lib/sms-recipients'

/** 문자 발송 화면 (소방계획서_24 S5) — 점검현황 모니터링 대체
 *
 *  역할이 둘이다:
 *   ① **발송 결과·이력의 유일한 창구**(Q-15) — 달력 칩에는 발송 상태를 붙이지 않으므로
 *      "제대로 갔나"를 확인할 수 있는 곳은 여기뿐이다.
 *   ② 보조 발송 경로 — 배너 승인·지역 묶음·실패 재발송. 주 발송은 달력이다.
 *
 *  화면의 설계 원칙은 "찾지 않게 한다"(P-17). 그래서 상단 배너가 대상을 계산해 제시하고,
 *  필터는 기본으로 접혀 있다 — 지역 순회 준비(주 1회)에만 펼친다.
 */

type Row = {
  key: string; customerId: string; customerName: string; visitDate: string
  planItemIds: string[]; inspectionTypes: string[]; assigneeName: string | null
  regionSi: string | null; regionMyeon: string | null; regionRi: string | null
  recipientCount: number; status: string; sentAt: string | null; reason: string | null
  isAdhoc: boolean; sendable: boolean; unsendableReason: string | null
}
type Notice = { leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; planItemIds: string[] }
type Data = {
  rows: Row[]
  notices: Notice[]
  overdue: { count: number; items: Array<{ customerName: string; visitDate: string; planItemIds: string[] }> }
  regions: { si: string[]; myeon: string[]; ri: string[] }
  assignees: string[]
  leadRules: number[]
  today: string
}

const STATUS_LABEL: Record<string, string> = {
  unsent: '미발송', sent: '발송됨', failed: '실패', no_phone: '번호없음',
}
const STATUS_CLASS: Record<string, string> = {
  unsent: 'bg-[#f5f4ff] text-[#7b68ee] border-[#d0ccf5]',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  no_phone: 'bg-amber-50 text-amber-700 border-amber-200',
}
const btn = 'h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-40'
const btnPri = 'h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-semibold hover:bg-[#6a57dd] transition-colors disabled:opacity-40'
const sel = 'h-8 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] bg-white'

export function SmsStatusClient({ canSend }: { canSend: boolean }) {
  const today = todayKst()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 7))
  const [regionSi, setRegionSi] = useState('')
  const [regionMyeon, setRegionMyeon] = useState('')
  const [regionRi, setRegionRi] = useState('')
  const [status, setStatus] = useState<'all' | 'unsent' | 'sent' | 'failed' | 'no_phone'>('all')
  const [assignee, setAssignee] = useState('')
  // 주 동선은 배너 승인이라 필터는 접어 둔다 — 상시 펼치면 '찾는 화면'처럼 보인다(S5-11)
  const [showFilter, setShowFilter] = useState(false)

  const [data, setData] = useState<Data | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<SmsModalSource | null>(null)
  // 임의 발송 진입 (Q-17) — 고객 검색부터 시작하는 완전 수동 경로
  const [adhocOpen, setAdhocOpen] = useState(false)
  const [adhocQuery, setAdhocQuery] = useState('')
  const [adhocOptions, setAdhocOptions] = useState<Array<{ id: string; name: string; sub?: string }>>([])

  function openAdhoc() {
    setAdhocOpen(true)
    if (adhocOptions.length > 0) return          // 한 번만 가져온다
    startTransition(async () => {
      const res = await listSmsCustomerOptionsAction()
      setAdhocOptions(res.customers ?? [])
    })
  }
  const [moveDate, setMoveDate] = useState('')
  const [moveMsg, setMoveMsg] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [isPending, startTransition] = useTransition()

  function reload() {
    setErr('')
    startTransition(async () => {
      const res = await listSmsStatusAction({
        from, to,
        regionSi: regionSi || null, regionMyeon: regionMyeon || null, regionRi: regionRi || null,
        status, assignee: assignee || null,
      })
      if ('error' in res && res.error) { setErr(res.error); return }
      setData(res as unknown as Data)
      setChecked(new Set())
    })
  }

  const boot = useRef(false)
  useEffect(() => {
    if (boot.current) return
    boot.current = true
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = data?.rows ?? []
  // 지역 3단 묶음 — 담당자가 하루 동선을 지역으로 짠다.
  // 같은 규칙을 인라인으로 재구현하고 있었다(모달까지 붙으면 3중 복제) → 공용 함수로 단일화
  const regionGroups = groupByRegion(rows)

  const checkedRows = rows.filter(r => checked.has(r.key))
  const checkedPlanItems = checkedRows.flatMap(r => r.planItemIds)

  // 임의 발송 후보 — **전 활성 고객**이다. 화면에 뜬 행으로 한정하면 '계획이 잡힌 고객'만
  // 고를 수 있는데, Q-17이 든 사례(견적 방문·계획 없는 AS·상담)는 계획이 없는 고객이라
  // 정작 이 기능이 필요한 경우를 못 고른다. 목록은 [임의 발송]을 열 때 한 번만 가져온다.
  const adhocPick = adhocOptions.find(c => c.name === adhocQuery) ?? null

  function toggle(k: string) {
    setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  }
  function toggleGroup(g: { groups: Row[] }) {
    setChecked(s => {
      const n = new Set(s)
      const all = g.groups.every(r => n.has(r.key))
      for (const r of g.groups) all ? n.delete(r.key) : n.add(r.key)
      return n
    })
  }

  function bulkMove() {
    if (!moveDate || checkedPlanItems.length === 0) return
    setMoveMsg(null)
    startTransition(async () => {
      const res = await bulkMovePlanDatesAction(checkedPlanItems, moveDate)
      // 건별 실패를 삼키지 않는다 — 1단계 완료 건은 가드에, 정기는 같은 달 제약에 막힌다
      setMoveMsg(res.failed.length === 0
        ? `${res.moved}건을 ${moveDate}로 이동했습니다.`
        : `${res.moved}건 이동 · ${res.failed.length}건 실패 — ${res.failed.map(f => `${f.name}(${f.reason})`).join(' / ')}`)
      reload()
    })
  }

  return (
    <div className="space-y-4">
      {/* ── 승인 배너 (Q-12) — 대상을 찾지 않게 하는 장치 */}
      <div className="rounded-2xl border border-[#eceaf8] bg-white p-4">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="size-4 text-[#7b68ee]" />
          <h2 className="text-sm font-semibold text-[#090c1d]">보낼 사전 안내</h2>
          {isPending && <Loader2 className="size-3.5 animate-spin text-[#b0acd6]" />}
          {/* 임의 발송(Q-17) 세 번째 진입 — 고객 상세·작업대에서 시작하지 않는 완전 수동 경로.
              계획에 없는 방문(견적·상담 등)은 특정 점검 건에서 출발하지 않는다 */}
          {canSend && (
            <button
              data-testid="sms-adhoc-toolbar"
              onClick={openAdhoc}
              title="계획에 없는 방문을 안내합니다 — 고객을 검색해 보냅니다. 점검 회차로 잡히지 않습니다"
              className="ml-auto h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors"
            >
              임의 발송
            </button>
          )}
          <button onClick={reload} className={`${canSend ? '' : 'ml-auto'} p-1 rounded hover:bg-[#f5f4ff] text-[#8b87b8]`} title="새로고침">
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        {/* 고객 검색 — 열었을 때만. 초성 검색은 공용 컴포넌트가 담당한다 */}
        {adhocOpen && (
          <div data-testid="sms-adhoc-picker" className="flex items-center gap-2 mt-2 pt-2 border-t border-[#f5f4ff]">
            <span className="text-[11px] text-[#514b81] shrink-0">고객</span>
            <CustomerFilterSearch
              customers={adhocOptions}
              value={adhocQuery}
              onChange={setAdhocQuery}
              testId="sms-adhoc-customer"
            />
            <span className="text-[10px] text-[#8b87b8]">
              {adhocPick ? `${adhocPick.name} 선택됨`
                : adhocOptions.length === 0 ? '고객 목록을 불러오는 중…'
                : `전체 고객 ${adhocOptions.length}곳에서 고릅니다 (초성 가능)`}
            </span>
            {adhocPick && (
              <button className={btnPri}
                data-testid="sms-adhoc-open"
                onClick={() => setModal({ kind: 'adhoc', customerId: adhocPick.id, customerName: adhocPick.name })}>
                문자 보내기
              </button>
            )}
            <button className={`${btn} ml-auto`} onClick={() => { setAdhocOpen(false); setAdhocQuery('') }}>닫기</button>
          </div>
        )}

        {(data?.notices ?? []).map(n => (
          <div key={n.leadDays} data-testid="sms-notice" className="flex items-center gap-2 py-1.5 border-t border-[#f5f4ff] first:border-0">
            <span className={`size-1.5 rounded-full ${n.unsentCount > 0 ? 'bg-[#7b68ee]' : 'bg-[#d0ccf5]'}`} />
            <span className="text-xs text-[#090c1d]">{n.label}</span>
            <span className="text-xs text-[#514b81]">
              {n.unsentCount > 0 ? <>— 미발송 <b>{n.unsentCount}곳</b> · <b>{n.messageCount}통</b></> : '— 보낼 안내 없음 ✓'}
            </span>
            {n.unsentCount > 0 && canSend && (
              <div className="ml-auto flex items-center gap-1.5">
                <button className={btn} onClick={() => { setFrom(n.visitDate); setTo(n.visitDate); setStatus('unsent'); setShowFilter(true) }}>
                  대상 보기
                </button>
                <button data-testid="sms-approve" className={btnPri}
                  onClick={() => setModal({ kind: 'range', from: n.visitDate, to: n.visitDate, title: `${n.label} — 사전 안내` })}>
                  승인·발송
                </button>
              </div>
            )}
          </div>
        ))}
        {data && data.notices.every(n => n.unsentCount === 0) && (
          <p className="text-xs text-[#8b87b8] py-1">오늘 보낼 안내가 없습니다 ✓</p>
        )}

        {/* 시기 지남 — 이 줄만 성격이 다르다. 눌러도 발송은 안 되므로 [일정 확인]으로 보낸다 (S5-12) */}
        {(data?.overdue.count ?? 0) > 0 && (
          <div data-testid="sms-overdue" className="flex items-center gap-2 mt-2 pt-2 border-t border-[#f5f4ff]">
            <AlertTriangle className="size-3.5 text-amber-500" />
            <span className="text-xs text-amber-700">
              안내 못 하고 지난 방문 <b>{data!.overdue.count}곳</b> — 문자는 보낼 수 없습니다
            </span>
            <Link href="/inspection-plans" className={`${btn} ml-auto inline-flex items-center gap-1`}>
              <CalendarDays className="size-3" /> 일정 확인
            </Link>
          </div>
        )}
      </div>

      {/* ── 필터 (기본 접힘) */}
      <div className="rounded-2xl border border-[#eceaf8] bg-white">
        <button onClick={() => setShowFilter(v => !v)}
          data-testid="sms-filter-toggle"
          className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-[#514b81] hover:bg-[#faf9ff] rounded-2xl">
          <SlidersHorizontal className="size-3.5" />
          필터
          <span className="text-[#8b87b8]">
            {from} ~ {to}
            {regionSi && ` · ${regionSi}`}{regionMyeon && ` · ${regionMyeon}`}{regionRi && ` · ${regionRi}`}
            {status !== 'all' && ` · ${STATUS_LABEL[status]}`}
          </span>
          <ChevronRight className={`ml-auto size-3.5 transition-transform ${showFilter ? 'rotate-90' : ''}`} />
        </button>
        {showFilter && (
          <div className="px-4 pb-3 flex flex-wrap items-end gap-2 border-t border-[#f5f4ff] pt-3">
            <label className="text-[11px] text-[#514b81]">기간
              <span className="flex items-center gap-1 mt-1">
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
              </span>
            </label>
            <span className="flex items-center gap-1">
              <button className={btn} onClick={() => { setFrom(today); setTo(today) }}>오늘</button>
              <button className={btn} onClick={() => { setFrom(addDays(today, 1)); setTo(addDays(today, 1)) }}>내일</button>
              <button className={btn} onClick={() => { setFrom(today); setTo(addDays(today, 7)) }}>이번 주</button>
            </span>
            <label className="text-[11px] text-[#514b81]">지역
              <span className="flex items-center gap-1 mt-1">
                <select className={sel} value={regionSi} onChange={e => { setRegionSi(e.target.value); setRegionMyeon(''); setRegionRi('') }}>
                  <option value="">시/군 전체</option>
                  {(data?.regions.si ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className={sel} value={regionMyeon} onChange={e => { setRegionMyeon(e.target.value); setRegionRi('') }}>
                  <option value="">읍/면 전체</option>
                  {(data?.regions.myeon ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className={sel} value={regionRi} onChange={e => setRegionRi(e.target.value)}>
                  <option value="">리 전체</option>
                  {(data?.regions.ri ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </span>
            </label>
            <label className="text-[11px] text-[#514b81]">상태
              <select className={`${sel} block mt-1`} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
                <option value="all">전체</option>
                <option value="unsent">미발송</option>
                <option value="sent">발송됨</option>
                <option value="failed">실패</option>
                <option value="no_phone">번호없음</option>
              </select>
            </label>
            <label className="text-[11px] text-[#514b81]">담당
              <select className={`${sel} block mt-1`} value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">전체</option>
                {(data?.assignees ?? []).map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <button className={btnPri} onClick={reload} disabled={isPending}>조회</button>
          </div>
        )}
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      {moveMsg && <div data-testid="sms-move-msg" className="rounded-lg bg-[#f5f4ff] border border-[#d0ccf5] px-3 py-2 text-xs text-[#514b81]">{moveMsg}</div>}

      {/* ── 목록 (지역 3단 묶음) */}
      <div className="rounded-2xl border border-[#eceaf8] bg-white overflow-hidden">
        {rows.length === 0 && !isPending && (
          <p className="py-10 text-center text-xs text-[#8b87b8]">이 조건에 해당하는 건이 없습니다.</p>
        )}
        {regionGroups.map(g => (
          <div key={g.label} className="border-b border-[#f5f4ff] last:border-0">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#faf9ff]">
              <input type="checkbox" className="accent-[#7b68ee]"
                checked={g.groups.every(r => checked.has(r.key))}
                onChange={() => toggleGroup(g)} />
              <MapPin className="size-3 text-[#b0acd6]" />
              <span data-testid="sms-region-group" className="text-[11px] font-semibold text-[#090c1d]">{g.label}</span>
              <span className="text-[11px] text-[#8b87b8]">({g.groups.length}건)</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {g.groups.map(r => (
                  <tr key={r.key} data-testid="sms-row" className="border-t border-[#f7f6fd] hover:bg-[#faf9ff]">
                    <td className="w-8 pl-4 py-1.5">
                      <input type="checkbox" className="accent-[#7b68ee]" checked={checked.has(r.key)} onChange={() => toggle(r.key)} />
                    </td>
                    <td className="py-1.5 text-[#090c1d]">
                      {r.customerName}
                      {r.isAdhoc && <span data-testid="badge-adhoc" className="ml-1 px-1 py-0.5 rounded bg-[#f5f4ff] text-[10px] text-[#7b68ee] border border-[#d0ccf5]">임의</span>}
                    </td>
                    <td className="py-1.5 text-[#514b81] w-24">{r.visitDate}</td>
                    <td className="py-1.5 text-[#8b87b8] w-24">{r.inspectionTypes.join('·')}</td>
                    <td className="py-1.5 text-[#8b87b8] w-20">{r.assigneeName ?? '-'}</td>
                    <td className="py-1.5 text-[#8b87b8] w-20">수신 {r.recipientCount}명</td>
                    <td className="py-1.5 w-20">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${STATUS_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-[10px] text-[#8b87b8] max-w-[220px] truncate" title={r.reason ?? ''}>
                      {r.sentAt ? new Date(r.sentAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      {r.reason ? ` ${r.reason}` : ''}
                      {!r.sendable && r.unsendableReason ? r.unsendableReason : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ── 선택 액션 바 */}
      {checkedRows.length > 0 && (
        <div className="sticky bottom-4 rounded-2xl border border-[#d0ccf5] bg-white shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[#514b81]">
            <b className="text-[#090c1d]">{checkedRows.length}곳</b> 선택 · 수신 {checkedRows.reduce((n, r) => n + r.recipientCount, 0)}명
          </span>
          {canSend && (
            <button data-testid="sms-send-selected" className={btnPri}
              onClick={() => setModal({ kind: 'items', planItemIds: checkedPlanItems })}
              disabled={checkedPlanItems.length === 0}>
              <Send className="size-3 inline mr-1" /> 사전안내 문자
            </button>
          )}
          {/* 지역 순회 일정 조정 (S12② / Q-16) — 날짜 변경은 본래 계획 업무지만
              지역 축이 이 화면에만 있어 여기 둔다. 라벨로 이유를 드러낸다 */}
          <span className="flex items-center gap-1.5 ml-auto">
            <span className="text-[10px] text-[#8b87b8]">지역 순회 일정 조정</span>
            <input type="date" value={moveDate} onChange={e => setMoveDate(e.target.value)}
              data-testid="sms-move-date" className={sel} />
            <button data-testid="sms-move-btn" className={btn} onClick={bulkMove}
              disabled={!moveDate || checkedPlanItems.length === 0 || isPending}>
              점검일 일괄 변경
            </button>
          </span>
          <button className={btn} onClick={() => setChecked(new Set())}>선택 해제</button>
        </div>
      )}

      {modal && (
        <InspectionSmsModal source={modal} onClose={() => setModal(null)} onSent={reload} />
      )}
    </div>
  )
}
