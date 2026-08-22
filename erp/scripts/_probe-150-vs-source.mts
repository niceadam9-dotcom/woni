/** 150 검증 — 조기진압(5)·할론(10) 전용 시트를 고시 정본 추출본과 대조 (소방계획서_26 F-1f).
 *
 *  148 프로브(_probe-148-vs-source.mts)와 동형 — 대상만 f1f-sheets.json(5·10번).
 *  1부(원문 자기검증, DB 불필요):
 *   · 추출 JSON의 시트별 항목 수 = 원문 코드 등장 종수 (별도 산출 축으로 재계산)
 *   · 원문에서 ●/○가 줄 선두가 아닌 곳에 붙어 나온 줄이 없는지 — 있으면 추출기가 항목을 삼켰을 수 있다
 *   · ● 개수(종합전용) = JSON comprehensive_only 수
 *  2부(DB 대조, 150 적용 후): STD-05·STD-10 존재 시 시트·항목·순서·●·3층 축 전건 대조.
 *  실행: npx tsx scripts/_probe-150-vs-source.mts  (ENV_FILE로 대상 DB 선택 가능) */
import { readFileSync } from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`); ok ? pass++ : fail++
}

type Item = {
  item_code: string; item_name: string; comprehensive_only: boolean
  group_code: string; group_name: string; group_order: number
  subgroup_name: string | null; subgroup_order: number | null; order_num: number
}
type Sheet = { num: number; sheetName: string; facility: string; items: Item[] }
const sheets: Sheet[] = JSON.parse(readFileSync(path.join(import.meta.dirname, '_out', 'f1f-sheets.json'), 'utf8'))

const src = readFileSync(path.join(import.meta.dirname, '..', '..', 'erp_goal', '_form', '_별지4호_현행판_추출.txt'), 'utf8')
const srcLines = src.split(/\r?\n/)

function bodyRange(num: number): [number, number] {
  const re = new RegExp(`^${num}\\. .+ 점검표\\s*$`)
  for (let i = 0; i < srcLines.length; i++) {
    if (re.test(srcLines[i]) && srcLines.slice(i + 1, i + 61).join('\n').includes(`${num}-A-001`)) {
      for (let j = i + 1; j < srcLines.length; j++) {
        if (/^\d+\. .+ 점검표\s*$/.test(srcLines[j])) return [i, j]
      }
      return [i, srcLines.length]
    }
  }
  throw new Error(`${num}번 본문 없음`)
}

/** 의도된 번호 보정(생성기와 짝) — 고시 5번 원문이 5-L-001을 두 번 부여해(겸용 + 감시제어반 첫 항목,
 *  XML 정본 실측) 첫 등장(겸용)을 5-L-000으로 재부여했다. 여기서는 그 보정을 **양방향**으로 단언한다:
 *  ① 추출물에 5-L-000이 정확히 1건·문구가 '겸용…'이다 ② 원문에는 5-L-001이 중복(종수보다 1 많음)이다.
 *  원문이 개정돼 중복이 사라지면 ②가 깨져 보정을 걷으라는 신호가 된다. */
const DEVIATION: Record<number, { db: string; src: string; namePrefix: string }> = {
  5: { db: '5-L-000', src: '5-L-001', namePrefix: '겸용' },
}

console.log('── 1부. 원문 자기검증')
for (const s of sheets) {
  const [a, b] = bodyRange(s.num)
  const seg = srcLines.slice(a, b)
  const segText = seg.join('\n')
  const codeSet = new Set([...segText.matchAll(new RegExp(`${s.num}-[A-Z]-\\d{3}`, 'g'))].map(m => m[0]))
  const dev = DEVIATION[s.num]
  const expectedCount = codeSet.size + (dev ? 1 : 0)   // 원문 중복 1건은 종수에 안 잡힌다
  check(`${s.num}번 항목 수 = 원문 코드 종수${dev ? '+중복1' : ''} (${s.items.length})`, expectedCount === s.items.length,
    `원문 종수 ${codeSet.size} vs 추출 ${s.items.length} — 차이: ${[...codeSet].filter(c => !s.items.some(i => i.item_code === c)).join(', ')}`)
  const extracted = s.items.map(i => i.item_code)
  const toSource = (c: string) => (dev && c === dev.db ? dev.src : c)
  check(`${s.num}번 코드 전건 원문 실재·중복 없음${dev ? ` (${dev.db}→${dev.src} 보정 반영)` : ''}`,
    extracted.length === new Set(extracted).size && extracted.every(c => codeSet.has(toSource(c))))
  if (dev) {
    const devItems = s.items.filter(i => i.item_code === dev.db)
    check(`${s.num}번 보정 항목 ${dev.db} 1건·문구 '${dev.namePrefix}…'`,
      devItems.length === 1 && devItems[0].item_name.startsWith(dev.namePrefix))
    const srcDupCount = [...segText.matchAll(new RegExp(dev.src.replace(/-/g, '\\-'), 'g'))].length
    check(`${s.num}번 원문 ${dev.src} 중복 실재(2회) — 보정 전제`, srcDupCount === 2, `원문 등장 ${srcDupCount}회`)
  }
  const midMarker = seg.filter(l => { const t = l.trim(); return t && !/^[●○]/.test(t) && /[●○]/.test(t) })
  check(`${s.num}번 중간 마커 줄 0건 (삼킨 항목 없음)`, midMarker.length === 0,
    midMarker.slice(0, 3).map(l => l.trim().slice(0, 70)).join(' | '))
  const srcComp = seg.filter(l => /^●/.test(l.trim())).length
  const jsonComp = s.items.filter(i => i.comprehensive_only).length
  check(`${s.num}번 ● 종합전용 수 일치 (${jsonComp})`, srcComp === jsonComp, `원문 ${srcComp} vs 추출 ${jsonComp}`)
}

// ── 2부. DB 대조 (150 적용 후에만) ──
for (const line of readFileSync(path.join(import.meta.dirname, '..', process.env.ENV_FILE ?? '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
  if (m && !line.trim().startsWith('#')) process.env[m[1]] ??= m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const probe = await admin.from('inspection_sheets').select('id, sheet_code, sheet_name')
  .eq('version', 'v2025').in('sheet_code', sheets.map(s => `STD-${String(s.num).padStart(2, '0')}`))
if (probe.error) throw new Error(probe.error.message)
const dbSheets = (probe.data ?? []) as Array<{ id: string; sheet_code: string; sheet_name: string }>

if (dbSheets.length === 0) {
  console.log('\n── 2부. DB 대조 — 150 미적용(신설 시트 0건) → 건너뜀')
} else {
  console.log(`\n── 2부. DB 대조 (신설 시트 ${dbSheets.length}건)`)
  check('시트 2건 전부 존재', dbSheets.length === sheets.length,
    `DB: ${dbSheets.map(s => s.sheet_code).join(', ')}`)
  for (const s of sheets) {
    const db = dbSheets.find(d => d.sheet_code === `STD-${String(s.num).padStart(2, '0')}`)
    if (!db) { check(`${s.num}번 시트 존재`, false); continue }
    check(`${s.num}번 시트명 축자 '${s.sheetName}'`, db.sheet_name === s.sheetName, `DB '${db.sheet_name}'`)
    const r = await admin.from('inspection_sheet_items')
      .select('item_code, item_name, comprehensive_only, order_num, group_code, group_name, group_order, subgroup_name, subgroup_order')
      .eq('sheet_id', db.id).order('order_num')
    if (r.error) throw new Error(r.error.message)
    const rows = (r.data ?? []) as Item[]
    check(`${s.num}번 항목 ${s.items.length}건`, rows.length === s.items.length, `DB ${rows.length}`)
    let diff = 0
    for (let k = 0; k < Math.min(rows.length, s.items.length); k++) {
      const a = rows[k], b = s.items[k]
      if (a.item_code !== b.item_code || a.item_name !== b.item_name
        || a.comprehensive_only !== b.comprehensive_only || a.group_code !== b.group_code
        || a.group_name !== b.group_name || (a.subgroup_name ?? null) !== (b.subgroup_name ?? null)) {
        if (diff < 3) console.log(`       차이 @${b.item_code}: DB ${JSON.stringify(a)} ≠ 추출 ${JSON.stringify(b)}`)
        diff++
      }
    }
    check(`${s.num}번 전 필드 축자 일치`, diff === 0, `차이 ${diff}건`)
  }
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
// process.exit()는 Windows에서 supabase 핸들 정리와 경합해 libuv 어서션으로 죽는다(uv_handle_closing) —
// exitCode만 세팅하고 자연 종료를 기다린다
process.exitCode = fail ? 1 : 0
