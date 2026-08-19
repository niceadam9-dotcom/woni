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
export function SmsNoticeWidget({ count, messages, nearest }: {
  count: number
  messages: number
  nearest: { leadDays: number; visitDate: string; label: string; unsentCount: number; messageCount: number; totalCount: number } | null
}) {
  const has = count > 0

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
            </p>
            <p className="text-xs text-[#b0acd6] mt-0.5">
              {nearest
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
