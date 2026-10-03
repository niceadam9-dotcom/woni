/** 설비 대장 엑셀 가져오기 — 순수 파서 (통합계획 C3, 2026-10-02)
 *  선례: lib/hometax-bulk.ts(머리글을 글자로 찾는다 — 열 순서가 바뀌어도 읽는다).
 *  필수 열: 품목·수량·제조연월. 선택: 위치·규격·건물(동). 첫 줄 몇 개 안에서 머리글 줄을 찾는다. */
import { CATEGORIES, CATEGORY_LABEL, normalizeYm, type EquipmentCategory } from '@/lib/equipment-lifespan'

export type ImportedRow = { category: EquipmentCategory; location: string | null; qty: number; manufacturedYm: string | null; subType: string | null; building: string | null }
export type ImportResult = { rows: ImportedRow[]; errors: string[] }

const HEAD: Record<string, string[]> = {
  category: ['품목', '종류', '설비'],
  location: ['위치', '설치위치', '층', '설치 위치'],
  qty: ['수량', '대수', '개수'],
  ym: ['제조연월', '제조년월', '제조일', '제조'],
  sub: ['규격', '용량', '약제'],
  building: ['건물', '동', '건물명'],
}

/** 품목 글자 → 코드. 「분말」「분말소화기」「ABC」 등 느슨하게 */
export function parseCategory(v: string): EquipmentCategory | null {
  const s = v.replace(/\s/g, '')
  if (!s) return null
  for (const c of CATEGORIES) if (CATEGORY_LABEL[c].replace(/\s/g, '') === s || c === s) return c
  if (/자동확산/.test(s)) return 'auto_diffuse'
  if (/분말|ABC|축압|가압/i.test(s)) return 'powder'
  if (/소화기/.test(s)) return 'other_ext'
  if (/완강기/.test(s)) return 'descender'
  if (/호스/.test(s)) return 'hose'
  if (/연기|감지기/.test(s)) return 'smoke_detector'
  if (/가스|용기|CO2|이산화탄소|할론|청정/i.test(s)) return 'gas_cylinder'
  if (/펌프/.test(s)) return 'pump'
  return null
}

/** 엑셀 날짜 일련번호(예: 42064)도 받는다 */
function ymOf(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const s = String(v ?? '').trim()
  return s ? s : null
}

export function parseEquipmentGrid(grid: unknown[][]): ImportResult {
  const errors: string[] = []
  const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '')
  let headIdx = -1
  const col: Partial<Record<keyof typeof HEAD, number>> = {}
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const cells = (grid[r] ?? []).map(norm)
    const found: Partial<Record<keyof typeof HEAD, number>> = {}
    for (const [k, names] of Object.entries(HEAD) as Array<[keyof typeof HEAD, string[]]>) {
      const i = cells.findIndex(c => names.some(n => c === n.replace(/\s/g, '')))
      if (i >= 0) found[k] = i
    }
    if (found.category !== undefined && found.qty !== undefined) { headIdx = r; Object.assign(col, found); break }
  }
  if (headIdx < 0) return { rows: [], errors: ['머리글 줄을 찾지 못했습니다 — 「품목」「수량」 열이 필요합니다(「제조연월」「위치」「규격」「건물」은 선택).'] }
  const rows: ImportedRow[] = []
  for (let r = headIdx + 1; r < grid.length; r++) {
    const line = grid[r] ?? []
    if (line.every(c => String(c ?? '').trim() === '')) continue
    const catRaw = String(line[col.category!] ?? '').trim()
    const category = parseCategory(catRaw)
    const qty = Math.trunc(Number(String(line[col.qty!] ?? '').replace(/[^\d.]/g, '')))
    const ymRaw = col.ym !== undefined ? ymOf(line[col.ym]) : null
    const rowNo = r + 1
    if (!category) { errors.push(`${rowNo}행: 품목을 알 수 없습니다 「${catRaw}」`); continue }
    if (!(qty >= 1)) { errors.push(`${rowNo}행: 수량이 없습니다`); continue }
    if (ymRaw && !normalizeYm(ymRaw)) { errors.push(`${rowNo}행: 제조연월 형식이 아닙니다 「${ymRaw}」(예: 2015-03)`); continue }
    const cell = (k: keyof typeof HEAD) => (col[k] !== undefined ? String(line[col[k]!] ?? '').trim() || null : null)
    rows.push({ category, qty, manufacturedYm: ymRaw ? normalizeYm(ymRaw)!.slice(0, 7) : null, location: cell('location'), subType: cell('sub'), building: cell('building') })
  }
  return { rows, errors }
}
