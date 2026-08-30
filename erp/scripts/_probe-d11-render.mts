/** D11 육안 축 — 라우트 산출물을 LibreOffice로 렌더해 **마크가 실제로 그려지는가**를 본다.
 *  '열리는가'(PDF 변환 성공)와 '값이 사는가'(렌더 결과에 글자가 있다)는 다른 축이다 — 27 Phase 5에서
 *  이중 이스케이프로 줄바꿈 67칸이 리터럴 '&#10;'이 됐는데 LO는 72쪽으로 멀쩡히 열렸던 전례가 있다.
 *  HTML로 뽑는 이유: PDF는 텍스트 추출 도구(pdftotext)가 이 환경에 없고, HTML은 전 시트를 담는다.
 *  실행: npx tsx scripts/_probe-d11-render.mts
 *
 *  ⚠ 2026-08-30 독립 판정에서 [3][4][6]이 **항진명제**로 판정돼 다시 세웠다. 아래 각 검사의
 *    주석에 무엇이 왜 틀렸는지 적어 두었다 — 다시 전역 개수 축으로 되돌리지 말 것. */
import { readFileSync, mkdtempSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { donorCellForItem } from '../src/lib/xlsx-donor-inject'
import { fetchAllRows } from '../src/lib/supabase/paginate'
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const SRC = 'F:/AI/ERP/_d11-live.xlsx'
const ASSET = 'F:/AI/ERP/erp/templates/report-workbook-full.xlsx'
const INSP = '98e3a13b-881d-4e20-9e42-b68c7c3b88f4'
let pass = 0, fail = 0
const ck = (l: string, ok: boolean, d = '') => { if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${d ? ' — ' + d : ''}`) } }

if (!existsSync(SRC)) throw new Error(`${SRC} 없음 — _probe-d11-live.mts를 먼저 실행`)

// ⚠ 표본이 낡으면 **옛 산출물을 조용히 검증**한다(2026-08-30 판정 지적). 자산이 표본보다
//   나중에 빌드됐으면 이 표본은 그 자산을 반영하지 못하므로 멈춘다.
const srcAt = statSync(SRC).mtime
if (existsSync(ASSET) && statSync(ASSET).mtime > srcAt) {
  throw new Error(`표본이 자산보다 낡았다 — 표본 ${srcAt.toISOString()} < 자산 ${statSync(ASSET).mtime.toISOString()}. _probe-d11-live.mts를 다시 실행할 것`)
}
console.log(`   표본 ${SRC} (${srcAt.toISOString()})`)

const dir = mkdtempSync(join(tmpdir(), 'd11r-'))
copyFileSync(SRC, join(dir, 'wb.xlsx'))
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'html', '--outdir', dir, join(dir, 'wb.xlsx')],
  { timeout: 900_000, windowsHide: true, stdio: 'pipe' })
const files = readdirSync(dir).filter(f => f.endsWith('.html'))
ck('[1] LibreOffice HTML 렌더 성공', files.length > 0, readdirSync(dir).join(','))
const html = files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
console.log(`   렌더 산출 ${files.length}파일 · ${Math.round(html.length / 1024)}KB`)

// PDF도 함께 — 쪽수가 유지되는가
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, join(dir, 'wb.xlsx')],
  { timeout: 900_000, windowsHide: true, stdio: 'pipe' })
const pdf = join(dir, 'wb.pdf')
const pages = existsSync(pdf) ? (readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length : 0
ck('[2] PDF 변환 성공(파일이 열린다)', pages > 0, String(pages))
console.log(`   PDF ${pages}쪽`)

// ── 값이 사는가: 렌더 결과에 마크가 실제로 그려졌는가 ────────────────────────────
//
// ⚠ 종전에는 `count('×') >= want.X` 즉 **문서 전체의 마크 개수 하한**이었다. 대조군 실측 결과
//   주입 0건 워크북에 이미 ○ 202 · × 22가 있었다(범례·타 서식·점검항목 문구의 글머리 ○).
//   그래서 **주입을 통째로 들어내도 초록**이었다 — D트랙이 존재하는 이유가 바로 그 실패 양상
//   ('넣었어야 할 것이 빠졌나를 본 적이 없다')인데 검사가 그것을 그대로 재생산한 셈이다.
//
//   지금은 **행 결속**으로 본다: 그 항목의 문구가 있는 렌더 행에 **마크만 든 칸**이 있는가.
//   전역 개수가 아니라 '그 자리에 그 값이 있는가'라 주입을 빼면 반드시 빨강이 된다.
const wb = XLSX.read(readFileSync(SRC))
const sheets = new Set(wb.SheetNames)

// error를 함께 본다 — 조회가 실패하면 responses=[]가 되어 want가 전부 0이 되고, 아래 단언이
// '0칸을 검사하고 초록'을 내는 가짜 초록이 된다(feedback_supabase_check_error)
const { data: rs, error: rsErr } = await raw.from('inspection_sheet_responses')
  .select('item_code, result').eq('inspection_id', INSP).limit(2000)
if (rsErr) throw new Error(`응답 조회 실패: ${rsErr.message}`)
const responses = (rs ?? []) as Array<{ item_code: string; result: 'O' | 'X' | 'N' }>
if (!responses.length) throw new Error('응답 0건 — 대조 대상이 없어 이 프로브는 무의미하다')

const landed = responses.filter(r => { const l = donorCellForItem(r.item_code); return l && sheets.has(l.sheet) })
const want = { O: 0, X: 0, N: 0 } as Record<string, number>
for (const r of landed) want[r.result]++

// 항목 문구는 DB에서 가져온다 — 자산과 **독립인 축**이라 좌표가 썩으면 결속이 깨져 드러난다.
// ⚠ `.limit(5000)`으로는 못 받는다 — PostgREST는 **요청당 1000행이 하드 상한**이고 나머지는
//   오류 없이 그냥 빠진다(risk_supabase_1000row_cap). 첫 판이 정확히 이 함정을 밟아 사전이
//   1000건에서 잘렸고, 멀쩡한 항목이 'no-name'으로 떨어져 **제품이 빨강으로 보였다**.
//   페이지를 나눠 받으므로 동점 없는 정렬(item_code)을 반드시 건다.
const { rows: items, error: itErr, truncated } = await fetchAllRows<{ item_code: string; item_name: string }>(
  (from, to) => raw.from('inspection_sheet_items').select('item_code, item_name').order('item_code').range(from, to))
if (itErr) throw new Error(`항목 조회 실패: ${itErr}`)
if (truncated) throw new Error('항목 조회가 상한에서 잘렸다 — 사전이 불완전하면 결속 판정이 거짓 빨강을 낸다')
const nameByCode = new Map(items.map(i => [i.item_code, i.item_name]))
if (!nameByCode.size) throw new Error('항목명 0건 — 결속 축을 세울 수 없다')

// 렌더 HTML을 행으로 가르고 각 행을 셀 단위로 쪼갠다.
// 결과칸은 마크 하나만 든 칸이므로 **셀 전체가 마크**로 판정한다 — 문구의 글머리 ○에 걸리지 않는다.
const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => ({
  text: strip(m[1]),
  cells: [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => strip(c[1])),
}))
const norm = (s: string) => s.replace(/^[○●·\s]+/, '').replace(/\s+/g, ' ').trim()

/** 그 항목의 문구가 있는 렌더 행에 기대 마크만 든 칸이 있는가 */
function markBoundToRow(code: string, mark: string): 'ok' | 'no-name' | 'no-row' | 'no-mark' {
  const name = nameByCode.get(code)
  if (!name) return 'no-name'
  const key = norm(name).slice(0, 20)   // 렌더가 줄바꿈을 넣을 수 있어 앞부분으로 건다
  if (key.length < 6) return 'no-name'
  const hit = rows.filter(r => norm(r.text).includes(key))
  if (!hit.length) return 'no-row'
  return hit.some(r => r.cells.some(c => c === mark)) ? 'ok' : 'no-mark'
}

const text = html.replace(/<[^>]*>/g, '')
console.log(`\n   기대 착지: ○ ${want.O} · × ${want.X} · / ${want.N}  (합 ${landed.length})`)
console.log(`   렌더 행 ${rows.length}개 · 항목명 사전 ${nameByCode.size}건`)

// [3] 불량 — 사용자가 "안 보인다"고 신고한 바로 그 축. 전건이 행에 결속돼야 한다.
{
  const xs = landed.filter(r => r.result === 'X')
  const res = xs.map(r => ({ code: r.item_code, v: markBoundToRow(r.item_code, '×') }))
  const bad = res.filter(r => r.v !== 'ok')
  ck(`[3] 불량 ${xs.length}건이 전부 그 항목의 렌더 행에 '×'로 산다`, xs.length > 0 && bad.length === 0,
    bad.map(b => `${b.code}:${b.v}`).join(', '))
  for (const r of res) console.log(`     ${r.code} → ${r.v}`)
}

// [4] 적합 — 표본으로. 문구 글머리 ○에 안 걸리도록 '셀 전체가 ○'로 본다.
{
  const os = landed.filter(r => r.result === 'O').slice(0, 12)
  const bad = os.map(r => ({ code: r.item_code, v: markBoundToRow(r.item_code, '○') })).filter(r => r.v !== 'ok')
  ck(`[4] 적합 표본 ${os.length}건이 그 항목의 렌더 행에 '○'로 산다`, os.length > 0 && bad.length === 0,
    bad.map(b => `${b.code}:${b.v}`).join(', '))
}

ck('[5] 이중 이스케이프 흔적 0 (리터럴 &#10;·&amp;)', !/&amp;#1[03];/.test(html), (html.match(/&amp;#1[03];/g) ?? []).slice(0, 3).join(','))

// [6] ⚠ 종전 이름은 '두부 0'이었으나 그것은 **항진명제였다**(2026-08-30 판정 실증) —
//     두부는 래스터 단계 현상이고 HTML은 코드포인트를 그대로 옮겨 적으므로 **글리프가 없어도
//     U+FFFD가 생기지 않는다**. 비BMP 문자만 든 파일로 확인했더니 원문이 그대로 남고 초록이었다.
//     그래서 이름을 사실대로 바꾼다 — 이 축이 잡는 것은 두부가 아니라 **인코딩 소실**이다.
//     진짜 두부(래스터) 판정은 pdftoppm/pdftotext가 이 환경에 없어 **미검증**이다(risk_tofu_detection).
ck('[6] 인코딩 소실 0 (치환문자 U+FFFD 없음) — ※두부(래스터) 판정 아님', !/�/.test(text),
  '치환문자 U+FFFD 발견')

// [7] 한글이 렌더까지 살아 오는가 — '열리는가'와 구별되는 최소 축
ck('[7] 한글 원문이 렌더에 산다(한글 4자 이상인 행 실재)',
  rows.filter(r => /[가-힣]{4,}/.test(r.text)).length > 50,
  `${rows.filter(r => /[가-힣]{4,}/.test(r.text)).length}행`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
