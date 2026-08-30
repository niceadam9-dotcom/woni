/** S7-0 3중 검증의 두 번째 다리 — **별지 9호 실PDF 대조**.
 *
 *  기준(27.json S7-0)이 "tsc + 별지 9호 실PDF 대조 + test-doc-generation 회귀"를 함께 요구하는데
 *  실PDF 증거가 저장소에 없었다(2026-08-30 판정 D). 그 공백을 메운다.
 *
 *  ⚠ 이 검사의 뜻은 '추출본(lib/report9-assemble)이 실제로 인쇄 가능한 문서를 만드는가'다.
 *  자구 동일 대조는 판정 D가 고정 sha(131af61)로 이미 했다 — 여기는 **런타임 축**이다:
 *  스테이징 실데이터 → 추출본 조립 → 앱과 같은 렌더러 → 앱과 같은 Gotenberg 파라미터 → 실제 PDF.
 *
 *  ⚠ 로컬에는 GOTENBERG_URL이 없다(6개 env 중 .env.production에만 있고 그 값은 도커 내부
 *  호스트명 `gotenberg-prod:3000`이라 이 PC에서 원리적으로 안 닿는다). 그래서 **SSH 터널**로
 *  운영 Gotenberg 컨테이너에 직접 잇는다 — 운영 설정은 바꾸지 않는다(포트 공개 없음):
 *
 *    ssh -i ~/.ssh/sjfire-erp-key.pem -N -L 3999:172.18.0.3:3000 root@1.201.116.205
 *
 *  실행: node node_modules\tsx\dist\cli.mjs scripts\_verify-s70-realpdf.mts
 *  산출: F:/AI/ERP/_s70-realpdf.txt · _s70-page1.png (한글 글리프 육안 증거)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const GOTENBERG = process.env.GOTENBERG_URL ?? 'http://localhost:3999'
// ⚠ 경로는 cwd가 아니라 **스크립트 기준**으로 잡는다(판정자 D 방식) — 실행 위치가 달라지면
//   조용히 빈 env가 되고 'supabaseUrl is required'라는 엉뚱한 곳에서 죽는다(실제로 한 번 겪었다).
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean).map(m => [m![1], m![2].trim().replace(/^["']|["']$/g, '')]))
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL, SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) {
  console.error(`.env.local 파싱 실패 — 키 ${Object.keys(env).length}개: ${Object.keys(env).slice(0, 8).join(', ')}`)
  process.exit(1)
}
const admin = createClient(SUPA_URL, SUPA_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

// ⚠ **동적 import 필수** — `sheet-catalog`가 자기 admin 클라이언트를 `process.env`에서 만든다.
//   정적 import는 호이스팅되어 env를 세우기 **전에** 모듈이 평가되고, 그러면 조용히
//   'supabaseUrl is required'로 죽는다(원인이 내 파서인 줄 알고 한참 헤맸다).
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')

const OUT: string[] = []
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  OUT.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

// ── 대상 고르기 — 응답이 실린 점검을 우선(빈 문서로 통과하면 검사가 무의미하다) ──
const { data: resp } = await admin.from('inspection_sheet_responses')
  .select('inspection_id').limit(400)
const counts = new Map<string, number>()
for (const r of resp ?? []) counts.set(r.inspection_id, (counts.get(r.inspection_id) ?? 0) + 1)
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
check('응답이 실린 점검을 찾았다(빈 문서로 통과 방지)', ranked.length > 0,
  ranked.map(([id, n]) => `${id.slice(0, 8)}:${n}건`).join(' '))
if (!ranked.length) { writeFileSync('F:/AI/ERP/_s70-realpdf.txt', OUT.join('\n') + '\n', 'utf8'); process.exit(1) }

const gotenberg = async (route: string, html: string, extra: Array<[string, string]>) => {
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  // 앱(lib/pdf.ts:54-65)과 **같은 파라미터** — 여기만 다르면 '앱이 찍는 것'을 검증한 게 아니다
  form.append('paperWidth', '8.27'); form.append('paperHeight', '11.69')
  for (const k of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) form.append(k, '0')
  form.append('printBackground', 'true')
  for (const [k, v] of extra) form.append(k, v)
  const res = await fetch(`${GOTENBERG.replace(/\/$/, '')}${route}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  return new Uint8Array(await res.arrayBuffer())
}

let firstPng: Uint8Array | null = null
for (const [inspectionId, nResp] of ranked) {
  const { data: insp } = await admin.from('inspections')
    .select('customer_id, year, sequence_num').eq('id', inspectionId).single()
  if (!insp) { check(`점검 ${inspectionId.slice(0, 8)} 조회`, false); continue }

  // ★ 추출본(lib/report9-assemble)을 실제로 태운다 — 이게 S7-0이 옮긴 그 코드다
  const r9 = await assembleReport9(admin as never, insp.customer_id, inspectionId)
  const html = renderReport9(r9.data)
  check(`[${inspectionId.slice(0, 8)}] 추출본 조립·렌더 성공(응답 ${nResp}건)`, html.length > 10_000,
    `HTML ${html.length}자 · missing ${r9.missing.length}건`)

  const pdf = await gotenberg('/forms/chromium/convert/html', html, [])
  const head = Buffer.from(pdf.slice(0, 5)).toString('latin1')
  const pages = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  check(`[${inspectionId.slice(0, 8)}] 실제 PDF가 나왔다`, head === '%PDF-', `${pdf.length}바이트 head=${head}`)
  // 두 축을 나눠 본다 — 서식 축(HTML이 몇 쪽을 조립했는가)과 물리 축(A4로 찍어 몇 장인가).
  // 뭉치면 '넘침'과 '조립 오류'를 구별할 수 없다.
  // ⚠ **분모를 `8쪽 중 제`로 세면 안 된다.** 별지 9호는 번호 매긴 8쪽 + **「작성방법」(9쪽)**으로
  //   이뤄져 있고 9쪽의 머리글은 `(9쪽)`이라 그 니들에 안 걸린다(report9.ts:602 page9).
  //   처음엔 그렇게 세서 '물리 9쪽 vs 서식 8쪽 = 구조적 넘침'이라 오판했다 — 쪽 단위로 갈라
  //   따로 렌더하니 9조각이 **각각 정확히 1장**이었다(`_diag-r9-overflow.mts`). 넘침은 없었다.
  //   분모는 조립 단위인 `.page` div 수로 잡는다.
  const divs = (html.match(/<div class="page">/g) ?? []).length
  const numbered = (html.match(/8쪽 중 제/g) ?? []).length
  check(`[${inspectionId.slice(0, 8)}] 서식 축 — 번호 8쪽 + 작성방법 1쪽`, numbered === 8 && divs === 9,
    `번호쪽 ${numbered} · 조립 ${divs}`)
  check(`[${inspectionId.slice(0, 8)}] 물리 축 — 넘침 없음`, pages === divs,
    `물리 ${pages}쪽 vs 조립 ${divs}쪽${pages > divs ? ' ← 넘침' : ''}`)

  if (!firstPng) {
    // 한글 글리프 — PDF는 로컬에 pdftoppm이 없어 시각화 불가하므로 **같은 Chromium·같은
    // fontconfig**를 쓰는 screenshot 라우트로 우회한다(소방계획서_33 S5-6과 같은 축)
    firstPng = await gotenberg('/forms/chromium/screenshot/html', html, [['format', 'png']])
    check('스크린샷 렌더 성공(한글 글리프 육안 증거)', firstPng.length > 10_000, `${firstPng.length}바이트`)
  }
}

// ── D-7 축 — PDF가 인쇄하는 값과 갑지 엑셀이 받는 값이 같은 원천인가 ──
// 이번 차수에 배선한 이행조치 기간이 그 대상이다(actionPlanPeriod 단일 원천).
{
  const [inspectionId] = ranked[0]
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  const r9 = await assembleReport9(admin as never, insp!.customer_id, inspectionId)
  const ap = r9.data.actionPeriod
  check('Report9Data.actionPeriod 필드가 실린다(갑지 엑셀 개요!G9·I9·J9의 원천)',
    ap === null || (typeof ap === 'object' && typeof ap.days === 'number'),
    ap ? `${ap.startISO} ~ ${ap.endISO} (${ap.days}일)` : 'null(이 점검엔 이행계획 없음 — 정상)')
}

OUT.push(`\n결과: ${pass} 통과 / ${fail} 실패`)
writeFileSync('F:/AI/ERP/_s70-realpdf.txt', OUT.join('\n') + '\n', 'utf8')
if (firstPng) writeFileSync('F:/AI/ERP/_s70-page1.png', firstPng)
console.log(OUT.join('\n'))
process.exit(fail ? 1 : 0)
