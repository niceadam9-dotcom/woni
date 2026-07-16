import { MapPin, Phone, UserCheck, Calendar, ClipboardList } from 'lucide-react'

/** 우측 고정 요약 패널 (설계 §6-C-2) — 탭을 옮겨도 핵심 정보 상시 표시.
 *  서버 컴포넌트: 페이지가 이미 조회한 데이터만 받는다 (추가 쿼리 없음). 좁은 화면(<xl)은 숨김. */
export function CustomerSummaryPanel({ address, repName, repPhone, employeeName, planDate, lastInspectionDate }: {
  address: string | null
  repName: string | null
  repPhone: string | null
  employeeName: string | null
  planDate: string | null
  lastInspectionDate: string | null
}) {
  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    {
      icon: <MapPin className="size-3.5" />, label: '주소',
      value: address ?? <span className="text-[#b0acd6]">미입력</span>,
    },
    {
      icon: <UserCheck className="size-3.5" />, label: '담당',
      value: employeeName ?? <span className="text-red-500">미배정</span>,
    },
    {
      icon: <Calendar className="size-3.5" />, label: '점검계획일',
      value: planDate ?? <span className="text-amber-600">미입력</span>,
    },
    {
      icon: <Phone className="size-3.5" />, label: '대표',
      value: repName ? (
        <span>
          {repName}
          {repPhone && (
            <a href={`tel:${repPhone}`} className="text-[#7b68ee] hover:underline ml-1.5">{repPhone}</a>
          )}
        </span>
      ) : <span className="text-amber-600">미등록</span>,
    },
    {
      icon: <ClipboardList className="size-3.5" />, label: '최근 점검',
      value: lastInspectionDate ?? <span className="text-[#b0acd6]">없음</span>,
    },
  ]
  return (
    <aside className="hidden xl:block w-60 shrink-0 sticky top-6">
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-4 space-y-3">
        <p className="text-xs font-semibold text-[#514b81]">고객 요약</p>
        {rows.map(r => (
          <div key={r.label} className="flex items-start gap-2">
            <span className="text-[#b0acd6] mt-0.5 shrink-0">{r.icon}</span>
            <div className="min-w-0">
              <p className="text-[10px] text-[#b0acd6]">{r.label}</p>
              <p className="text-xs text-[#090c1d] break-words">{r.value}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
