import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

/** 점검표 카탈로그(마스터) 로더 — 모바일판 (C1, 2026-10-04).
 *  erp/src/lib/sheet-catalog.ts와 같은 데이터(시트 38행·항목 ~860행, RLS SELECT 전직원)를
 *  supabase에서 직접 읽고 AsyncStorage에 캐시한다 — 오프라인에서도 점검표 화면이 열려야 한다.
 *  ⚠ supabase-js는 요청당 1000행 상한이라 .range() 페이징으로 읽는다(달력 425건 소실 전례). */

export type SheetCatalogItem = {
  sheet_id: string
  item_code: string
  item_name: string
  comprehensive_only: boolean
  facility_type: string | null
  order_num: number | null
  group_code?: string | null
  group_name?: string | null
  group_order?: number | null
  subgroup_name?: string | null
  subgroup_order?: number | null
}

export type SheetRow = { id: string; sheet_code: string; sheet_name: string; version: string }

const CACHE_KEY = 'cache:catalog:v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000   // 마스터는 느리게 변한다 — 수동 새로고침이 보조 축

type CatalogCache = { ts: number; sheets: SheetRow[]; items: SheetCatalogItem[] }

/** 정렬 단일 규약 — erp sortCatalog와 같은 4축 */
function sortCatalog(rows: SheetCatalogItem[]): SheetCatalogItem[] {
  return rows.sort((a, b) =>
    (a.group_order ?? Number.MAX_SAFE_INTEGER) - (b.group_order ?? Number.MAX_SAFE_INTEGER)
    || (a.subgroup_order ?? -1) - (b.subgroup_order ?? -1)
    || (a.order_num ?? 0) - (b.order_num ?? 0)
    || a.item_code.localeCompare(b.item_code))
}

async function fetchFromServer(): Promise<CatalogCache> {
  const { data: sheets, error: sheetErr } = await supabase
    .from('inspection_sheets')
    .select('id, sheet_code, sheet_name, version')
    .order('sheet_code')
  if (sheetErr) throw new Error(sheetErr.message)

  const PAGE = 1000
  const items: SheetCatalogItem[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inspection_sheet_items')
      .select('sheet_id, item_code, item_name, comprehensive_only, facility_type, order_num, group_code, group_name, group_order, subgroup_name, subgroup_order')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as SheetCatalogItem[]
    items.push(...rows)
    if (rows.length < PAGE) break
  }
  return { ts: Date.now(), sheets: (sheets ?? []) as SheetRow[], items: sortCatalog(items) }
}

async function readCache(): Promise<CatalogCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as CatalogCache
  } catch { return null }
}

/** 카탈로그 로드 — 캐시 우선(신선하면 네트워크 0회), 오프라인이면 낡은 캐시라도 쓴다.
 *  forceRefresh = 수동 새로고침(시트 목록 화면의 당겨서 새로고침). */
export async function getCatalog(forceRefresh = false): Promise<CatalogCache> {
  const cached = await readCache()
  if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached
  try {
    const fresh = await fetchFromServer()
    try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)) } catch { /* 캐시 실패는 치명 아님 */ }
    return fresh
  } catch (e) {
    if (cached) return cached   // 오프라인 — 낡은 캐시가 빈 화면보다 낫다
    throw e
  }
}
