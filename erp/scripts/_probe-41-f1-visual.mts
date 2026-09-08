/** 소방계획서_41 F-1 — 8쪽 「불량 세부 사항」 육안. **운영 데이터 · 읽기 전용**.
 *
 *  왜 이렇게 하나: 운영 UI로 [PDF 생성]을 누르면 실고객 폴더에 storage 파일 2개와
 *  fire_plan_gen_jobs 행이 남는다(쓰기). 육안에 필요한 것은 **렌더 결과**뿐이므로
 *  제품과 **같은 함수**(assembleReport9 → renderReport9)를 운영 DB에 대고 조회만 해서
 *  HTML을 얻고, Chromium으로 8쪽만 찍는다. 저장·잡 행 0.
 *
 *  ⚠ PDF 엔진은 운영이 Gotenberg, 여기가 Playwright — **둘 다 Chromium**이라 근접 대리이지
 *    동일 보장은 아니다. 조판이 의심스러우면 운영 Gotenberg 1회로 확정할 것.
 *
 *  🚨 산출물(`_f1-report9.html`·`_f1-page8.png`)에는 **운영 고객 실데이터**가 들어간다 —
 *     커밋하지 말 것. 확인 후 지운다(소방계획서_27의 산출물 PII 유출 재발 방지).
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-41-f1-visual.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { chromium } from 'playwright'
import { assembleReport9 } from '../src/lib/report9-assemble.ts'
import { renderReport9, foldDefectGroups, DEFECT_GROUPS } from '../src/lib/doc-templates/report9.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ⚠ assembleReport9 안쪽(sheet-catalog.ts:68)이 **자기 admin 클라이언트를 process.env로** 만든다.
//   안 채우면 'supabaseUrl is required'로 죽거나, 더 나쁘게는 빈 카탈로그로 조용히 0을 낸다
//   (소방계획서_39의 "0/24는 데이터가 아니라 환경이었다"와 같은 함정). 운영 값으로 채운다 — 조회 전용.
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (env[k]) process.env[k] = env[k]
}

// 승리주유소 2026 자체점검 — 불량 7행·설치 대장 9로 4상태가 가장 잘 섞인다
const INSPECTION_ID = 'ad19e760-9fab-49a3-9856-0b15db3b6043'
const CUSTOMER_ID = (await db.from('inspections').select('customer_id').eq('id', INSPECTION_ID).single()).data?.customer_id as string
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL}`)
console.log(`점검 ${INSPECTION_ID} / 고객 ${CUSTOMER_ID}\n`)

const { data, missing } = await assembleReport9(db as never, CUSTOMER_ID, INSPECTION_ID)
console.log(`[1] 조립 완료 — 불량행 ${data.defectRows.length}건 · 미입력 경고 ${missing.length}건`)
console.log(`    applicableGroups = ${data.applicableGroups ? JSON.stringify(data.applicableGroups) : '(미공급 → fold 미발동)'}`)

console.log('\n[2] 그룹별 fold 상태 — 이게 8쪽에 그대로 인쇄된다')
if (!data.applicableGroups) {
  console.log('    ⚠ 미공급이라 4상태 인쇄가 발동하지 않는다(Q-5: 대장 공집합). 육안 의미 없음.')
} else {
  const folds = foldDefectGroups(data.defectRows, data.applicableGroups)
  const KIND = { rows: '사용자 입력 행', refer: '결과참조', ok: '이상없음', na: '해당없음' } as Record<string, string>
  for (const g of DEFECT_GROUPS) {
    const f = folds.get(g)
    console.log(`    ${g.padEnd(8, ' ')} → ${KIND[f?.kind ?? '?'] ?? f?.kind}${f?.rows ? ` (${f.rows.length}행)` : ''}`)
  }
}

const html = renderReport9(data)
writeFileSync(new URL('./_f1-report9.html', import.meta.url), html, 'utf8')
console.log(`\n[3] HTML ${html.length.toLocaleString()}자 → scripts/_f1-report9.html`)

// ── 8쪽만 찍는다 ──
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.emulateMedia({ media: 'print' })

// 8쪽 = 「불량 세부 사항」 표가 있는 마지막 .page
const pages = page.locator('.page')
const n = await pages.count()
console.log(`[4] .page 요소 ${n}개`)
// ⚠ 「불량+세부」로 찾으면 **「작성방법」 안내 쪽이 걸린다**(그 문구를 설명문으로 인용한다).
//   실제로 한 번 그 쪽을 찍었다 — 검증할 뻔한 것이 검증 대상이 아니었다.
//   축을 **fold가 실제로 인쇄하는 문구 + 구분 라벨**로 좁힌다.
const FOLD_TEXTS = ['결과참조', '이상없음', '해당없음']
const cands: number[] = []
for (let i = 0; i < n; i++) {
  const t = (await pages.nth(i).textContent()) ?? ''
  const hasFold = FOLD_TEXTS.some(x => t.includes(x))
  const hasGroups = DEFECT_GROUPS.every(g => t.includes(g))   // 7구분이 전부 있는 쪽 = 그 표
  if (hasFold && hasGroups) cands.push(i)
}
console.log(`  후보 .page = [${cands.join(', ')}]`)
if (cands.length !== 1) {
  console.log(`  ❌ 후보가 ${cands.length}개 — 1개여야 한다(0=못 찾음·2+=축이 헐겁다)`)
  await browser.close(); process.exit(1)
}
const target = cands[0]
console.log(`  8쪽 = .page[${target}]`)
// 안내 쪽을 집지 않았음을 단언
const tt = (await pages.nth(target).textContent()) ?? ''
console.log(`  안내 쪽 아님 확인: '작성방법' 미포함 = ${!tt.includes('작성방법')}`)

const out = new URL('./_f1-page8.png', import.meta.url)
await pages.nth(target).screenshot({ path: out.pathname.replace(/^\//, '') })
console.log(`[5] 저장: scripts/_f1-page8.png`)

// 저장·잡 행이 생기지 않았음을 단언(읽기 전용 보증)
const { count: jobs } = await db.from('fire_plan_gen_jobs')
  .select('id', { count: 'exact', head: true }).eq('inspection_id', INSPECTION_ID)
console.log(`\n[6] 부작용 검사 — 이 점검의 fire_plan_gen_jobs = ${jobs ?? 0}건 (이 스크립트는 INSERT를 하지 않는다)`)
await browser.close()
