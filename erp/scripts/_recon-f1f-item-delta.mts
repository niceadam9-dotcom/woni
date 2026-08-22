/** F-1f 결정 재료 ② — 고시 원문 5번(조기진압)·10번(할론) 전용 점검표 문항이
 *  현행 묶음 시트(DB STD-03 스프링클러 · STD-11 할로겐화합물) 문항과 얼마나 다른가 (읽기 전용).
 *
 *  비교 축: ●/○ 마커 + 문항 전문(공백 제거만 — 어휘 정규화는 하지 않는다, 축을 지우면 안 되므로).
 *  같은 문구가 여러 소그룹에 반복되므로 집합이 아니라 **다중집합**으로 센다.
 *  실행: npx tsx scripts/_recon-f1f-item-delta.mts */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(import.meta.dirname, '..', '..', 'erp_goal', '_form', '_별지4호_현행판_추출.txt')
const lines = readFileSync(SRC, 'utf8').split(/\r?\n/)

function bodyStart(num: number): number {
  const re = new RegExp(`^${num}\\. (.+) 점검표\\s*$`)
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue
    if (lines.slice(i + 1, i + 61).join('\n').includes(`${num}-A-001`)) return i
  }
  throw new Error(`${num}번 본문 없음`)
}
/** 본문 안의 ●/○ 문항 줄을 순서대로 수집 */
function sourceItems(num: number): Array<{ comp: boolean; text: string }> {
  const start = bodyStart(num)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\d+\. .+ 점검표\s*$/.test(lines[i])) { end = i; break }
  }
  const out: Array<{ comp: boolean; text: string }> = []
  for (let i = start + 1; i < end; i++) {
    const m = /^([●○])\s*(.+)$/.exec(lines[i].trim())
    if (m) out.push({ comp: m[1] === '●', text: m[2].trim() })
  }
  return out
}

for (const line of readFileSync(path.join(import.meta.dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function dbItems(sheetName: string): Promise<Array<{ comp: boolean; text: string }>> {
  const { data: sh, error: e1 } = await admin.from('inspection_sheets').select('id').eq('sheet_name', sheetName)
  if (e1 || !sh?.length) throw new Error(`시트 '${sheetName}': ${e1?.message ?? '0행'}`)
  const out: Array<{ comp: boolean; text: string }> = []
  for (const s of sh) {
    // 시트 단위 eq — 시트당 최대 수백 행이라 상한 무관이지만 규칙대로 페이지 순회
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('inspection_sheet_items')
        .select('item_name, comprehensive_only').eq('sheet_id', s.id).range(from, from + 999)
      if (error) throw new Error(`items '${sheetName}': ${error.message}`)
      const rows = (data ?? []) as Array<{ item_name: string; comprehensive_only: boolean }>
      out.push(...rows.map(r => ({ comp: r.comprehensive_only, text: r.item_name.trim() })))
      if (rows.length < 1000) break
    }
  }
  return out
}

const key = (i: { comp: boolean; text: string }) => `${i.comp ? '●' : '○'}${i.text.replace(/\s+/g, '')}`
const toBag = (arr: Array<{ comp: boolean; text: string }>) => {
  const m = new Map<string, { n: number; sample: string }>()
  for (const i of arr) {
    const k = key(i)
    m.set(k, { n: (m.get(k)?.n ?? 0) + 1, sample: `${i.comp ? '●' : '○'} ${i.text}` })
  }
  return m
}

const PAIRS = [
  { num: 5, name: '화재조기진압용 스프링클러설비', bundle: '스프링클러설비' },
  { num: 10, name: '할론소화설비', bundle: '할로겐화합물 및 불활성기체소화설비' },
]

for (const p of PAIRS) {
  const src = sourceItems(p.num)
  const db = await dbItems(p.bundle)
  const srcBag = toBag(src), dbBag = toBag(db)

  let covered = 0
  const missing: Array<{ sample: string; short: number }> = []
  for (const [k, v] of srcBag) {
    const have = dbBag.get(k)?.n ?? 0
    covered += Math.min(v.n, have)
    if (have < v.n) missing.push({ sample: v.sample, short: v.n - have })
  }
  console.log(`\n===== ${p.num}번 ${p.name} (원문 ${src.length}문항) vs DB '${p.bundle}' (${db.length}문항) =====`)
  console.log(`  묶음 시트에 같은 문구가 있는 원문 문항: ${covered}/${src.length}`)
  if (missing.length) {
    console.log(`  ✗ 묶음 시트에 없는 ${p.num}번 고유 문항 ${missing.reduce((a, b) => a + b.short, 0)}건:`)
    for (const m of missing) console.log(`    · ${m.sample}${m.short > 1 ? ` ×${m.short}` : ''}`)
  } else {
    console.log('  → 전용 문항 없음: 원문 문항 전부가 묶음 시트에 축자 존재')
  }
}
