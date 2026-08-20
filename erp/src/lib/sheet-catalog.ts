import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/** 점검표 카탈로그 캐시 — `inspection_sheet_items`·`inspection_sheets` 단일 로더 (2026-08-20).
 *
 *  왜: 이 둘은 **마스터 데이터**(실측 항목 860행·310KB / 시트 38행)인데 캐시가 없어 전 경로가
 *  매 요청마다 전건을 다시 읽었다. 1000행 상한 때문에 `fetchAllRows` 페이징까지 돈다.
 *  소비처는 화면 2곳이 아니라 5곳이다 — 트리 마운트(sheet-overview)·별지 조립(report9-actions)·
 *  **시트를 열 때마다**(loadSheetCatalog)·[전체 양호]·불량검색.
 *
 *  구조는 `lib/auth.ts:15-44`와 같은 2층이다:
 *    React cache()        요청 내 중복 제거 (page SSR → 액션 → 별지 조립이 같은 요청에 겹칠 때)
 *      └ unstable_cache() 요청 간 캐시. tag 무효화 + TTL 백스톱
 *  `'use cache'`/`cacheTag`는 next.config.ts에 `cacheComponents` 플래그가 없어 쓸 수 없다
 *  (번들 문서 `next/dist/docs/01-app/02-guides/caching-without-cache-components.md`).
 *
 *  ⚠ **무효화 구멍** — `scripts/seed-*.mjs`와 마이그레이션 스크립트는 DB를 직접 쓰므로
 *  `revalidateTag`가 절대 불리지 않는다. 3중 방어로 덮는다:
 *    ① 아래 revalidate TTL(1시간) 백스톱
 *    ② /inspection-sheets 의 관리자용 [카탈로그 캐시 비우기] 버튼
 *    ③ 시드 스크립트 말미 안내 출력
 *  항목(item) 편집 UI가 앞으로 생기면 **그 액션에도 `revalidateTag(SHEET_CATALOG_TAG)`를 붙일 것.**
 *
 *  캐시에는 **범위 필터를 적용하지 않은 원본**을 담는다 — scope는 점검 건마다 다르므로
 *  `isItemInScope`(sheet-scope.ts) 필터는 호출부가 그대로 유지한다. */

export const SHEET_CATALOG_TAG = 'sheet-catalog'

/** 전 소비처가 쓰는 컬럼의 합집합 한 벌 (11컬럼). 개별 소비처는 필요한 것만 읽으면 된다. */
export type SheetCatalogItem = {
  sheet_id: string
  item_code: string
  item_name: string
  comprehensive_only: boolean
  facility_type: string | null
  order_num: number | null
  /** 3층 축(마이그레이션 134) — 미적용 DB 폴백 시 undefined */
  group_code?: string | null
  group_name?: string | null
  group_order?: number | null
  subgroup_name?: string | null
  subgroup_order?: number | null
}

export type SheetRow = { id: string; sheet_code: string; sheet_name: string; version: string }

/** 정렬 단일 규약 — 종전 `loadSheetCatalog`(sheet-actions.ts)와 같은 4축.
 *  그룹 집계(sheet-overview)는 **연속 run 경계**만 보므로 run 안의 순서가 order_num으로 안정돼도
 *  집계 결과는 같다. 종전에 두 곳(sheet-actions·sheet-overview)이 미묘하게 다른 정렬을 각자
 *  구현하던 것을 여기 하나로 모은다. */
function sortCatalog(rows: SheetCatalogItem[]): SheetCatalogItem[] {
  return rows.sort((a, b) =>
    (a.group_order ?? Number.MAX_SAFE_INTEGER) - (b.group_order ?? Number.MAX_SAFE_INTEGER)
    || (a.subgroup_order ?? -1) - (b.subgroup_order ?? -1)
    || (a.order_num ?? 0) - (b.order_num ?? 0)
    || a.item_code.localeCompare(b.item_code))
}

/** 134 미적용 DB에서는 확장 select가 42703(column does not exist)으로 죽는다 —
 *  종전 컬럼으로 재시도한다. 화면이 막히면 안 된다(S6-1 규약).
 *  이 폴백은 종전에 sheet-actions·sheet-overview·report9-actions 세 곳에 흩어져 있었다. */
async function fetchAllItems(): Promise<SheetCatalogItem[]> {
  const admin = createAdminClient()
  // select는 **인라인 리터럴**이어야 한다 — 문자열 상수로 빼면 supabase-js가 리터럴 타입을 잃고
  // 반환이 GenericStringError[]로 추론돼 TS2322가 난다(2026-08-20 실측).
  const ext = await fetchAllRows<SheetCatalogItem>(
    (from, to) => admin.from('inspection_sheet_items')
      .select('sheet_id, item_code, item_name, comprehensive_only, facility_type, order_num, group_code, group_name, group_order, subgroup_name, subgroup_order')
      .range(from, to))
  if (!ext.error) return sortCatalog(ext.rows)

  const legacy = await fetchAllRows<SheetCatalogItem>(
    (from, to) => admin.from('inspection_sheet_items')
      .select('sheet_id, item_code, item_name, comprehensive_only, facility_type, order_num')
      .range(from, to))
  if (legacy.error) throw new Error(`항목 카탈로그 조회 실패: ${legacy.error}`)
  return sortCatalog(legacy.rows)
}

async function fetchAllSheets(): Promise<SheetRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('inspection_sheets')
    .select('id, sheet_code, sheet_name, version').order('sheet_code')
  if (error) throw new Error(`점검표 조회 실패: ${error.message}`)
  return (data ?? []) as SheetRow[]
}

const cachedItems = unstable_cache(fetchAllItems, ['sheet-catalog', 'items'],
  { tags: [SHEET_CATALOG_TAG], revalidate: 3600 })
const cachedSheets = unstable_cache(fetchAllSheets, ['sheet-catalog', 'sheets'],
  { tags: [SHEET_CATALOG_TAG], revalidate: 3600 })

/** 전 시트의 항목 카탈로그 (정렬 고정). 반환 배열을 **호출부에서 정렬·변형하지 말 것** —
 *  같은 요청 안에서 공유되는 객체다. 필터는 새 배열을 만드는 `.filter()`로. */
export const getAllSheetItems = cache(async (): Promise<SheetCatalogItem[]> => cachedItems())

/** 시트 1개의 항목 — 전건 캐시를 메모리에서 거른다(DB 왕복 0회). */
export const getSheetItems = cache(async (sheetId: string): Promise<SheetCatalogItem[]> =>
  (await cachedItems()).filter(i => i.sheet_id === sheetId))

/** 점검표 시트 목록. version을 주면 그 버전만(v2025=자체점검 / v2022=외관). */
export const getSheets = cache(async (version?: string): Promise<SheetRow[]> => {
  const all = await cachedSheets()
  return version ? all.filter(s => s.version === version) : all
})
