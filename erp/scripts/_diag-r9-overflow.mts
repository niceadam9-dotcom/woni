/** 별지 9호 실PDF가 **서식 8쪽인데 물리 9장**으로 나오는 원인 특정.
 *
 *  2026-08-30 `_verify-s70-realpdf.mts` 관측: 응답량이 199/138/25로 크게 다른 세 고객이
 *  **전부 9쪽**이었다 → 데이터 의존이 아니라 구조적 넘침. CSS는 `.page:last-child`로 꼬리 빈 장을
 *  이미 막고 있으므로(base.ts:21) 어느 한 쪽이 실제로 A4를 넘친다는 뜻이다.
 *
 *  방법: 전체 HTML을 쪽 단위로 갈라 **한 쪽씩 따로** 렌더한다. 2장이 나오는 쪽이 범인이다.
 *  (전체를 한 번 찍어 '9쪽'만 보면 어느 쪽인지 영원히 모른다 — 축을 쪼갠다.)
 *
 *  전제: 운영 Gotenberg 터널.
 *    ssh -i ~/.ssh/sjfire-erp-key.pem -N -L 3999:172.18.0.3:3000 root@1.201.116.205
 *  실행: npx tsx --conditions=react-server scripts/_diag-r9-overflow.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const GOTENBERG = process.env.GOTENBERG_URL ?? 'http://localhost:3999'
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean).map(m => [m![1], m![2].trim().replace(/^["']|["']$/g, '')]))
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')

const pdfPages = async (html: string) => {
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  form.append('paperWidth', '8.27'); form.append('paperHeight', '11.69')
  for (const k of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) form.append(k, '0')
  form.append('printBackground', 'true')
  const res = await fetch(`${GOTENBERG.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

const OUT: string[] = []
// 응답이 실린 점검 3건 — 데이터 의존이 아님을 다시 확인하려면 표본이 여럿이어야 한다
const { data: resp } = await admin.from('inspection_sheet_responses').select('inspection_id').limit(400)
const counts = new Map<string, number>()
for (const r of resp ?? []) counts.set(r.inspection_id, (counts.get(r.inspection_id) ?? 0) + 1)
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)

for (const [inspectionId, n] of ranked) {
  const { data: insp } = await admin.from('inspections').select('customer_id').eq('id', inspectionId).single()
  const r9 = await assembleReport9(admin as never, insp!.customer_id, inspectionId)
  const html = renderReport9(r9.data)

  const head = /^([\s\S]*?)<body>/.exec(html)?.[1] ?? ''
  // `<div class="page">` 단위로 가른다 — renderDocument(base.ts:83)가 만든 구조 그대로
  const parts = html.split('<div class="page">').slice(1).map(s => s.replace(/<\/div>\s*<\/body>[\s\S]*$/, ''))
  OUT.push(`\n===== 점검 ${inspectionId.slice(0, 8)} (응답 ${n}건) · 쪽 조각 ${parts.length}개 =====`)

  const total = await pdfPages(html)
  OUT.push(`전체 문서: 물리 ${total}쪽 (서식 ${parts.length}쪽)`)

  for (let i = 0; i < parts.length; i++) {
    const solo = `${head}<body>\n<div class="page">${parts[i]}</div>\n</body></html>`
    const p = await pdfPages(solo)
    const label = /8쪽 중 제(\d)쪽/.exec(parts[i])?.[1] ?? '?'
    OUT.push(`  제${label}쪽 단독 → ${p}장${p > 1 ? '   ← ★넘침' : ''}`)
  }
}

writeFileSync('F:/AI/ERP/_diag-r9-overflow.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
