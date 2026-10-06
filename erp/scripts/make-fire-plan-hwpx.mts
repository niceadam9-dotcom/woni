/** 소방계획서 한글파일(HWPX) 1단계 시험 — 표지·개정이력·서식 1.1을 ERP 데이터로 채운 파일 1건(읽기 전용).
 *
 *  조립은 소방계획서 엑셀 라우트와 같은 `assembleFirePlan` → `buildFirePlanValues` → `fillFirePlanHwpx`.
 *  DB에는 아무것도 쓰지 않는다. 양식·산출물은 git 무시 폴더 `erp_goal/_Data/`(양식에 이전 작성분 흔적이 있다).
 *
 *  실행:
 *    npx tsx --conditions=react-server scripts/make-fire-plan-hwpx.mts --env=prod                 ← 후보 목록 + 시트별 사상 현황
 *    npx tsx --conditions=react-server scripts/make-fire-plan-hwpx.mts --env=prod --id=<고객 id>   ← 파일 생성
 *  운영은 .env.production을 **파일에서 직접** 읽는다(risk_env_file_ignored — make-report9-hwpx와 같은 규약). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const envName = arg('env') ?? 'staging'
if (envName !== 'prod' && envName !== 'staging') { console.error('--env=prod|staging'); process.exit(2) }
const envFile = new URL(envName === 'prod' ? '../.env.production' : '../.env.local', import.meta.url)
const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
  .map(m => [m![1], m![2].trim().replace(/^["']|["']$/g, '')]))
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0]
const expect = envName === 'prod' ? 'ryuozdhnilfjlahorizh' : 'nwflnzugwylhpdyodyog'
if (host !== expect) { console.error(`환경 불일치: ${envName}인데 ${host}`); process.exit(3) }
console.log(`[${envName}] ${host} — 읽기 전용`)

const { createAdminClient } = await import('../src/lib/supabase/admin')
const { assembleFirePlan } = await import('../src/lib/fire-plan-generate')
const { buildFirePlanValues } = await import('../src/lib/fire-plan-xlsx-values')
const { fillFirePlanHwpx, firePlanHwpxCoverage, FIRE_PLAN_HWPX_STAGE1 } = await import('../src/lib/fire-plan-hwpx')
const { FIRE_PLAN_MANIFEST } = await import('../src/lib/fire-plan-xlsx-manifest')
const { planFirePlanImages } = await import('../src/lib/fire-plan-xlsx-images')
const { FIRE_PLAN_IMAGE_ANCHORS } = await import('../src/lib/fire-plan-anchors')
const { firePlanWorkbookRules } = await import('../src/lib/company-literals')
const { getCompanyProfile } = await import('../src/lib/company-profile')
const admin = createAdminClient()

const id = arg('id')
if (!id) await listCandidates()
else await makeFile(id)

async function listCandidates() {
  const { data, error } = await admin.from('customers')
    .select('id, customer_name, address, use_approval_date, building_grade')
    .eq('is_active', true).not('use_approval_date', 'is', null).order('customer_name').limit(15)
  if (error) { console.error(error.message); process.exitCode = 1; return }
  for (const r of data ?? []) console.log(`${r.id}  ${r.customer_name} · ${r.address ?? ''} · 급수 ${r.building_grade ?? '-'}`)
  console.log('\n── 시트별 사상(엑셀 앵커 → HWPX 칸) ──')
  for (const c of firePlanHwpxCoverage()) if (c.anchors) console.log(`  ${c.mapped === c.anchors ? '✅' : '◐'} ${c.sheet}: ${c.mapped}/${c.anchors}`)
  console.log('\n→ --id=<고객 id>로 다시 실행하면 파일을 만듭니다.')
}

async function makeFile(customerId: string) {
  const year = Number(arg('year') ?? new Date(Date.now() + 9 * 3600_000).getUTCFullYear())
  const { data, images, assets, missing } = await assembleFirePlan(admin, customerId, year)
  const values = buildFirePlanValues(data)
  const tpl = readFileSync(new URL('../templates/fire-plan-form.hwpx', import.meta.url))
  // --all: 전 서식(다음 단계 범위 가늠용). 기본은 1단계(표지·개정이력·1.1)
  const all = process.argv.includes('--all')
  const sheets = all ? FIRE_PLAN_MANIFEST.sheets.map(s => s.name) : FIRE_PLAN_HWPX_STAGE1
  // 라우트와 같은 재료 — 회사정보 문구·사진 배정(엑셀과 같은 planFirePlanImages)
  const company = await getCompanyProfile()
  const imgPlan = planFirePlanImages(images, assets, FIRE_PLAN_IMAGE_ANCHORS)
  const { bytes, stats } = await fillFirePlanHwpx(new Uint8Array(tpl), values, sheets,
    { literals: company ? firePlanWorkbookRules(company) : [], images: imgPlan.targets })
  const outDir = new URL('../../erp_goal/_Data/fire-plan-hwpx/', import.meta.url)
  mkdirSync(outDir, { recursive: true })
  const safe = data.buildingName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'noname'
  const out = new URL(`소방계획서-${safe}-${year}${all ? '-전체' : ''}.hwpx`, outDir)
  writeFileSync(out, bytes)
  console.log(`산출: ${decodeURIComponent(out.pathname)}`)
  console.log(`쓴 칸 ${stats.written} (흔적 정리 ${stats.restored}) · 엑셀 전용 앵커 ${stats.unmapped.length} · 칸 없음 ${stats.missingCell.length} · 중첩 건너뜀 ${stats.skippedNested.length}`)
  if (stats.unmapped.length) console.log('  엑셀 전용:', stats.unmapped.join(' | '))
  if (stats.missingCell.length) console.log('  🚨 칸 없음:', stats.missingCell.join(' | '))
  if (stats.skippedNested.length) console.log('  중첩:', stats.skippedNested.join(' | '))
  console.log(`회사 문구 ${stats.literals}칸 · 그림 ${stats.images}장`, [...imgPlan.notes, ...stats.imageNotes].join(' / '))
  if (missing.length) console.log(`조립 고지 ${missing.length}건(엑셀·PDF와 같음): ${missing.slice(0, 5).join(' / ')}`)
}
