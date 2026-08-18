/** 공휴일 DB 동기화 (소방계획서_25 S-5) — 크론·관리 화면이 **같은 코드**를 탄다.
 *
 *  종전에는 `api/cron/sync-holidays/route.ts`와 `admin/holidays/actions.ts`가 같은 upsert를
 *  복붙해 갖고 있어 한쪽만 고치면 갈라졌다. 여기로 모은다.
 *
 *  `'use server'`를 붙이지 않는 이유: 그 파일은 export가 곧 공개 엔드포인트가 되고
 *  (소방계획서_17 교훈), 인증이 붙어 검증 스크립트가 부를 수 없게 된다(소방계획서_18 Z-2).
 *  인증·revalidate는 호출부(액션/라우트)가 갖고, 이 파일은 순수하게 동기화만 한다.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { resolveHolidays } from '@/lib/holidays'

type Admin = ReturnType<typeof createAdminClient>

export type SyncResult = {
  year: number
  /** 실제로 쓰인 원천 — 'library'면 API를 못 써서 폴백한 것이고 note에 사유가 있다 */
  source: 'api' | 'library'
  upserted: number
  /** 수동 등록이라 손대지 않은 날짜 */
  skippedManual: string[]
  /** 새 결과에 없어 정리한 자동 생성분 — 과다 생성됐던 대체공휴일이 여기로 빠진다 */
  removedStale: string[]
  note?: string
  error?: string
}

/** 한 해의 공휴일을 DB에 반영한다.
 *
 *  1) 그 해의 `source='manual'` 날짜를 먼저 읽어 **upsert 대상에서 뺀다**
 *     — PostgREST의 upsert는 `ON CONFLICT (date) DO UPDATE SET <전 컬럼>` 고정이라
 *       "manual이면 건드리지 마라"를 SQL 한 방으로 표현할 수 없다. 그래서 앱에서 거른다.
 *       (DB 트리거 `trg_protect_manual_holidays`가 이 실수를 잡는 안전망이다 — 마이그레이션 139)
 *  2) upsert
 *  3) **정리** — 자동 생성분(`api`·`library`) 중 새 결과에 없는 날짜를 지운다.
 *     upsert는 삭제를 하지 않으므로, 이 단계가 없으면 과다 생성됐던 날이 영영 남는다.
 */
export async function syncHolidaysForYear(admin: Admin, year: number): Promise<SyncResult> {
  const from = `${year}-01-01`
  const to = `${year}-12-31`

  let resolved: Awaited<ReturnType<typeof resolveHolidays>>
  try {
    resolved = await resolveHolidays(year)
  } catch (e) {
    return {
      year, source: 'library', upserted: 0, skippedManual: [], removedStale: [],
      error: (e as Error).message,
    }
  }
  const { holidays, source, note } = resolved
  if (holidays.length === 0) {
    return { year, source, upserted: 0, skippedManual: [], removedStale: [], note, error: '공휴일 0건 — 반영하지 않습니다' }
  }

  // 1) 수동 등록분 — 이 날짜는 건드리지 않는다
  const { data: manualRows, error: manualErr } = await admin
    .from('holidays').select('date').eq('source', 'manual').gte('date', from).lte('date', to)
  if (manualErr) {
    return { year, source, upserted: 0, skippedManual: [], removedStale: [], note, error: `수동 등록 조회 실패: ${manualErr.message}` }
  }
  const manualDates = new Set(((manualRows ?? []) as Array<{ date: string }>).map(r => r.date))

  const target = holidays.filter(h => !manualDates.has(h.date))
  const skippedManual = holidays.filter(h => manualDates.has(h.date)).map(h => h.date).sort()

  // 2) upsert
  const rows = target.map(h => ({ date: h.date, name: h.name, is_national: true, source }))
  const { error: upErr } = await admin
    .from('holidays').upsert(rows as unknown as Record<string, unknown>[], { onConflict: 'date' })
  if (upErr) {
    return { year, source, upserted: 0, skippedManual, removedStale: [], note, error: `저장 실패: ${upErr.message}` }
  }

  // 3) 정리 — 자동 생성분 중 새 결과에 없는 날짜
  const keep = new Set(target.map(h => h.date))
  const { data: autoRows, error: autoErr } = await admin
    .from('holidays').select('date').in('source', ['api', 'library']).gte('date', from).lte('date', to)
  if (autoErr) {
    return { year, source, upserted: rows.length, skippedManual, removedStale: [], note, error: `정리 대상 조회 실패: ${autoErr.message}` }
  }
  const stale = ((autoRows ?? []) as Array<{ date: string }>).map(r => r.date).filter(d => !keep.has(d)).sort()

  if (stale.length > 0) {
    // .in('source', …)을 delete에도 다시 건다 — 조회~삭제 사이에 수동 전환된 행을 지우지 않기 위한 이중 방어
    const { error: delErr } = await admin
      .from('holidays').delete().in('date', stale).in('source', ['api', 'library'])
    if (delErr) {
      return { year, source, upserted: rows.length, skippedManual, removedStale: [], note, error: `정리 실패: ${delErr.message}` }
    }
  }

  return { year, source, upserted: rows.length, skippedManual, removedStale: stale, note }
}
