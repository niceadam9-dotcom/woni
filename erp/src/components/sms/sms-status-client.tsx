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
import { AddressMapButton } from '@/components/ui/address-map-button'
import { todayKst, addDays, groupByRegion, FILTER_NONE } from '@/lib/sms-recipients'

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
  /** 방문 준비용 지도(S5-7) */
  address: string | null
  /** 점검일이 옮겨져 옛 날짜로 이미 안내가 나간 건 — 그 옛 날짜 (S5-0b) */
  movedFrom: string | null
}
type Notice = {
  leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; planItemIds: string[]
  /** 보낼 수 **없는** 곳(번호 없음·수신 해제·점검일 미확정) — 통수엔 안 들어가지만 할 일이다 */
  blockedCount?: number
  blocked?: Array<{ customerName: string; reason: string }>
}
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
  // 발송 직전 claim 행이 결과 기록에 실패해 굳은 상태 — **돈이 나갔을 수 있다**.
  // '미발송'으로 보이면 배너가 재발송을 권해 이중 과금이 되므로 따로 드러낸다.
  stuck: '확인필요',
}
/** 배지에 다 못 쓰는 사실을 툴팁으로 — 특히 '발송됨'이 무엇을 포함하는지 (S5-0c) */
const STATUS_TOOLTIP: Record<string, string> = {
  sent: '보냈습니다. 공급자 응답을 못 읽어 접수 확인이 안 된 건(확인불가)도 여기 포함됩니다 — 실패로 두면 이미 나간 문자를 다시 보내게 되기 때문입니다.',
  failed: '보내지 못했습니다. 사유는 오른쪽에 있습니다.',
  no_phone: '보낼 번호가 없어 발송되지 않았습니다 — 고객관리에서 연락처를 채워주세요.',
  stuck: '발송을 시작했는데 결과가 기록되지 않았습니다. 실제로 나갔을 수 있으니 확인 전에는 다시 보내지 마세요.',
}
const STATUS_CLASS: Record<string, string> = {
  unsent: 'bg-[#f5f4ff] text-[#7b68ee] border-[#d0ccf5]',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  no_phone: 'bg-amber-50 text-amber-700 border-amber-200',
  stuck: 'bg-orange-100 text-orange-800 border-orange-300 font-semibold',
}
const btn = 'h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-40'
const btnPri = 'h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-semibold hover:bg-[#6a57dd] transition-colors disabled:opacity-40'
const sel = 'h-8 px-2 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] bg-white'

/** 목록 한 행.
 *
 *  화면 폭의 절반을 **모든 행이 같은 값**으로 채우고 있었다(담당 전원 동일·수신 전원 1명·
 *  상태 전원 미발송). 그 탓에 오른쪽이 잘려 배너 버튼이 안 보였다. 그래서 기본값은 그리지 않는다:
 *   · 담당 — 종류가 하나뿐이면 열 자체를 뺀다(showAssignee)
 *   · 수신 — 1명이면 굳이 쓰지 않는다. 2명 이상일 때만 눈에 띄게(비용이 곱해지는 경우다)
 *   · 상태 — '미발송'은 기본값이라 배지를 없앤다. 발송됨·실패·번호없음만 배지 → 예외가 눈에 띈다 */
function SmsRow({ r, checked, onToggle, showAssignee, canSend, onResend }: {
  r: Row; checked: boolean; onToggle: () => void; showAssignee: boolean
  canSend: boolean; onResend: (r: Row) => void
}) {
  const isDefault = r.status === 'unsent'
  // 계획 항목이 없는 행(임의 발송·계획이 사라진 과거 이력)은 **일괄 경로로 못 보낸다** —
  // 일괄 발송은 planItemIds로 대상을 찾기 때문이다. 종전엔 체크는 되는데 발송에서 조용히 빠져,
  // 사용자는 보냈다고 믿고 그 고객만 안내를 못 받았다. 체크를 막고 전용 버튼을 준다.
  const bulkable = r.planItemIds.length > 0
  return (
    <tr data-testid="sms-row" className="border-t border-[#f7f6fd] hover:bg-[#faf9ff]">
      <td className="pl-4 py-1.5 align-top">
        <input type="checkbox" className="accent-[#7b68ee]"
          checked={checked} onChange={onToggle}
          disabled={!bulkable}
          data-testid={bulkable ? undefined : 'row-check-disabled'}
          title={bulkable ? undefined : '계획이 없는 건입니다 — 오른쪽 [다시 보내기]로 보냅니다'} />
      </td>
      <td className="py-1.5 text-[#090c1d] truncate" title={r.address ? `${r.customerName} · ${r.address}` : r.customerName}>
        {r.customerName}
        {r.isAdhoc && <span data-testid="badge-adhoc" className="ml-1 px-1 py-0.5 rounded bg-[#f5f4ff] text-[10px] text-[#7b68ee] border border-[#d0ccf5]">임의</span>}
        {/* 방문 준비 — 지역 3단은 묶음용이라 "이 고객이 어디쯤인가"는 답해주지 못한다(S5-7).
            공용 버튼을 쓴다: 종전엔 이 화면만 자체 조건(`r.address &&`)을 두 번 복제했고 trim이
            없어 **공백뿐인 주소('   ')에서 빈 지도가 열렸다**(독립 판정 지적, 2026-08-19).
            원칙을 세운 화면이 그 원칙을 깨고 있었다 — 판단은 AddressMapButton 한곳에만 둔다. */}
        <AddressMapButton customerName={r.customerName} address={r.address} testId="row-map" className="ml-1" />
      </td>
      <td className="py-1.5 text-[#514b81] tabular-nums">
        {r.visitDate}
        {/* 일정변경(S5-0b) — 옛 날짜로 이미 안내가 나갔다. 그냥 보내면 고객이 두 날짜를 안내받는다.
            자동 재발송은 하지 않는다: 다시 알릴지는 상황을 아는 사람이 판단할 일이다. */}
        {r.movedFrom && (
          <span data-testid="badge-moved"
            title={`${r.movedFrom}로 이미 안내했습니다 — 날짜가 바뀌었으니 다시 알릴지 확인해주세요`}
            className="ml-1 px-1 py-0.5 rounded bg-amber-50 text-[9px] text-amber-700 border border-amber-200 whitespace-nowrap">
            일정변경 {r.movedFrom.slice(5)} 안내함
          </span>
        )}
      </td>
      <td className="py-1.5 text-[#8b87b8] truncate">{r.inspectionTypes.join('·')}</td>
      {showAssignee && <td className="py-1.5 text-[#8b87b8] truncate">{r.assigneeName ?? '-'}</td>}
      <td className={`py-1.5 ${r.recipientCount > 1 ? 'text-[#7b68ee] font-medium' : 'text-[#b0acd6]'}`}>
        {r.recipientCount === 0 ? '없음' : r.recipientCount === 1 ? '1명' : `${r.recipientCount}명`}
      </td>
      <td className="py-1.5" data-testid="row-status" data-status={r.status}>
        {isDefault
          ? <span className="text-[10px] text-[#b0acd6]">미발송</span>
          : <span
              /* '발송됨'에는 접수 확인이 안 된 건(unverified)이 섞여 있을 수 있다 —
                 실패로 두면 이미 나간 문자를 재발송하므로 발송됨으로 묶되, 툴팁으로 알린다(S5-0c) */
              title={STATUS_TOOLTIP[r.status]}
              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${STATUS_CLASS[r.status]}`}>
              {STATUS_LABEL[r.status]}
            </span>}
      </td>
      <td className="py-1.5 pr-2 text-[10px] text-[#8b87b8] truncate"
        title={[r.reason, !r.sendable ? r.unsendableReason : null].filter(Boolean).join(' · ')}>
        {r.sentAt ? new Date(r.sentAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
        {r.reason ? ` ${r.reason}` : ''}
        {!r.sendable && r.unsendableReason ? r.unsendableReason : ''}
      </td>
      <td className="py-1.5 pr-4 text-right">
        {/* 일괄 경로로 못 보내는 행의 유일한 출구 — 없으면 임의 발송 실패 건을 재발송할 방법이 없다 */}
        {canSend && !bulkable && r.visitDate >= todayKst() && (
          <button data-testid="row-resend"
            onClick={() => onResend(r)}
            title="이 고객에게 이 날짜로 다시 보냅니다"
            className="h-6 px-2 rounded-lg border border-[#d0ccf5] text-[10px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors whitespace-nowrap">
            다시 보내기
          </button>
        )}
      </td>
    </tr>
  )
}

/** 마지막으로 고른 지역 — 적용이 아니라 **제안**에만 쓴다(아래 주석 참조) */
const LAST_REGION_KEY = 'sms:lastRegion'

/** 값이 빈 행을 고르는 선택지의 라벨. 이 선택지가 없으면 지역·담당이 비어 있는 고객과
 *  임의 발송 행은 필터를 거는 순간 사라진 채 되돌아올 길이 없다(sms-recipients FILTER_NONE). */
const optLabel = (v: string) => v === FILTER_NONE ? '(없음)' : v

export function SmsStatusClient({ canSend }: { canSend: boolean }) {
  const today = todayKst()
  // 기간은 **기본 해제**(빈 값 = 전체). 종전엔 오늘~+7이 미리 걸려 있어,
  // 사용자가 필터를 건 적이 없는데도 목록이 잘려 있었다 — 안 보이는 건이 있다는 사실 자체를 모른다.
  // 빈 값이면 서버가 **오늘~+30일**로 해석한다(sms-actions.ts:184-185, 2026-08-19 사용자 지시 '1개월').
  // 지난 방문일은 어차피 발송 대상이 아니라 하한이 오늘이고, 놓친 건은 배너 '시기 지남'이 따로 알린다.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [regionSi, setRegionSi] = useState('')
  const [regionMyeon, setRegionMyeon] = useState('')
  const [regionRi, setRegionRi] = useState('')
  // 기본은 **발송됨 제외**(2026-08-19 사용자 지시) — 이 화면에서 할 일은 '아직 안 보낸 것'이다.
  // 이미 보낸 건이 섞여 있으면 목록이 길어지기만 하고 남은 일이 안 보인다.
  // 발송 결과를 확인하려면 상태를 '발송됨'이나 '전체'로 바꾼다(결과 창구 역할은 그대로다).
  const [status, setStatus] = useState<'all' | 'not_sent' | 'unsent' | 'sent' | 'failed' | 'no_phone' | 'stuck'>('not_sent')
  const [assignee, setAssignee] = useState('')
  // 필터는 **항상 펼쳐 둔다**(2026-08-19 사용자 지시).
  // 설계 초안(S5-11)은 "주 동선이 배너 승인이니 접어 둔다"였는데, 실사용에서 뒤집혔다 —
  // 접혀 있으면 지역·기간을 좁히려 할 때마다 한 번 더 눌러야 하고,
  // 무엇보다 **지금 무엇이 걸려 있는지**가 요약 한 줄로만 보여 확신이 안 선다.
  // 접는 기능 자체는 남긴다(좁은 화면·목록에 집중할 때).
  const [showFilter, setShowFilter] = useState(true)

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
  // ── 마지막 사용 지역 (S5-11 후반부) ──────────────────────────
  //
  // ⚠ **자동으로 적용하지 않는다.** 담당자는 대개 같은 지역을 연달아 도니 기억할 값은 있지만,
  //   되살린 필터를 몰래 걸면 "필터를 건 적이 없는데 목록이 잘려 있는" 상태가 된다 —
  //   이 화면에서 이미 한 번 뒤집은 실수다(기간 기본값 오늘~+7, 위 :162 주석).
  //   지역은 특히 위험하다. 빠진 고객이 **문자를 영영 못 받는데** 화면은 조용하다.
  //   그래서 기억은 하되 제안만 하고, 적용은 사용자가 한 번 누른다.
  const [lastRegion, setLastRegion] = useState<{ si: string; myeon: string; ri: string } | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_REGION_KEY)
      if (raw) setLastRegion(JSON.parse(raw))
    } catch { /* 사파리 프라이빗 등 — 기억 못 하는 것뿐이라 조용히 넘긴다 */ }
  }, [])
  useEffect(() => {
    if (!regionSi) return                       // 해제는 기억하지 않는다(다음에 제안할 것이 없다)
    const v = { si: regionSi, myeon: regionMyeon, ri: regionRi }
    setLastRegion(v)
    try { localStorage.setItem(LAST_REGION_KEY, JSON.stringify(v)) } catch { /* 위와 같음 */ }
  }, [regionSi, regionMyeon, regionRi])

  /** '시기 지남' 명단 펼침 — 이 목록은 기간 필터로 찾을 수 없어(축 A는 오늘 이후만)
   *  여기가 유일한 조회 수단이다. 접혀 있으면 3곳 넘는 나머지는 화면 어디에도 없다. */
  const [overdueOpen, setOverdueOpen] = useState(false)

  // 지역순(하루 동선) ↔ 날짜순(언제 가나) — 기본은 지역순
  const [sortBy, setSortBy] = useState<'region' | 'date'>('region')
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

  // 필터를 바꾸면 **바로 조회한다** — [조회]를 눌러야만 반영되던 때는, 값만 바꿔 놓고
  // 목록은 옛 조건 그대로인 상태가 생긴다. 화면과 필터가 다른 말을 하는 셈이고,
  // 특히 [필터 해제]는 "해제했는데 목록이 그대로"로 보인다.
  // 날짜 입력은 타이핑 중에도 onChange가 계속 오므로 잠깐 묶었다가 한 번만 보낸다.
  const firstFilterRun = useRef(true)
  useEffect(() => {
    if (firstFilterRun.current) { firstFilterRun.current = false; return }   // 최초 로드와 중복 방지
    const t = setTimeout(() => reload(), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, regionSi, regionMyeon, regionRi, status, assignee])

  const rows = data?.rows ?? []
  // 지역 3단 묶음 — 담당자가 하루 동선을 지역으로 짠다.
  // 같은 규칙을 인라인으로 재구현하고 있었다(모달까지 붙으면 3중 복제) → 공용 함수로 단일화
  const regionGroups = groupByRegion(rows)

  // 정렬 축 — 지역순이 기본이지만(하루 동선), "언제 가야 하나"를 볼 때는 날짜가 섞여 보인다.
  // 지역순에서는 8/24 → 8/21 → 8/24처럼 날짜가 오르내려 일정 감각을 잡을 수 없다.
  const sorted = sortBy === 'date'
    ? [...rows].sort((a, b) => a.visitDate.localeCompare(b.visitDate) || a.customerName.localeCompare(b.customerName))
    : []

  // ★ 배너와 목록이 서로 다른 말을 하던 문제 —
  // 배너는 시점 규칙(기본 [1]=내일)만 보므로 "보낼 안내 없음 ✓"인데, 목록에는 미발송이 십수 건 있었다.
  // 논리적으로는 맞지만 사용자에겐 "이렇게 많은데 없다니?"로 읽힌다. 이 화면의 전제가
  // '찾지 않게 한다'인데 배너가 오히려 혼란을 만든 셈이라, **지금 조회 범위의 미발송**을 함께 센다.
  const unsentRows = rows.filter(r => r.status === 'unsent' && r.sendable)
  // ⚠ 배너 줄이 이미 세는 건을 여기서 또 세면 안 된다. 종전엔 게이트만 '시점 밖'으로 걸고
  // 표시는 **전체 미발송 수**를 써서, 배너 첫 줄의 "내일 6곳"이 둘째 줄 N에도 다시 들어갔다.
  // 문구는 "안내 시점은 아니지만"인데 사실과 달랐다 — 세는 대상과 말하는 대상을 일치시킨다.
  // (배너가 커버하는지는 **방문일**로 판정한다 — planItemIds 기준은 S5-10의 쌍 규칙과 어긋나는 잔재였다.)
  const noticeDates = new Set((data?.notices ?? []).map(n => n.visitDate))
  const unsentOutsideNotices = unsentRows.filter(r => !noticeDates.has(r.visitDate))
  const unsentMessages = unsentOutsideNotices.reduce((n, r) => n + Math.max(r.recipientCount, 0), 0)

  // 같은 값이 모든 행에 반복되면 열로 둘 가치가 없다 — 폭만 먹고 오른쪽이 잘린다
  const assigneeSet = new Set(rows.map(r => r.assigneeName ?? '-'))
  const showAssignee = assigneeSet.size > 1

  // 기간이 비면 **오늘부터 1개월** — 서버와 같은 규칙이어야 화면과 결과가 어긋나지 않는다.
  // 라벨을 '전체'라고 쓰면 화면이 거짓말을 한다(실제로는 1개월만 담겨 있다).
  // ⚠ 서버는 계획 축의 하한을 **오늘로 당긴다**(sms.ts loadSmsTargets). 화면이 사용자가 고른
  //   과거 날짜를 그대로 써 놓으면, 0건이 떴을 때 "그 기간엔 방문이 없었구나"로 읽힌다 —
  //   실제로는 지난 방문이 조회 대상이 아닐 뿐이고, 그 건들은 '시기 지남'에 있다(3차 판정).
  const pastRequested = !!from && from < today
  const effFrom = from && from >= today ? from : today
  const effTo = to || addDays(today, 30)
  const periodLabel = from || to ? `이 기간(${effFrom} ~ ${effTo})` : `기본 1개월(${effFrom} ~ ${effTo})`
  // '걸린 필터'는 **기본값에서 벗어난 것**만 센다 — 기본(1개월·발송 제외)까지 필터로 치면
  // 사용자가 아무것도 안 건드렸는데 [필터 해제]가 떠서 "내가 뭘 걸었나?" 하게 된다
  const filterOn = !!(from || to || regionSi || regionMyeon || regionRi || assignee || status !== 'not_sent')
  function clearFilters() {
    setFrom(''); setTo(''); setRegionSi(''); setRegionMyeon(''); setRegionRi('')
    // 해제 = **기본값으로 되돌리기**. 'all'로 두면 filterOn 판정(status !== 'not_sent')이
    // 계속 참이라 해제한 직후에도 [필터 해제]가 그대로 떠 있다 — 눌렀는데 안 풀린 것처럼 보인다.
    setStatus('not_sent'); setAssignee('')
  }

  // 체크는 계획 항목이 있는 행에만 걸린다(SmsRow가 나머지를 disabled로 막는다).
  // 그래도 여기서 한 번 더 거른다 — 필터가 바뀌며 남은 체크가 섞이면 액션 바 숫자가 거짓이 된다.
  const checkedRows = rows.filter(r => checked.has(r.key) && r.planItemIds.length > 0)
  const checkedPlanItems = checkedRows.flatMap(r => r.planItemIds)

  // 지역·담당으로 좁혀 놓았는가 — 배너 승인이 그 범위를 존중해야 하는지의 판단 근거.
  // 기간·상태는 제외한다: 배너는 자기 날짜와 미발송만 보므로 그 둘로는 범위가 넓어지지 않는다.
  const narrowed = !!(regionSi || regionMyeon || regionRi || assignee)
  /** 지금 화면에 보이는 그 날짜의 미발송 계획 항목 — 배너 승인을 필터 범위로 좁힐 때 쓴다.
   *
   *  ⚠ `status === 'unsent'`를 요구하는데 `narrowed`는 지역·담당만 본다. 그래서 지역을 걸고
   *  상태를 '실패'나 '발송됨'으로 두면 **빈 배열이 넘어가 모달이 "보낼 대상이 없습니다"**를
   *  띄웠다 — 바로 위 배너 줄은 "미발송 6건"이라 말한 직후다. 사용자는 기능이 고장난 줄 안다.
   *  빈 배열이면 날짜 범위로 되돌린다(서버가 완전한 목록을 만든다). 좁히지 못할 뿐,
   *  **아무 일도 안 일어나는 것보다 낫다** — 모달 안에서 다시 고를 수 있다. */
  const visibleItemsOn = (d: string) =>
    rows.filter(r => r.visitDate === d && r.status === 'unsent' && r.sendable).flatMap(r => r.planItemIds)

  /** 계획 없는 행의 재발송 — 임의 발송 경로로 그 고객·그 날짜를 미리 채워 연다 */
  function openResend(r: Row) {
    setModal({ kind: 'adhoc', customerId: r.customerId, customerName: r.customerName, visitDate: r.visitDate, title: `다시 보내기 — ${r.customerName}` })
  }

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
              {/* 단위는 **건**(고객+방문일)이다. '곳'이라 쓰면 한 고객이 그 주에 두 번
                  방문할 때 "2곳"이 되어 거짓이 된다 — 뱃지·위젯도 같은 단위로 맞췄다. */}
              {n.unsentCount > 0 ? <>— 미발송 <b>{n.unsentCount}건</b> · <b>{n.messageCount}통</b></> : '— 보낼 안내 없음 ✓'}
            </span>
            {n.unsentCount > 0 && canSend && (
              <div className="ml-auto flex items-center gap-1.5">
                <button className={btn} onClick={() => { setFrom(n.visitDate); setTo(n.visitDate); setStatus('unsent'); setShowFilter(true) }}>
                  대상 보기
                </button>
                {/* 화면을 지역·담당으로 좁혀 놓았으면 **그 범위 안에서만** 보낸다.
                    종전엔 날짜만 넘겨서, 강하면만 보던 사용자가 누르면 그날 전 지역이
                    전체 체크 상태로 열렸다(과다 발송 여지). 좁힌 게 없으면 종전대로
                    날짜만 넘겨 서버가 완전한 목록을 만든다(Q-14). */}
                <button data-testid="sms-approve" className={btnPri}
                  title={narrowed ? '지금 걸린 지역·담당 범위 안에서만 보냅니다' : undefined}
                  onClick={() => {
                    const items = narrowed ? visibleItemsOn(n.visitDate) : []
                    setModal(items.length > 0
                      ? { kind: 'items', planItemIds: items, title: `${n.label} — 사전 안내 (현재 필터 범위)` }
                      // 좁힌 게 없거나, 좁혔는데 화면에 미발송 행이 안 보이는 경우(상태 필터 등)
                      : { kind: 'range', from: n.visitDate, to: n.visitDate, title: `${n.label} — 사전 안내` })
                  }}>
                  승인·발송{narrowed ? ' (필터 범위)' : ''}
                </button>
              </div>
            )}
          </div>
        ))}
        {/* 시점 규칙 밖의 미발송 — 배너가 "없음 ✓"인데 목록엔 십수 건이 있던 모순을 여기서 닫는다.
            규칙(기본 [1]=내일)은 그대로 두되, **지금 보고 있는 기간**의 미발송을 따로 세어 보여준다.
            이게 없으면 사용자는 두 화면이 다른 말을 한다고 느끼고 배너를 믿지 않게 된다. */}
        {unsentOutsideNotices.length > 0 && (
          <div data-testid="sms-notice-extra" className="flex items-center gap-2 py-1.5 border-t border-[#f5f4ff]">
            <span className="size-1.5 rounded-full bg-[#b0acd6]" />
            <span className="text-xs text-[#090c1d]">{periodLabel}</span>
            <span className="text-xs text-[#514b81]">
              — 안내 시점은 아니지만 미발송 <b>{unsentOutsideNotices.length}건</b> · <b>{unsentMessages}통</b>
            </span>
            {canSend && (
              <div className="ml-auto flex items-center gap-1.5">
                <button className={btn} onClick={() => { setStatus('unsent'); setShowFilter(true) }}>
                  미발송만 보기
                </button>
                {/* ⚠ 이 버튼은 화면에서 **가장 되돌릴 수 없는 것**이다. 첫 줄 [승인·발송](내일 3통)과
                    똑같은 주버튼 색이었는데, 이쪽은 기본 1개월이라 267통이 이미 선택된 채 모달이 열렸다
                    — 거기서 한 번 더 누르면 한 달치가 나간다(3차 판정 실측).
                    통수를 버튼에 박고, 큰 건은 색을 낮춰 '주 동선이 아님'을 눈으로 알린다. */}
                <button data-testid="sms-approve-range"
                  className={unsentMessages >= 50
                    ? 'h-8 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors'
                    : btnPri}
                  title={unsentMessages >= 50
                    ? `${unsentMessages}통입니다 — 기간을 좁혀 나눠 보내는 편이 안전합니다`
                    : undefined}
                  onClick={() => setModal({ kind: 'range', from: effFrom, to: effTo, title: `${periodLabel} 방문 — 사전 안내` })}>
                  {from || to ? '이 기간 발송' : '전체 발송'} {unsentMessages}통
                </button>
              </div>
            )}
          </div>
        )}
        {/* ⚠ '보낼 수 없는 곳'까지 0일 때만 초록불이다. 종전엔 unsentCount만 봐서,
            내일 방문 5곳이 **전부 번호 없음**이면 "보낼 안내가 없습니다 ✓"가 떴다 —
            문자를 못 받을 것이 확정된 고객만 골라 화면에서 지운 셈이었다. */}
        {data && data.notices.every(n => n.unsentCount === 0 && (n.blockedCount ?? 0) === 0)
          && unsentOutsideNotices.length === 0 && (
          <p className="text-xs text-[#8b87b8] py-1">보낼 안내가 없습니다 ✓</p>
        )}
        {data && data.notices.some(n => (n.blockedCount ?? 0) > 0) && (
          <div data-testid="sms-blocked" className="flex items-start gap-2 mt-2 pt-2 border-t border-[#f5f4ff]">
            <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
            <span className="text-xs text-amber-700">
              보낼 수 없는 건 <b>{data.notices.reduce((n, x) => n + (x.blockedCount ?? 0), 0)}건</b>
              {' — '}
              {[...new Set(data.notices.flatMap(n => n.blocked ?? []).map(b => `${b.customerName}(${b.reason})`))]
                .slice(0, 3).join(', ')}
              {data.notices.reduce((n, x) => n + (x.blockedCount ?? 0), 0) > 3 && ' 외'}
              . 그대로 두면 연락 없이 방문하게 됩니다.
            </span>
          </div>
        )}

        {/* 시기 지남 — 이 줄만 성격이 다르다. 눌러도 발송은 안 되므로 [일정 확인]으로 보낸다 (S5-12) */}
        {(data?.overdue.count ?? 0) > 0 && (
          <div data-testid="sms-overdue" className="flex items-center gap-2 mt-2 pt-2 border-t border-[#f5f4ff]">
            <AlertTriangle className="size-3.5 text-amber-500" />
            {/* 서버가 고객명(items)까지 보내는데 화면이 개수만 그려, 어느 고객인지 알 길이
                없었다. 이 목록은 기간 필터로도 찾을 수 없어(축 A는 오늘 이후만) 여기가 유일한 단서다. */}
            {/* ⚠ 이름 3곳만 보이고 나머지는 **화면 어디에도 없었다**(3차 판정: 197곳 중 194곳).
                기간을 과거로 넣어 찾아도 서버가 from을 오늘로 당겨 0건이 뜨고, 화면은 그 사실을
                말하지 않아 사용자는 "그 기간엔 방문이 없었구나"로 읽는다. 펼쳐 볼 수 있게 한다. */}
            <span className="text-xs text-amber-700">
              안내 못 하고 지난 방문 <b>{data!.overdue.count}건</b>
              {data!.overdue.items.length > 0 && (
                <> — {data!.overdue.items.slice(0, 3).map(i => `${i.customerName}(${i.visitDate.slice(5)})`).join(', ')}
                  {data!.overdue.items.length > 3 && ` 외 ${data!.overdue.items.length - 3}건`}</>
              )}
              . 문자는 보낼 수 없습니다
            </span>
            {data!.overdue.items.length > 3 && (
              <button data-testid="sms-overdue-expand" className={btn}
                onClick={() => setOverdueOpen(v => !v)}>
                {overdueOpen ? '접기' : `전체 ${data!.overdue.items.length}건 보기`}
              </button>
            )}
            <Link href="/inspection-plans" className={`${btn} ml-auto inline-flex items-center gap-1`}>
              <CalendarDays className="size-3" /> 일정 확인
            </Link>
          </div>
        )}
        {overdueOpen && (data?.overdue.items.length ?? 0) > 0 && (
          <ul data-testid="sms-overdue-list"
            className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/50 divide-y divide-amber-100">
            {data!.overdue.items.map((i, n) => (
              <li key={`${i.customerName}-${i.visitDate}-${n}`} className="flex items-center gap-2 px-3 py-1 text-[11px] text-amber-800">
                <span className="tabular-nums text-amber-600">{i.visitDate}</span>
                <span className="text-[#090c1d]">{i.customerName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 필터 (기본 접힘 · **기본 해제**) */}
      <div className="rounded-2xl border border-[#eceaf8] bg-white">
        <div className="flex items-center">
          <button onClick={() => setShowFilter(v => !v)}
            data-testid="sms-filter-toggle"
            className="flex-1 flex items-center gap-2 px-4 py-2.5 text-xs text-[#514b81] hover:bg-[#faf9ff] rounded-2xl">
            <SlidersHorizontal className="size-3.5" />
            필터
            {/* 아무것도 안 걸렸으면 '걸린 게 없다'를 분명히 말한다 — 종전엔 기본 기간이 늘 찍혀 있어
                사용자가 필터를 건 적이 없는데도 뭔가 걸려 있는 것처럼 보였다 */}
            <span data-testid="sms-filter-summary" className={filterOn ? 'text-[#7b68ee]' : 'text-[#b0acd6]'}>
              {filterOn ? (
                <>
                  {from || to ? `${effFrom} ~ ${effTo}` : `기본 1개월(${effFrom} ~ ${effTo})`}
                  {regionSi && ` · ${optLabel(regionSi)}`}{regionMyeon && ` · ${optLabel(regionMyeon)}`}{regionRi && ` · ${optLabel(regionRi)}`}
                  {/* ⚠ 기본값 'not_sent'가 STATUS_LABEL에 없어 리터럴 `undefined`가 찍혔다 —
                      상태를 손대지 않은 **가장 흔한 경로**에서만 나오는 결함이었다(3차 판정 재현 100%).
                      라벨이 없는 축은 아예 그리지 않는다. */}
                  {status !== 'all' && status !== 'not_sent' && STATUS_LABEL[status] && ` · ${STATUS_LABEL[status]}`}
                  {assignee && ` · ${optLabel(assignee)}`}
                </>
              ) : `기본 — 1개월(${effFrom} ~ ${effTo}) · 발송 제외`}
            </span>
            <ChevronRight className={`ml-auto size-3.5 transition-transform ${showFilter ? 'rotate-90' : ''}`} />
          </button>
          {filterOn && (
            <button data-testid="sms-filter-clear"
              onClick={clearFilters}   /* 값이 바뀌면 위 effect가 알아서 조회한다 */
              className="mr-3 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#514b81] hover:bg-[#f5f4ff] transition-colors shrink-0">
              필터 해제
            </button>
          )}
        </div>
        {showFilter && (
          <div className="px-4 pb-3 flex flex-wrap items-end gap-2 border-t border-[#f5f4ff] pt-3">
            <label className="text-[11px] text-[#514b81]">기간
              <span className="flex items-center gap-1 mt-1">
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} />
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} />
              </span>
            </label>
            <span className="flex items-center gap-1">
              {/* 기본(빈 값) = 오늘부터 1개월. 좁혔다가 되돌아올 길을 프리셋 안에 둔다 */}
              <button className={`${btn} ${!from && !to ? 'border-[#c3bdf5] bg-[#f5f4ff] text-[#7b68ee]' : ''}`}
                data-testid="period-default"
                onClick={() => { setFrom(''); setTo('') }}>1개월</button>
              <button className={btn} onClick={() => { setFrom(today); setTo(today) }}>오늘</button>
              <button className={btn} onClick={() => { setFrom(addDays(today, 1)); setTo(addDays(today, 1)) }}>내일</button>
              <button className={btn} onClick={() => { setFrom(today); setTo(addDays(today, 7)) }}>이번 주</button>
              {/* 1개월 밖까지 봐야 할 때만 — 명시적으로 누른다(기본이 아니다) */}
              <button className={btn} data-testid="period-all"
                onClick={() => { setFrom(today); setTo(addDays(today, 365)) }}
                title="1년치까지 봅니다 — 건수가 많아 화면이 무거워질 수 있습니다">전체</button>
            </span>
            <label className="text-[11px] text-[#514b81]">지역
              <span className="flex items-center gap-1 mt-1">
                <select className={sel} value={regionSi} onChange={e => { setRegionSi(e.target.value); setRegionMyeon(''); setRegionRi('') }}>
                  <option value="">시/군 전체</option>
                  {(data?.regions.si ?? []).map(s => <option key={s} value={s}>{optLabel(s)}</option>)}
                </select>
                <select className={sel} value={regionMyeon} onChange={e => { setRegionMyeon(e.target.value); setRegionRi('') }}>
                  <option value="">읍/면 전체</option>
                  {(data?.regions.myeon ?? []).map(s => <option key={s} value={s}>{optLabel(s)}</option>)}
                </select>
                <select className={sel} value={regionRi} onChange={e => setRegionRi(e.target.value)}>
                  <option value="">리 전체</option>
                  {(data?.regions.ri ?? []).map(s => <option key={s} value={s}>{optLabel(s)}</option>)}
                </select>
                {/* 제안일 뿐 — 누르기 전에는 아무것도 걸려 있지 않다 */}
                {!regionSi && lastRegion?.si && (
                  <span data-testid="last-region" className="flex items-center gap-1 text-[11px] text-[#7b68ee]">
                    <button className={`${btn} border-[#c3bdf5] bg-[#f5f4ff] text-[#7b68ee]`}
                      data-testid="last-region-apply"
                      title="지난번에 보던 지역으로 좁힙니다"
                      onClick={() => {
                        setRegionSi(lastRegion.si); setRegionMyeon(lastRegion.myeon); setRegionRi(lastRegion.ri)
                      }}>
                      지난번: {[lastRegion.si, lastRegion.myeon, lastRegion.ri].filter(Boolean).join(' · ')}
                    </button>
                    <button className="text-[#b0acd6] hover:text-[#514b81]" title="기억 지우기"
                      data-testid="last-region-forget"
                      onClick={() => {
                        setLastRegion(null)
                        try { localStorage.removeItem(LAST_REGION_KEY) } catch { /* 무시 */ }
                      }}>×</button>
                  </span>
                )}
              </span>
            </label>
            <label className="text-[11px] text-[#514b81]">상태
              <select data-testid="filter-status" className={`${sel} block mt-1`} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
                {/* 기본 — 아직 처리할 것만. 발송됨을 빼면 '남은 일'이 그대로 목록이 된다 */}
                <option value="not_sent">발송 제외</option>
                <option value="all">전체</option>
                <option value="unsent">미발송</option>
                <option value="sent">발송됨</option>
                <option value="failed">실패</option>
                <option value="no_phone">번호없음</option>
                <option value="stuck">확인필요</option>
              </select>
            </label>
            <label className="text-[11px] text-[#514b81]">담당
              <select className={`${sel} block mt-1`} value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">전체</option>
                {(data?.assignees ?? []).map(a => <option key={a} value={a}>{optLabel(a)}</option>)}
              </select>
            </label>
            {/* 필터를 바꾸면 자동으로 조회되므로 이 버튼은 '다시 불러오기'다 —
                남겨 두는 이유: 다른 사람이 방금 발송했을 때 손으로 갱신할 수단이 있어야 한다 */}
            <button className={btn} onClick={reload} disabled={isPending} title="지금 조건으로 다시 불러옵니다">
              {isPending ? '조회 중…' : '다시 조회'}
            </button>
          </div>
        )}
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}
      {moveMsg && <div data-testid="sms-move-msg" className="rounded-lg bg-[#f5f4ff] border border-[#d0ccf5] px-3 py-2 text-xs text-[#514b81]">{moveMsg}</div>}

      {/* ── 목록 ─────────────────────────────────────────────────────────
          **테이블 하나**로 그린다. 종전엔 지역 그룹마다 <table>을 따로 만들어서
          그룹별로 열 너비가 제각각 잡혔고, 그래서 날짜 열이 행마다 다른 위치에 찍혔다
          (같은 표처럼 보이는데 정렬이 안 맞아 읽을 수가 없었다).
          지역 헤더는 별도 <table>이 아니라 colSpan 행으로 끼워 넣는다. */}
      <div className="rounded-2xl border border-[#eceaf8] bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#eceaf8]">
          <span className="text-[11px] text-[#8b87b8]">{rows.length}건</span>
          {/* 지역순은 하루 동선용, 날짜순은 "언제 가나"용 — 지역순에서는 날짜가 오르내려 안 보인다 */}
          <span className="ml-auto flex items-center gap-1">
            <span className="text-[10px] text-[#b0acd6]">정렬</span>
            <button data-testid="sort-region"
              onClick={() => setSortBy('region')}
              className={`h-7 px-2 rounded-lg border text-[11px] transition-colors ${
                sortBy === 'region' ? 'border-[#c3bdf5] bg-[#f5f4ff] text-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}>
              지역순
            </button>
            <button data-testid="sort-date"
              onClick={() => setSortBy('date')}
              className={`h-7 px-2 rounded-lg border text-[11px] transition-colors ${
                sortBy === 'date' ? 'border-[#c3bdf5] bg-[#f5f4ff] text-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'}`}>
              날짜순
            </button>
          </span>
        </div>

        {pastRequested && (
          <p data-testid="sms-past-clamped"
            className="mx-4 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="size-3.5 shrink-0 mt-px" />
            <span>
              시작일을 <b>{from}</b>로 지정했지만 목록은 <b>오늘({today})부터</b> 보여줍니다 —
              지난 방문에는 사전 안내를 보낼 수 없기 때문입니다.
              <b> 안내를 놓친 지난 방문은 위 &lsquo;시기 지남&rsquo;에서 확인하세요.</b>
            </span>
          </p>
        )}
        {rows.length === 0 && !isPending && (
          <p className="py-10 text-center text-xs text-[#8b87b8]">이 조건에 해당하는 건이 없습니다.</p>
        )}

        {/* ⚠ 조회는 평균 3초 걸리는데 그동안 **옛 목록이 새 결과인 척** 남아 있었다.
            독립 판정자 본인이 여기 속아 "광주시 297건" 같은 값을 읽었다 — 사람도 똑같이 속는다.
            지역을 연달아 훑는 것이 이 화면의 주 동선이라 특히 위험하다.
            숫자를 지우지는 않되(깜빡임), 지금 보이는 것이 옛 조건임을 분명히 한다. */}
        {isPending && rows.length > 0 && (
          <div data-testid="sms-list-stale"
            className="flex items-center justify-center gap-1.5 py-1.5 bg-[#faf9ff] border-y border-[#eceaf8] text-[11px] text-[#7b68ee]">
            <Loader2 className="size-3 animate-spin" /> 새 조건으로 불러오는 중 — 아래는 <b>이전 조건</b>의 결과입니다
          </div>
        )}

        {rows.length > 0 && (
          /* ⚠ 좁은 화면에서 **고객 이름이 0px가 됐다**(3차 판정 실측: 900px에서 0, 1024px에서 14px).
             `table-fixed`에서 고정 폭 합이 656px인데 가변 열이 이름 하나뿐이라, 폭이 모자라면
             누구에게 보내는지가 가장 먼저 사라졌다 — 목록의 존재 이유가 먼저 잘린 셈이다.
             가로 스크롤도 안 생겨 되찾을 방법이 없었다.
             ① 이름에 최소 폭을 주고 ② 표를 감싸 가로 스크롤을 허용한다. */
          <div className="overflow-x-auto">
          <table className={`w-full min-w-[820px] text-xs table-fixed transition-opacity ${isPending ? 'opacity-50' : ''}`}>
            <colgroup>
              <col className="w-8" />
              <col className="min-w-[10rem]" />
              <col className="w-24" />
              <col className="w-20" />
              {showAssignee && <col className="w-20" />}
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-40" />
              <col className="w-24" />
            </colgroup>
            {/* 머리글이 없어 "2026-08-24 · 종합 · - · 수신1명"이 무슨 열인지 알 수 없었다 */}
            <thead>
              <tr className="text-[10px] text-[#b0acd6] bg-[#faf9ff]">
                <th className="pl-4 py-1.5" />
                <th className="py-1.5 text-left font-medium">고객</th>
                <th className="py-1.5 text-left font-medium">점검일</th>
                <th className="py-1.5 text-left font-medium">유형</th>
                {showAssignee && <th className="py-1.5 text-left font-medium">담당</th>}
                <th className="py-1.5 text-left font-medium">수신</th>
                <th className="py-1.5 text-left font-medium">상태</th>
                <th className="py-1.5 text-left font-medium">발송일시·사유</th>
                <th className="py-1.5 pr-4" />
              </tr>
            </thead>
            <tbody>
              {sortBy === 'region'
                ? regionGroups.flatMap(g => [
                    <tr key={`h-${g.label}`} className="bg-[#faf9ff] border-t border-[#eceaf8]">
                      <td className="pl-4 py-1.5">
                        <input type="checkbox" className="accent-[#7b68ee]"
                          checked={g.groups.every(r => checked.has(r.key))}
                          onChange={() => toggleGroup(g)} />
                      </td>
                      <td colSpan={showAssignee ? 8 : 7} className="py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="size-3 text-[#b0acd6]" />
                          <span data-testid="sms-region-group" className="text-[11px] font-semibold text-[#090c1d]">{g.label}</span>
                          <span className="text-[11px] text-[#8b87b8]">({g.groups.length}건)</span>
                        </span>
                      </td>
                    </tr>,
                    ...g.groups.map(r => <SmsRow key={r.key} r={r} checked={checked.has(r.key)} onToggle={() => toggle(r.key)} showAssignee={showAssignee}
                    canSend={canSend} onResend={openResend} />),
                  ])
                : sorted.map(r => <SmsRow key={r.key} r={r} checked={checked.has(r.key)} onToggle={() => toggle(r.key)} showAssignee={showAssignee}
                    canSend={canSend} onResend={openResend} />)}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ── 선택 액션 바 */}
      {checkedRows.length > 0 && (
        <div className="sticky bottom-4 rounded-2xl border border-[#d0ccf5] bg-white shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-[#514b81]">
            <b className="text-[#090c1d]">{checkedRows.length}건</b> 선택 · 수신 {checkedRows.reduce((n, r) => n + r.recipientCount, 0)}명
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

      {/* 지도 모달은 AddressMapButton 안으로 들어갔다 — 여기서 따로 그리면 판단이 또 갈라진다 */}
    </div>
  )
}
