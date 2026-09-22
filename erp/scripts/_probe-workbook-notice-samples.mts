/** `X-Workbook-Missing` **실제 고지 표본 수집** (2026-09-22)
 *  실행: npx tsx scripts/_probe-workbook-notice-samples.mts   (로컬 dev :3000 + 스테이징 DB)
 *
 *  R4 분류표(`lib/workbook-notice.ts`)의 **유일한 원천**이다. 소스에서 push 리터럴을 읽는 것만으로는
 *  부족하다 — 실제로 어떤 조각이 어떤 모양으로 조립돼 나오는지(숫자·구분자·절단 꼬리)는
 *  라우트를 돌려 봐야 안다. `fire-plan-notice.ts:31~35`가 남긴 교훈(추측으로 시트 번호를 읽어
 *  엉뚱한 화면으로 보낸 사고)을 피하려면 표본이 먼저다.
 *
 *  읽기 전용 — 엑셀을 받기만 하고 아무것도 쓰지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
// @ts-expect-error mjs 헬퍼
import { BASE, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'
import { createClient } from '@supabase/supabase-js'

const STAMP = Date.now().toString(36)
const EMAIL = `wb-notice-${STAMP}@test.local`
const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const g = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
const db = createClient(g('NEXT_PUBLIC_SUPABASE_URL'), g('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

let userId = '', browser: { close: () => Promise<void> } | null = null
try {
  // 활성 고객의 자체점검 전건 (결과보고서가 있는 축)
  const y = new Date().getFullYear()
  const { data: insps } = await db.from('inspections')
    .select('id, customer_id, plan_type').gte('year', y - 1).lte('year', y + 1)
  const { data: custs } = await db.from('customers').select('id, is_active, customer_name')
  const cm = new Map((custs ?? []).map(c => [c.id as string, c as { is_active: boolean | null; customer_name: string }]))
  const targets = (insps ?? [])
    .filter(i => !i.plan_type || String(i.plan_type).startsWith('special'))
    .filter(i => cm.get(i.customer_id as string)?.is_active !== false)

  userId = await mkUser({ email: EMAIL, name: '고지표본', employeeId: `E2E-WBN-${STAMP}` })
  const l = await launch(); browser = l.browser
  const { page } = l
  page.setDefaultTimeout(120_000)
  await login(page, EMAIL)

  const samples: Array<{ inspection: string; customer: string; status: number; notice: string }> = []
  for (const t of targets) {
    const res = await page.request.get(`${BASE}/inspections/${t.id}/workbook`, { timeout: 180_000 })
    const raw = res.headers()['x-workbook-missing'] ?? ''
    samples.push({
      inspection: String(t.id).slice(0, 8),
      customer: cm.get(t.customer_id as string)?.customer_name ?? '—',
      status: res.status(),
      notice: raw ? decodeURIComponent(raw) : '',
    })
    process.stdout.write('.')
  }
  console.log('')

  // 조각 단위로 쪼개 **유일한 모양**만 남긴다(숫자만 다른 것은 한 줄로 묶는다)
  const shapes = new Map<string, { count: number; example: string }>()
  for (const s of samples) {
    for (const part of s.notice.split(' | ')) {
      const p = part.trim()
      if (!p) continue
      const shape = p.replace(/\d+/g, 'N').replace(/:.*$/, ': …')
      const cur = shapes.get(shape)
      if (cur) cur.count++
      else shapes.set(shape, { count: 1, example: p })
    }
  }

  console.log(`\n■ 점검 ${samples.length}건 조회 · 고지 있는 건 ${samples.filter(s => s.notice).length}건`)
  console.log(`  상태코드 분포: ${JSON.stringify(samples.reduce((a, s) => ({ ...a, [s.status]: (a[s.status] ?? 0) + 1 }), {} as Record<number, number>))}`)
  console.log(`\n■ 조각 모양 ${shapes.size}종 (빈도순)`)
  for (const [shape, v] of [...shapes].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(v.count).padStart(3)}× ${shape}`)
    if (shape !== v.example) console.log(`        예: ${v.example.slice(0, 120)}`)
  }

  writeFileSync(new URL('../scripts/_fixtures/workbook-notice-samples.json', import.meta.url),
    JSON.stringify({ collectedFrom: 'staging', samples: samples.filter(s => s.notice) }, null, 2), 'utf8')
  console.log('\n표본을 scripts/_fixtures/workbook-notice-samples.json 에 저장했습니다.')
} catch (e) {
  console.error('실패:', e instanceof Error ? e.message : String(e))
} finally {
  if (browser) await browser.close()
  await delUser(userId)
}
