import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, canTouchInspection } from '@/lib/mobile-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveSheetResponsesCore } from '@/app/(dashboard)/inspections/sheet-save-core'

/** 모바일 점검표 응답 저장 (C1, 2026-10-04)
 *
 *  웹 `saveSheetResponsesAction`과 **같은 코어 한 벌**(sheet-save-core.ts)을 탄다 —
 *  범위 가드·병렬 upsert·규약 스탬프·1.4 따라잡기·단계 동기화가 전부 코어에 있다.
 *  proxy.ts가 `/api/mobile/`을 통과시키므로 **첫 줄에서 requireMobileUser**(규약).
 *
 *  충돌 규칙(통합 계획 C1 — 「서버 최신 우선 + 사용자 확인」):
 *  각 행의 `base_updated_at` = 클라이언트가 마지막으로 **본** 서버 updated_at(신규 입력은 null).
 *  서버 행이 그보다 새롭고, 수정자가 남이고, 값이 실제로 다르면 그 행은 저장하지 않고
 *  `conflicts[]`로 돌려준다 — 앱이 사용자에게 서버값/내값을 보여 고르게 한다.
 *  `force: true` 재요청은 검사 없이 덮어쓴다(사용자가 「내 값으로 덮기」를 고른 경우).
 *
 *  멱등: 응답 유니크 (inspection_id, item_code, month) 위의 upsert라 **재전송이 무해**하다 —
 *  오프라인 큐(at-least-once)의 손실 0 근거. 같은 요청이 두 번 와도 행은 한 벌이다. */

type InRow = { item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null; base_updated_at?: string | null }

const RESULTS = new Set(['O', 'X', 'N'])
const MAX_ROWS = 2000   // 시트 38장 전체 항목(~860)보다 넉넉히 — 폭주 방어선일 뿐이다

export async function POST(req: NextRequest) {
  // proxy가 /api/mobile/을 통과시킨다 — 인증은 여기서(lib/mobile-auth)
  const auth = await requireMobileUser(req)
  if ('response' in auth) return auth.response
  try {
    const body = await req.json() as {
      inspectionId?: string; month?: number; force?: boolean
      rows?: InRow[]; clearCodes?: string[]
    }
    const inspectionId = typeof body.inspectionId === 'string' ? body.inspectionId : ''
    const month = Number.isInteger(body.month) ? (body.month as number) : 0
    const rows = Array.isArray(body.rows) ? body.rows : []
    const clearCodes = Array.isArray(body.clearCodes) ? body.clearCodes.filter(c => typeof c === 'string') : []
    if (!inspectionId) return NextResponse.json({ error: '점검 건 id가 필요합니다.' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: '한 번에 저장할 수 있는 항목 수를 넘었습니다.' }, { status: 400 })
    for (const r of rows) {
      if (!r || typeof r.item_code !== 'string' || !RESULTS.has(r.result)) {
        return NextResponse.json({ error: '항목 형식이 올바르지 않습니다.' }, { status: 400 })
      }
    }

    if (!(await canTouchInspection(inspectionId, auth.userId))) {
      return NextResponse.json({ error: '이 점검을 수정할 권한이 없습니다.' }, { status: 403 })
    }

    const admin = createAdminClient()

    // 충돌 검사 — force면 건너뛴다(사용자가 이미 확인했다)
    const conflicts: Array<{
      item_code: string; server: { result: string; memo: string | null; updated_at: string; updated_by: string | null }
    }> = []
    let saveRows = rows
    if (!body.force && rows.length > 0) {
      const { data: current } = await admin.from('inspection_sheet_responses')
        .select('item_code, month, result, memo, updated_at, updated_by')
        .eq('inspection_id', inspectionId).in('item_code', rows.map(r => r.item_code))
      const cur = new Map(
        ((current ?? []) as Array<{ item_code: string; month: number; result: string; memo: string | null; updated_at: string; updated_by: string | null }>)
          .map(c => [`${c.item_code}:${c.month}`, c]),
      )
      const conflicted = new Set<string>()
      for (const r of rows) {
        // 외관(X%)만 월 축 — 저장 payload와 같은 규칙으로 비교해야 엉뚱한 달과 충돌을 내지 않는다
        const m = r.item_code.startsWith('X') ? month : 0
        const c = cur.get(`${r.item_code}:${m}`)
        if (!c) continue   // 서버에 행이 없으면 신규 입력 — 충돌 없음
        const base = r.base_updated_at ?? null
        const serverNewer = !base || new Date(c.updated_at).getTime() > new Date(base).getTime()
        const otherEditor = c.updated_by !== auth.userId
        const differs = c.result !== r.result || (c.memo ?? null) !== (r.memo?.trim() || null)
        if (serverNewer && otherEditor && differs) {
          conflicted.add(r.item_code)
          conflicts.push({
            item_code: r.item_code,
            server: { result: c.result, memo: c.memo, updated_at: c.updated_at, updated_by: c.updated_by },
          })
        }
      }
      if (conflicted.size > 0) saveRows = rows.filter(r => !conflicted.has(r.item_code))
    }

    const result = await saveSheetResponsesCore(
      admin, auth.userId, inspectionId,
      saveRows.map(r => ({ item_code: r.item_code, result: r.result, memo: r.memo })),
      month, clearCodes, 'route',
    )
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({
      saved: saveRows.length,
      conflicts,
      stepsChanged: result.stepsChanged ?? false,
      autoCheck: result.autoCheck ?? null,
    })
  } catch {
    return NextResponse.json({ error: '요청을 처리하지 못했습니다.' }, { status: 400 })
  }
}
