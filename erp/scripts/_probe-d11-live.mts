/** D11 — **라이브 라우트 실주행**. 지금까지는 무서버 재현이었다(라우트 배선 자체는 미검증).
 *  로그인 → GET /inspections/{id}/workbook → 바이트 저장 → 헤더·셀 감사.
 *  실행: npx tsx scripts/_probe-d11-live.mts */
import { writeFileSync, readFileSync } from 'node:fs'
import XLSX from 'xlsx'
// @ts-expect-error mjs 헬퍼
import { raw, BASE, launch, login, mkUser, delUser } from './_e2e-helpers.mjs'
import { donorCellForItem } from '../src/lib/xlsx-donor-inject'
import { resultMark } from '../src/lib/doc-templates/base'

const CUST = 'c98d316f-21ba-463b-9493-62dacdf44f56'
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'
const OUT = 'F:/AI/ERP/_d11-live.xlsx'
const EMAIL = 'd11-live@erp-test.com'
let pass = 0, fail = 0, userId = '', browser: any = null
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

try {
  userId = await mkUser({ email: EMAIL, name: 'D11실주행', employeeId: 'E2E-D11', role: 'admin' })
  const l = await launch(); browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  const res = await page.request.get(`${BASE}/inspections/${INSP}/workbook`, { timeout: 180_000 })
  ck(`[1] 라우트 200 (실제 상태 ${res.status()})`, res.status() === 200, await res.text().then((t: string) => t.slice(0, 300)).catch(() => ''))
  if (res.status() !== 200) throw new Error(`status ${res.status()}`)

  const missing = decodeURIComponent(res.headers()['x-workbook-missing'] ?? '')
  console.log(`\n  X-Workbook-Missing (${missing.length}자):\n     ${missing.replace(/ \| /g, '\n     ')}\n`)
  ck('[2] 헤더가 600자 한도 안', missing.length <= 600, String(missing.length))
  // 문구는 '응답'이 아니라 '항목'이다 — 분모(total)가 고유 코드 수라 응답 행 수와 갈릴 수 있어
  // 2026-08-30 판정 후 어휘를 맞췄다(donorInjectSummary). 이 검사는 그 변경에 실제로 빨강을 냈다.
  ck('[3] 헤더에 점검표 착지 집계 포함', /점검표 항목 \d+건 중 \d+건 반영/.test(missing), missing.slice(0, 120))
  // 착지 집계는 **맨 앞**이어야 한다 — 뒤에 두면 앞선 항목이 600자를 채워 통째로 잘린다(D11 실사고)
  ck('[3b] 착지 집계가 헤더 맨 앞', /^점검표 항목 \d+건 중 \d+건 반영/.test(missing), missing.slice(0, 60))

  const buf = Buffer.from(await res.body())
  writeFileSync(OUT, buf)
  console.log(`  저장: ${OUT} (${Math.round(buf.length / 1024)}KB)`)

  // ── 도너 축 (D9 재확인, 이번엔 라우트 산출물로)
  const wb = XLSX.read(buf)
  const cv = (s: string, c: string) => String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '').trim()
  // error를 함께 본다 — 조회가 실패하면 responses=[]가 되어 아래 루프가 **0칸을 검사하고 초록**을
  // 낸다(land=0·bad=0). '검사할 것이 없었다'와 '전부 맞았다'는 다른 축이다(feedback_supabase_check_error).
  const { data: rs, error: rsErr } = await raw.from('inspection_sheet_responses')
    .select('item_code, result, month').eq('inspection_id', INSP).limit(2000)
  if (rsErr) throw new Error(`응답 조회 실패: ${rsErr.message}`)
  const responses = (rs ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N'; month: number }>
  if (!responses.length) throw new Error('응답 0건 — 대조 대상이 없어 이 프로브는 무의미하다')
  const sheets = new Set(wb.SheetNames)
  let land = 0, bad: string[] = []
  for (const r of responses) {
    const loc = donorCellForItem(r.item_code)
    if (!loc || !sheets.has(loc.sheet)) continue
    land++
    if (cv(loc.sheet, loc.cell) !== resultMark(r.result)) bad.push(`${r.item_code} ${loc.sheet}!${loc.cell} 기대 '${resultMark(r.result)}' 실제 '${cv(loc.sheet, loc.cell)}'`)
  }
  ck(`[4] 라우트 산출물에서 응답 ${land}칸이 기대 마크`, bad.length === 0, bad.slice(0, 4).join(' · '))
  const xs = responses.filter(r => r.result === 'X')
  const xv = xs.map(r => { const lo = donorCellForItem(r.item_code); return lo && sheets.has(lo.sheet) ? `${r.item_code}=${cv(lo.sheet, lo.cell)}` : `${r.item_code}=(시트없음)` })
  ck(`[5] 불량 ${xs.length}건 인쇄 확인`, xv.every(v => v.endsWith('=×') || v.endsWith('(시트없음)')), xv.join(' '))

  // ── D10: 정보 시트 실인쇄값 + 계단 원천 대조
  console.log('\n=== [D10] 정보 시트 실인쇄값 ===')
  for (const c of ['B5', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'E14', 'I14', 'B19', 'B20', 'B21', 'B22', 'B23'])
    console.log(`  정보!${c.padEnd(4)} = ${cv('정보', c).replace(/\n/g, ' ⏎ ').slice(0, 100)}`)
  console.log('\n=== [D10] 개요 시트 주요 칸 ===')
  for (const c of ['B9', 'B10', 'D21', 'B16', 'D17'])
    console.log(`  개요!${c.padEnd(4)} = ${cv('개요', c).slice(0, 80)}`)

  const { data: b } = await raw.from('buildings').select('stairs_count, ramp_count').eq('customer_id', CUST).eq('is_active', true).limit(1)
  const { data: fpf } = await raw.from('fire_plan_forms').select('sections').eq('customer_id', CUST).single()
  const sec = (fpf as { sections: Record<string, any> }).sections
  console.log('\n=== [D10] 계단 3원천 대조 ===')
  console.log(`  ① 서식 1.1 → buildings.stairs_count = ${JSON.stringify((b ?? [])[0]?.stairs_count)}`)
  console.log(`  ② 서식 1.5 → evacFire.stairs        = ${JSON.stringify(sec['evacFire']?.stairs ?? {})}`)
  console.log(`  → 엑셀 정보!B21                      = ${cv('정보', 'B21')}`)
  console.log(`\n=== [D10] 기타시설(1.6) 입력 vs 엑셀 ===`)
  console.log(`  서식 1.6 etcFacility = ${JSON.stringify(sec['etcFacility'] ?? {}).slice(0, 200)}`)
  console.log(`  갑지에 가스·전기 칸이 있는가: ${wb.SheetNames.filter(n => ['개요', '정보', '보고서', '현황'].includes(n)).map(n => {
    const hit = Object.keys(wb.Sheets[n]).filter(k => !k.startsWith('!')).filter(k => /가스|전기|발전기/.test(String((wb.Sheets[n][k] as XLSX.CellObject).v ?? '')))
    return `${n}:${hit.length}칸${hit.length ? '(' + hit.slice(0, 3).join(',') + ')' : ''}`
  }).join(' · ')}`)
} catch (e) {
  ck('예외 없음', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (userId) await delUser(userId)
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
  process.exit(fail ? 1 : 0)
}
