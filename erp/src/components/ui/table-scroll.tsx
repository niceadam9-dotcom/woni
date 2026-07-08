// 헤더 고정 + 레코드 스크롤 목록 컨테이너 — 소방안전관리 목록 공통
// 사용법: <TableScroll><table>…<thead className={STICKY_THEAD}>…</TableScroll>
// offset = 뷰포트에서 뺄 상단 영역(헤더+제목+필터+페이지네이션) 높이(px) — 화면별 조정
export function TableScroll({
  children,
  offset = 300,
}: {
  children: React.ReactNode
  offset?: number
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight: `calc(100vh - ${offset}px)` }}>
      {children}
    </div>
  )
}

// sticky 시 tr의 border-b가 스크롤과 함께 사라지므로 shadow로 하단 경계선을 대신한다
export const STICKY_THEAD =
  'sticky top-0 z-10 bg-[#f8f9fa] shadow-[0_1px_0_0_#c8c4d0]'
