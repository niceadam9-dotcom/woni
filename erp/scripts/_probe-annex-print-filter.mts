// 별지 개별 인쇄 — /inspections/{id}/bundle?types= 필터 + /print-bundle 검증
// 실행: npx tsx scripts/_probe-annex-print-filter.mts   (dev 서버 3000 필요)
// 기존 생성물이 있는 점검 건을 그대로 읽기만 한다 — 생성·저장 없음.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'annex-print-filter@sjfire.test'
let userId = ''

// 생성된 report9 PDF가 있는 점검 건 (탐색 결과 — 없으면 자동 재탐색)
async function findTarget(): Promise<{ id: string; have: string[] }> {
  const { data: jobs } = await raw.from('fire_plan_gen_jobs')
    .select('inspection_id, report_type, status').eq('status', 'done').not('inspection_id', 'is', null).limit(200)
  const byInsp = new Map<string, Set<string>>()
  for (const j of (jobs ?? []) as Array<{ inspection_id: string; report_type: string }>) {
    if (!byInsp.has(j.inspection_id)) byInsp.set(j.inspection_id, new Set())
    byInsp.get(j.inspection_id)!.add(j.report_type)
  }
  for (const [id, kinds] of byInsp) {
    const { data: insp } = await raw.from('inspections').select('customer_id').eq('id', id).maybeSingle()
    if (!insp) continue
    const { data: files } = await raw.storage.from('fire-plans')
      .list(`${(insp as { customer_id: string }).customer_id}/inspections/${id}`, { limit: 1000 })
    const types = [...new Set((files ?? []).map((f: { name: string }) => /^([a-z0-9]+)_\d+\.pdf$/i.exec(f.name)?.[1]).filter(Boolean))] as string[]
    if (types.length > 0) return { id, have: types }
    void kinds
  }
  throw new Error('생성된 별지 PDF가 있는 점검 건이 없습니다 — 먼저 문서를 생성해주세요.')
}

const run = async () => {
  const target = await findTarget()
  console.log(`대상 점검 ${target.id} · 생성된 종류 [${target.have.join(',')}]`)
  const have = target.have[0]                                   // 있는 것
  const missing = ['report4', 'report9', 'report10', 'report11', 'exterior'].find(t => !target.have.includes(t))!

  userId = await mkUser({ email: EMAIL, name: '인쇄필터', employeeId: 'APF-001', role: 'admin' })
  const { browser, page } = await launch()
  try {
    await login(page, EMAIL)
    const url = (q: string) => `${BASE}/inspections/${target.id}/bundle${q}`

    // 1. 필터 없음 = 종전 동작 (회귀)
    const full = await page.request.get(url(''))
    const fullBody = full.ok() ? (await full.body()).length : 0
    check('필터 없음 → 200 PDF (회귀)', full.status() === 200 && fullBody > 1000, `status ${full.status()} size ${fullBody}`)
    check('필터 없음 → Content-Type PDF', (full.headers()['content-type'] ?? '').includes('application/pdf'),
      full.headers()['content-type'] ?? '')

    // 2. 있는 종류 1건 지정 → 200 PDF
    const one = await page.request.get(url(`?types=${have}`))
    const oneBody = one.ok() ? (await one.body()).length : 0
    check(`?types=${have} → 200 PDF`, one.status() === 200 && oneBody > 1000, `status ${one.status()} size ${oneBody}`)
    check(`?types=${have} → 전체 이하 크기`, oneBody > 0 && oneBody <= fullBody, `${oneBody} vs ${fullBody}`)

    // 3. 없는 종류 지정 → 404 + 개별 안내 문구
    const none = await page.request.get(url(`?types=${missing}`))
    const noneJson = await none.json().catch(() => ({}))
    check(`?types=${missing}(미생성) → 404`, none.status() === 404, `status ${none.status()}`)
    check('미생성 안내가 개별 문구', String(noneJson.error ?? '').includes('아직 생성되지 않았습니다'), String(noneJson.error ?? ''))

    // 4. 알 수 없는 종류 → 400 (조용히 무시하지 않는다)
    const bad = await page.request.get(url('?types=report99'))
    const badJson = await bad.json().catch(() => ({}))
    check('?types=report99(오타) → 400', bad.status() === 400, `status ${bad.status()}`)
    check('400 메시지에 문제값 표기', String(badJson.error ?? '').includes('report99'), String(badJson.error ?? ''))

    // 5. 섞임(유효+오타) → 400 (부분 수용 금지)
    const mixed = await page.request.get(url(`?types=${have},report99`))
    check('유효+오타 혼합 → 400', mixed.status() === 400, `status ${mixed.status()}`)

    // 6. 다중 지정 → 200 (골라 묶기)
    const multi = await page.request.get(url(`?types=${have},${missing}`))
    check(`?types=${have},${missing} → 200 (있는 것만 묶음)`, multi.status() === 200, `status ${multi.status()}`)

    // 7. 인쇄 페이지가 파라미터를 넘겨받는다
    await page.goto(`${BASE}/inspections/${target.id}/print-bundle?types=${have}`)
    await page.waitForLoadState('networkidle')
    const html = await page.content()
    const LABEL: Record<string, string> = { report9: '별지 9호', report4: '별지 4호', report10: '별지 10호', report11: '별지 11호', exterior: '외관점검표' }
    check('print-bundle 제목에 문서명 반영', html.includes(LABEL[have] ?? have), `기대 "${LABEL[have]}"`)
    check('print-bundle 페이지 정상 렌더', html.includes('인쇄') && !html.includes('찾을 수 없'), '')
  } finally {
    await browser.close()
    await delUser(userId)
  }
  summary()
}

run().catch(e => { console.error(e); process.exit(1) })
