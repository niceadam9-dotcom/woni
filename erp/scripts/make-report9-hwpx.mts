/** B4 0단계 — 소민터 실업로드 시험용 별지 9호 HWPX 1건을 ERP 데이터로 만든다(읽기 전용).
 *
 *  조립은 PDF 별지 9호와 같은 `assembleReport9`(report9-actions.ts 600행과 같은 호출) → `renderReport9Hwpx`.
 *  DB에는 아무것도 쓰지 않는다. 산출물은 git 무시 폴더 `erp_goal/_Data/report9-hwpx/`.
 *
 *  실행:
 *    npx tsx --conditions=react-server scripts/make-report9-hwpx.mts --env=prod              ← 후보 목록
 *    npx tsx --conditions=react-server scripts/make-report9-hwpx.mts --env=prod --id=<점검 id> ← 파일 생성
 *  --env=staging이면 .env.local(스테이징). 운영은 .env.production을 **파일에서 직접** 읽는다
 *  (`--env-file`은 _env.mjs가 .env.local로 덮어써 무시된다 — risk_env_file_ignored). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const envName = arg('env') ?? 'staging'
if (envName !== 'prod' && envName !== 'staging') { console.error('--env=prod|staging'); process.exit(2) }
const envFile = new URL(envName === 'prod' ? '../.env.production' : '../.env.local', import.meta.url)
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
  .map(m => [m![1], m![2].trim().replace(/^["']|["']$/g, '')]))
// 셸·다른 파일 값이 끼지 않게 Supabase 두 값은 **덮어쓴다**
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0]
const expect = envName === 'prod' ? 'ryuozdhnilfjlahorizh' : 'nwflnzugwylhpdyodyog'
if (host !== expect) { console.error(`환경 불일치: ${envName}인데 ${host}`); process.exit(3) }
console.log(`[${envName}] ${host} — 읽기 전용`)

const { createAdminClient } = await import('../src/lib/supabase/admin')
const { assembleReport9 } = await import('../src/lib/report9-assemble')
const { renderReport9Hwpx } = await import('../src/lib/report9-hwpx')
const { SELF_INSPECTION_OR } = await import('../src/lib/doc-status')
const admin = createAdminClient()

const id = arg('id')
if (!id) await listCandidates()
else await makeFile(id)

async function listCandidates() {
  // 후보 — 올해 자체점검 중 완료·진행 건, 최신순 15
  const y = new Date(Date.now() + 9 * 3600_000).getUTCFullYear()
  const { data, error } = await admin.from('inspections')
    .select('id, status, inspection_type, plan_type, inspection_start_date, inspection_end_date, customer_id, customers:customer_id(customer_name, fire_station)')
    .or(SELF_INSPECTION_OR).gte('inspection_start_date', `${y}-01-01`).in('status', ['completed', 'in_progress'])
    .order('inspection_start_date', { ascending: false }).limit(15)
  if (error) { console.error(error.message); process.exitCode = 1; return }
  for (const r of (data ?? []) as unknown as Array<{ id: string; status: string; plan_type: string | null; inspection_type: string; inspection_start_date: string; inspection_end_date: string | null; customers: { customer_name: string; fire_station: string | null } | null }>)
    console.log(`${r.id}  ${r.inspection_start_date}~${r.inspection_end_date ?? ''}  ${r.status.padEnd(11)} ${(r.plan_type ?? r.inspection_type).padEnd(10)} ${r.customers?.customer_name ?? '—'} (${r.customers?.fire_station ?? '관할 미입력'})`)
  console.log('\n→ --id=<점검 id>로 다시 실행하면 파일을 만듭니다.')
}

async function makeFile(id: string) {
const { data: ins, error: insErr } = await admin.from('inspections').select('customer_id').eq('id', id).single()
if (insErr || !ins) { console.error(`점검을 찾지 못했습니다: ${insErr?.message ?? id}`); process.exitCode = 1; return }
const { data, missing } = await assembleReport9(admin, (ins as { customer_id: string }).customer_id, id)
const tpl = readFileSync(new URL('../../erp_goal/_form/별지9호-placeholder.hwpx', import.meta.url))
const { bytes, stats } = await renderReport9Hwpx(tpl, data)

const outDir = new URL('../../erp_goal/_Data/report9-hwpx/', import.meta.url)
mkdirSync(outDir, { recursive: true })
const safe = data.customerName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'noname'
const out = new URL(`별지9호_${safe}_${id.slice(0, 8)}.hwpx`, outDir)
writeFileSync(out, bytes)

console.log(`\n✅ ${decodeURIComponent(out.pathname).replace(/^\//, '')}  (${bytes.length.toLocaleString()} bytes)`)
console.log(`  대상물 ${data.customerName} · 점검 ${data.inspPeriod} · 주된 인력 ${data.main?.name ?? '—'} · 보조 ${data.assistants.length}명`)
console.log(`  자리표시자 ${stats.filled}/${stats.placeholders} 채움(체크칸 제외 빈 칸 ${stats.empty.length}: ${stats.empty.join(', ') || '없음'})`)
console.log(`  3쪽 설치 √ ${stats.checks.ok}/${stats.checks.total}${stats.checks.missed.length ? ` — 못 찾음: ${stats.checks.missed.join(', ')}` : ''}`)
console.log(`  3쪽 결과 ${stats.results.ok}/${stats.results.total}${stats.results.missed.length ? ` — 못 찾음: ${stats.results.missed.join(', ')}` : ''}`)
console.log(`  3쪽 기타·2절 결과 ${stats.extra.page3Marks} · 8쪽 불량 ${stats.extra.defectRows}행${stats.extra.missed.length ? ` — ⚠ 템플릿에서 못 찾음: ${stats.extra.missed.join(', ')}` : ''}`)
console.log(`  4~7쪽 세부 현황 문단 ${stats.specs.matched}/${stats.specs.paragraphs} 짝 · 칸 ${stats.specs.edits} · 3-1 동별 ${stats.specs.s31Rows}행${stats.specs.warnings.length ? ` · ⚠ ${stats.specs.warnings.join(", ")}` : ""}`)
console.log(`  아직 안 채우는 칸: ${stats.unfilled.join(' · ')}`)
for (const w of stats.warnings) console.log(`  ⚠ ${w}`)
if (missing.length) console.log(`  조립기 미입력 안내(PDF와 같음): ${missing.join(', ')}`)
}
