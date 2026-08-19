'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/** 대시보드 구역 오류 경계.
 *
 *  ⚠ 이 저장소에는 `error.tsx`가 **한 개도 없었다**(3차 독립 판정에서 확인).
 *  그래서 서버·액션에서 던진 예외는 Next 기본 오류 화면이나 침묵으로 끝났고,
 *  `"발송 이력을 불러오지 못해 중단했습니다"`처럼 **일부러 쓴 사유가 사용자에게 절대 닿지
 *  않았다.** 사유를 못 보면 사람은 "할 일이 없나 보다"로 읽는다 — 문자 발송에서 그 오해는
 *  방문 전날 전건 미발송으로 이어진다.
 *
 *  여기서 하는 일은 단순하다: **무슨 일이 일어났는지 말하고, 되돌아갈 길을 준다.**
 *  화면을 비우지 않는 것이 요점이다.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard] 처리되지 않은 오류:', error)
  }, [error])

  return (
    <div className="p-6">
      <div data-testid="route-error"
        className="max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-5 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-red-800">화면을 불러오지 못했습니다</h2>
            {/* 사유를 그대로 보여준다 — 이 문구들은 "무엇이 잘못됐는지"를 담아 쓴 것이다.
                감추면 사용자가 '할 일 없음'으로 오해한다. */}
            <p className="mt-1 text-xs text-red-700 break-words">{error.message || '알 수 없는 오류'}</p>
            <p className="mt-2 text-[11px] text-red-600">
              <b>데이터가 없다는 뜻이 아닙니다.</b> 잠시 후 다시 시도하고, 계속되면 이 문구를 그대로 알려주세요.
            </p>
            {error.digest && <p className="mt-1 text-[10px] text-red-400">추적번호 {error.digest}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={reset}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
                <RefreshCw className="size-3.5" /> 다시 시도
              </button>
              <Link href="/inspections/calendar"
                className="h-8 px-3 inline-flex items-center rounded-lg border border-red-300 text-xs text-red-700 hover:bg-red-100">
                점검 달력으로
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
