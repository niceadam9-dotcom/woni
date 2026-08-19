import Link from 'next/link'
import { MessageSquare, ChevronRight, CheckCircle2 } from 'lucide-react'

/** 대시보드 사전 안내 위젯 (소방계획서_24 S9-5)
 *
 *  문자 발송 화면의 승인 배너를 **축약해** 보여준다. 두 곳이 같은 함수
 *  (countUnsentNotices → resolvePendingNotices)로 세므로 수가 갈라지지 않는다.
 *
 *  보낼 것이 없을 때도 한 줄을 남긴다 — 위젯이 통째로 사라지면 "오늘 보낼 게 없다"와
 *  "위젯이 고장났다"를 구분할 수 없다.
 *
 *  서버 컴포넌트다: 대시보드가 이미 서버에서 데이터를 모으고, 이 값도 그때 함께 계산된다. */
export function SmsNoticeWidget({ count, messages, nearest, blockedCount = 0, error }: {
  count: number
  messages: number
  nearest: { leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; totalCount: number; blockedCount?: number } | null
  /** 번호 없음·수신 해제·점검일 미확정 — 보낼 수 **없어서** 사람이 손봐야 하는 곳.
   *  이걸 빼고 세면 내일 방문 5곳이 전부 번호 없음일 때 초록불이 뜬다. */
  blockedCount?: number
  /** 집계 실패 — 위젯을 숨기지 않는다. 숨기면 '할 일 없음'과 구별되지 않는다. */
  error?: string
}) {
  if (error) {
    return (
      <div data-testid="dash-sms-widget"
        className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
        <MessageSquare className="size-4 text-red-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-700">사전 안내 건수를 불러오지 못했습니다</p>
          <p className="text-xs text-red-600 mt-0.5 truncate">보낼 것이 없다는 뜻이 아닙니다 — 문자 발송 화면에서 직접 확인해주세요.</p>
        </div>
        <Link href="/inspections/sms" className="shrink-0 text-xs font-medium text-red-700">확인하러 가기</Link>
        <ChevronRight className="size-4 text-red-400 shrink-0" />
      </div>
    )
  }
  const has = count > 0 || blockedCount > 0

  return (
    <Link
      href="/inspections/sms"
      data-testid="dash-sms-widget"
      className={`flex items-center gap-3 rounded-xl border px-5 py-4 transition-colors ${
        has
          ? 'bg-white border-[#c3bdf5] hover:bg-[#faf9ff]'
          : 'bg-white border-[#c8c4d0] hover:bg-[#fafafa]'
      }`}
    >
      {has
        ? <MessageSquare className="size-4 text-[#7b68ee] shrink-0" />
        : <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />}

      <div className="flex-1 min-w-0">
        {has ? (
          <>
            <p className="text-sm font-semibold text-[#090c1d]">
              보낼 사전 안내 <span className="text-[#7b68ee]">{count}곳</span>
              <span className="text-[#b0acd6] font-normal"> · {messages}통</span>
              {blockedCount > 0 && (
                <span className="text-amber-600 font-normal"> · 보낼 수 없음 {blockedCount}곳</span>
              )}
            </p>
            <p className="text-xs text-[#b0acd6] mt-0.5">
              {blockedCount > 0
                ? '번호가 없거나 점검일이 미확정인 곳이 있습니다 — 그대로 두면 연락 없이 방문하게 됩니다'
                : nearest
                  ? `${nearest.label} ${nearest.totalCount}곳 중 ${nearest.unsentCount}곳 미발송`
                  : '확인하고 승인하면 발송됩니다'}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-[#090c1d]">오늘 보낼 사전 안내가 없습니다</p>
            <p className="text-xs text-[#b0acd6] mt-0.5">
              {nearest ? `${nearest.label} ${nearest.totalCount}곳은 안내를 마쳤습니다` : '설정한 시점에 해당하는 방문이 없습니다'}
            </p>
          </>
        )}
      </div>

      <span className={`shrink-0 text-xs font-medium ${has ? 'text-[#7b68ee]' : 'text-[#b0acd6]'}`}>
        {has ? '확인하고 발송' : '발송 내역'}
      </span>
      <ChevronRight className="size-4 text-[#b0acd6] shrink-0" />
    </Link>
  )
}
