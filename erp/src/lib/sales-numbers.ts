/** 영업 문서 번호 — QT-YYYYMMDD-NNN / OR-YYYYMMDD-NNN (2026-10-02, 불량 → 매출 1단계)
 *
 *  종전에는 quotes/actions.ts·orders/actions.ts가 같은 산식을 각자 들고 있었다. ⑤ 칸에서 불량으로
 *  견적·수주를 만드는 경로가 셋째 호출부가 되면서 한 곳으로 모았다 — 번호 모양이 갈리면 목록 정렬과
 *  검색이 두 규약을 알아야 한다.
 *  ⚠ 'use server' 모듈은 async 함수만 export할 수 있어 이 헬퍼는 일반 lib에 둔다. */
import type { SupabaseClient } from '@supabase/supabase-js'

export type SalesDocTable = 'quotes' | 'orders'

const PREFIX: Record<SalesDocTable, { col: string; tag: string }> = {
  quotes: { col: 'quote_number', tag: 'QT' },
  orders: { col: 'order_number', tag: 'OR' },
}

/** 같은 날짜의 기존 건수 + 1을 세 자리로. 날짜는 'YYYY-MM-DD'. */
export async function nextSalesDocNumber(
  admin: SupabaseClient, table: SalesDocTable, dateISO: string,
): Promise<string> {
  const { col, tag } = PREFIX[table]
  const datePrefix = dateISO.replace(/-/g, '')
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .like(col, `${tag}-${datePrefix}-%`)
  const seq = String((count ?? 0) + 1).padStart(3, '0')
  return `${tag}-${datePrefix}-${seq}`
}
