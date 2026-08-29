/** 소방계획서_33 — 실제 인쇄물에 2차가 '작동'으로 찍히는지 확인 (스테이징 실데이터).
 *
 *  순수 함수 축(test-second-round-operational)은 이미 초록이지만, 그건 '함수가 옳은 값을
 *  돌려준다'까지다. 여기서는 **실제 점검 건을 조립해** 표지 제목·별지 9호 체크칸·파일명이
 *  어떻게 나오는지를 본다. 1차(종합)와 2차(작동)를 나란히 뽑아 **대조군**으로 둔다.
 *
 *  실행: npx tsx --conditions=react-server scripts/_verify-33-print.mts
 *        (server-only 사슬 때문에 --conditions=react-server 필수)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
process.env.NEXT_PUBLIC_SUPABASE_URL ??= env.NEXT_PUBLIC_SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY ??= env.SUPABASE_SERVICE_ROLE_KEY
for (const [k, v] of Object.entries(env)) process.env[k] ??= v

const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const OUT = new URL('../.test-shots/soban33/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(OUT, { recursive: true })

const { createAdminClient } = await import('../src/lib/supabase/admin.ts')
const { assembleCover, assembleOfficial } = await import('../src/lib/annex-cover-official.ts')
const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { annexDownloadName } = await import('../src/lib/annex-filename.ts')
const admin = createAdminClient()

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) }
}

// 2차(작동) 한 건과, 같은 고객의 1차(종합) 한 건을 대조군으로 잡는다
const { data: seq2 } = await raw.from('inspections')
  .select('id, customer_id, sequence_num, inspection_type, plan_type, is_initial, customers(customer_name)')
  .eq('sequence_num', 2).limit(1).single()
if (!seq2) { console.error('스테이징에 2차 점검이 없다'); process.exit(1) }
// 대조군은 **같은 고객으로 한정하지 않는다** — 그 고객에 1차가 없으면 대조가 조용히 건너뛰어져
// '전부 작동이 된 것'과 '2차만 작동이 된 것'을 구별하지 못한다(항진명제).
const { data: seq1 } = await raw.from('inspections')
  .select('id, customer_id, sequence_num, inspection_type, plan_type, is_initial')
  .eq('sequence_num', 1).eq('plan_type', 'special_종합').limit(1).maybeSingle()

const s2 = seq2 as never as { id: string; customer_id: string; inspection_type: string; plan_type: string; customers: { customer_name: string } }
console.log(`\n대상 고객: ${s2.customers?.customer_name}`)
console.log(`  2차: type=${s2.inspection_type} plan_type=${s2.plan_type} (${s2.id})`)
if (seq1) { const a = seq1 as never as { inspection_type: string; plan_type: string }
  console.log(`  1차(대조군): type=${a.inspection_type} plan_type=${a.plan_type}`) }

// ── 1) 표지 ──
console.log('\n[1] 표지(assembleCover)')
const cov2 = await assembleCover(admin, s2.customer_id, s2.id, { forPreview: true })
console.log(`  2차 표지 typeLabel = ${JSON.stringify(cov2.data.typeLabel)}`)
check('2차 표지 제목이 작동점검', cov2.data.typeLabel === '작동점검', String(cov2.data.typeLabel))
// 대조군이 없으면 **통과가 아니라 실패**로 센다 — 대조 없는 초록은 아무것도 증명하지 않는다
if (!seq1) {
  fail++
  console.log('  ❌ 대조군(1차 special_종합)을 못 찾았다 — 대조 없이는 판정 불가')
} else {
  const c1 = seq1 as never as { id: string; customer_id: string }
  const cov1 = await assembleCover(admin, c1.customer_id, c1.id, { forPreview: true })
  console.log(`  1차 표지 typeLabel = ${JSON.stringify(cov1.data.typeLabel)}  ← 대조군`)
  check('1차는 여전히 종합/최초점검(대조군 — 전부 작동이 된 게 아니다)',
    cov1.data.typeLabel === '종합점검' || cov1.data.typeLabel === '최초점검', String(cov1.data.typeLabel))

  const r91 = await assembleReport9(admin, c1.customer_id, c1.id)
  const p1: Record<string, unknown> = (r91 as never as { data: Record<string, unknown> }).data ?? (r91 as never as Record<string, unknown>)
  console.log(`  1차 체크칸 = ${JSON.stringify({ ckOp: p1.ckOp, ckInitial: p1.ckInitial, ckCompEtc: p1.ckCompEtc })}  ← 대조군`)
  check('1차는 ckOp=false (작동 칸이 켜지지 않는다)', p1.ckOp === false, JSON.stringify(p1.ckOp))
  check('1차는 종합 칸이 켜진다(ckCompEtc 또는 ckInitial)', p1.ckCompEtc === true || p1.ckInitial === true,
    JSON.stringify({ ckCompEtc: p1.ckCompEtc, ckInitial: p1.ckInitial }))
}

// ── 2) 공문 ──
console.log('\n[2] 공문(assembleOfficial)')
const off2 = await assembleOfficial(admin, s2.customer_id, s2.id, { forPreview: true })
console.log(`  2차 공문 typeLabel = ${JSON.stringify(off2.data.typeLabel)}`)
check('2차 공문 제목이 작동점검', off2.data.typeLabel === '작동점검', String(off2.data.typeLabel))

// ── 3) 별지 9호 체크칸 ──
console.log('\n[3] 별지 9호(assembleReport9) 표지 체크칸')
const r9 = await assembleReport9(admin, s2.customer_id, s2.id)
const p: Record<string, unknown> = (r9 as never as { data: Record<string, unknown> }).data ?? (r9 as never as Record<string, unknown>)
const ck = { ckOp: p.ckOp, ckInitial: p.ckInitial, ckCompEtc: p.ckCompEtc }
console.log(`  ${JSON.stringify(ck)}`)
check('ckOp = true (작동점검 칸에 체크)', ck.ckOp === true, JSON.stringify(ck))
check('ckCompEtc = false (그 밖의 종합점검 칸 해제)', ck.ckCompEtc === false, JSON.stringify(ck))
check('ckInitial = false', ck.ckInitial === false, JSON.stringify(ck))

// ── 4) 파일명 ──
console.log('\n[4] 다운로드 파일명')
const fn = annexDownloadName({
  kind: 'report4', ext: 'pdf', customerName: s2.customers?.customer_name ?? '고객',
  inspectionType: s2.inspection_type, planType: s2.plan_type, createdAt: null,
} as never)
console.log(`  ${fn}`)
check('파일명이 작동점검 축', /작동/.test(fn) && !/종합/.test(fn), fn)

// ── 5) 사람이 볼 수 있게 표지 HTML 저장 ──
try {
  const { renderCover } = await import('../src/lib/doc-templates/cover.ts')
  const html = renderCover(cov2.data as never)
  writeFileSync(`${OUT}cover-2nd.html`, html, 'utf8')
  console.log(`\n[5] 표지 HTML 저장: ${OUT}cover-2nd.html`)
  const hasOp = html.includes('작동점검'), hasComp = html.includes('종합점검')
  check('표지 HTML 본문에 "작동점검" 존재', hasOp)
  check('표지 HTML 본문에 "종합점검" 없음', !hasComp, '종합점검이 남아 있다')
} catch (e) {
  console.log(`\n[5] 표지 HTML 렌더 생략: ${(e as Error).message}`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
