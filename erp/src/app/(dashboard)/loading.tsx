/** 대시보드 구역 로딩 경계 — 사이드바·헤더(레이아웃)는 먼저 그려지고 본문만 이 자리에서 기다린다.
 *
 *  ⚠ 이 저장소에는 `loading.tsx`가 **한 개도 없었다**(2026-10-01 실측). 그래서 화면을 옮기면
 *  가장 느린 조회(점검 달력 4초대)가 끝날 때까지 **이전 화면이 그대로 멈춰 있었다** — 사용자는
 *  클릭이 먹었는지 알 수 없어 다시 누른다. 이 파일 하나로 Next가 본문을 Suspense로 감싸
 *  레이아웃을 먼저 흘려보낸다(스트리밍). 조회 자체가 빨라지는 것은 아니다 — 「반응했다」가 보일 뿐이다.
 *
 *  모양은 일부러 단순하게: 머리글 한 줄 + 표 몇 줄의 뼈대. 화면마다 다른 뼈대를 그리려면
 *  각 경로에 loading.tsx를 따로 두면 된다(이 파일은 그 기본값). */
export default function DashboardLoading() {
  return (
    <div data-testid="route-loading" aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="h-7 w-48 rounded-md bg-surface mb-4" />
      <div className="flex gap-2 mb-5">
        <div className="h-8 w-24 rounded-md bg-surface" />
        <div className="h-8 w-24 rounded-md bg-surface" />
        <div className="h-8 w-32 rounded-md bg-surface" />
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-5 rounded bg-paper" style={{ width: `${92 - i * 7}%` }} />
        ))}
      </div>
      <span className="sr-only">불러오는 중</span>
    </div>
  )
}
