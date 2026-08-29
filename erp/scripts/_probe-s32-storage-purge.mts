/* ─────────────────────────────────────────────────────────────────────────────
 * S10-6 — DEF-2(스토리지 고아) 재현 시험 · 소방계획서_32
 *
 * 왜 별도 프로브인가: _judge-s30-harddel.mts 의 T7-b 는
 *     check('...', okD ? !dl : true)
 * 라 **삭제가 일어났을 때만** 파일 축을 본다. T1으로 대조군 D가 (올바르게) 차단되면서
 * okD=false 가 됐고, 그 순간 T7-b 는 아무것도 시험하지 않은 채 초록이 됐다(공허하게 참).
 * 즉 152 재적용 이후 **DEF-2 는 사실상 미검증 상태**였다.
 *
 * 여기서는 축을 뒤집는다 — 차단되는 고객이 아니라 **삭제 가능한 고객**에 파일을 심고,
 * 실제 삭제 동선(모달 → hardDeleteCustomerAction → _purgeCustomerStorage)을 태운다.
 *
 * 공허한 초록을 막는 장치:
 *   ① 삭제 **전에** 파일이 정말 내려받아지는지 먼저 단언한다(대조군). 이게 없으면
 *      업로드가 조용히 실패했을 때 '삭제 후 없음'이 자동으로 참이 된다 — T7-b가 밟은 함정.
 *   ② 모달에 [완전 삭제] 버튼이 실제로 떴는지 단언한다(안 떴으면 삭제 자체가 없었다).
 *   ③ 중첩 폴더(gen-assets/sub/)를 함께 심어 list()의 비재귀 동작까지 건드린다.
 *
 * 실행: cd F:\AI\ERP\erp; npx tsx scripts/_probe-s32-storage-purge.mts
 * 전제: 로컬 dev(:3000) + 스테이징 DB + 152 21축 적용본.
 * ───────────────────────────────────────────────────────────────────────────── */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, launch, login } from './_e2e-helpers.mjs'

const BUCKET = 'fire-plans'
const EMAIL = 's32-purge-mgr@erp-test.com'
const NAME = '판정S32스토리지'

let userId = ''
let custId = ''
let browser: any = null
/** 심은 파일 — 삭제 후 잔존 확인용. 정리에서도 쓴다. */
let planted: string[] = []

const dl = async (path: string) => {
  const { data } = await raw.storage.from(BUCKET).download(path)
  return !!data
}

/** 버킷 목록에 실재하는가 — **삭제 판정은 반드시 이 축으로 한다**.
 *
 *  ⚠ download()로 판정하면 안 된다. 아래 ①대조군이 삭제 전에 download()를 하는데,
 *  그 호출이 CDN에 객체를 캐시해 **삭제된 뒤에도 200으로 내려온다**. 실측(_probe-s32-storage-diag.mjs
 *  PREWARM=1): 3건 모두 list에서 사라졌는데 download는 2건이 성공했고, 어느 2건인지는
 *  실행마다 달랐다. 즉 공허한 참을 막으려 넣은 대조군이 판정 축 자체를 오염시켰다.
 *  list()는 storage.objects 표를 직접 보므로 캐시를 타지 않는다. */
const inList = async (path: string) => {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const base = path.slice(path.lastIndexOf('/') + 1)
  const { data, error } = await raw.storage.from(BUCKET).list(dir, { limit: 1000 })
  if (error) throw new Error(`목록 조회 실패 ${dir}: ${error.message}`)
  return (data ?? []).some((o: { name: string }) => o.name === base)
}

try {
  userId = await mkUser({ email: EMAIL, name: '스토리지판정', employeeId: 'E2E-S32P' })
  // 삭제 가능해야 하므로 차단축 20종을 하나도 건드리지 않는다.
  // 특히 fire_facilities / fire_facility_floors 를 심으면 facility_ledger 축이 켜져 차단된다.
  custId = await mkCustomer({ customer_name: NAME, address: '경기 양평군 스토리지로 32', created_by: userId })

  // 관계인·건물은 '기본정보(비계)'라 차단축이 아니다 — 연쇄 삭제 대상이다.
  const { error: bErr } = await raw.from('buildings').insert({
    customer_id: custId, building_name: '판정건물', is_active: true, created_by: userId })
  if (bErr) throw new Error(`건물: ${bErr.message}`)
  const { error: kErr } = await raw.from('customer_contacts').insert({
    customer_id: custId, role: '대표', name: '판정관계인' })
  if (kErr) throw new Error(`관계인: ${kErr.message}`)

  // ── 파일 심기: DB 행이 없는 경로들이 핵심이다 ─────────────────────────────
  // {customerId}/assets/ 는 customer-assets.ts 규약이며 **어떤 표에도 행이 없다**.
  // 그래서 FK로도 차단축으로도 따라갈 수 없고, 접두사째 비우는 방식만이 닫는다.
  planted = [
    `${custId}/assets/cover.txt`,
    `${custId}/assets/evac-map.txt`,
    `${custId}/gen-assets/sub/nested.txt`,   // 중첩 — list() 비재귀 동작 확인
  ]
  for (const p of planted) {
    const { error } = await raw.storage.from(BUCKET).upload(p, Buffer.from('s32-probe'), { contentType: 'text/plain' })
    if (error) throw new Error(`업로드 실패 ${p}: ${error.message}`)
  }

  // ① 대조군 — 삭제 **전에** 정말 있는가. 이 단언이 T7-b에는 없었다.
  //   목록·내려받기 두 축 모두로 확인한다(업로드가 조용히 실패하면 뒤 단언이 자동으로 참이 된다).
  const beforeList = await Promise.all(planted.map(inList))
  const beforeDl = await Promise.all(planted.map(dl))
  check('① [대조군] 삭제 전 심은 파일 3종이 목록·내려받기 양쪽에 존재',
    beforeList.every(Boolean) && beforeDl.every(Boolean),
    JSON.stringify(planted.map((p, i) => `${p} list=${beforeList[i]} dl=${beforeDl[i]}`)))

  // ── 삭제 동선 ────────────────────────────────────────────────────────────
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, EMAIL)
  await page.goto(`${BASE}/customers?q=${encodeURIComponent(NAME)}`)
  const row = page.locator('tr', { has: page.getByText(NAME) }).first()
  await row.waitFor({ timeout: 30000 })
  await row.locator('button[title*="삭제"]').click()
  const m = page.locator('[data-testid="delete-customer-modal"]')
  await m.waitFor({ timeout: 15000 })
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="delete-customer-modal"]')?.textContent?.includes('확인하는 중'),
    null, { timeout: 20000 }).catch(() => {})

  const hardBtn = m.locator('[data-testid="hard-delete-btn"]')
  const hardCount = await hardBtn.count()
  // ② 버튼이 없으면 삭제가 일어나지 않았다는 뜻 — 뒤 단언들이 공허해진다
  check('② 삭제 가능 고객이므로 [완전 삭제] 버튼이 뜬다', hardCount === 1,
    `count=${hardCount} / 모달="${((await m.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 220)}"`)

  // ③ 고지 문구에 파일 삭제가 명시돼 있는가 (T3 — 새로 지우는 것이라 고지 대상 신설)
  const modalTxt = ((await m.textContent()) ?? '').replace(/\s+/g, ' ')
  check('③ 모달 고지에 업로드 파일이 함께 지워진다는 문구', /사진|약도|파일/.test(modalTxt), modalTxt.slice(0, 260))

  if (hardCount === 1) {
    await hardBtn.click()
    await m.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})

    const { count: alive } = await raw.from('customers').select('*', { count: 'exact', head: true }).eq('id', custId)
    check('④ 고객 행이 사라졌다', (alive ?? 0) === 0, `alive=${alive}`)

    // ⑤ 핵심 — 접두사 아래 파일이 하나도 남지 않아야 한다 (판정 축 = list, 캐시 무관)
    const afterList = await Promise.all(planted.map(inList))
    const survivors = planted.filter((_, i) => afterList[i])
    check('⑤ [핵심] 심은 파일 3종이 버킷 목록에서 전부 사라졌다 — 고아 0', survivors.length === 0,
      survivors.length ? `고아 잔존: ${survivors.join(', ')}` : '')
    // 참고 축 — 판정하지 않는다. ①이 예열한 CDN 캐시 때문에 삭제 후에도 200이 나올 수 있다.
    const afterDl = await Promise.all(planted.map(dl))
    console.log(`   (참고) 삭제 후 download 응답: ${planted.map((p, i) => `${p.split('/').slice(1).join('/')}=${afterDl[i]}`).join(', ')}`)
    console.log('   ↑ true가 있어도 고아가 아니다 — CDN 캐시 잔상. 판정은 ⑤(list)가 한다.')

    // ⑤b 접두사 전체가 비었는가 — 개별 경로 3건 밖에 남은 것이 없는지까지 본다
    const { data: rootLs } = await raw.storage.from(BUCKET).list(custId, { limit: 1000 })
    check('⑤b 고객 접두사 아래에 남은 항목 없음', (rootLs ?? []).length === 0,
      JSON.stringify((rootLs ?? []).map((o: { name: string }) => o.name)))

    // ⑥ 감사 로그가 몇 개를 지웠는지 남기는가 (storage_removed 메타)
    const { data: logs } = await raw.from('activity_logs')
      .select('metadata').eq('entity_id', custId).eq('action', 'customer_hard_deleted').limit(1)
    const meta = (logs?.[0] as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {}
    check('⑥ activity_logs 메타에 storage_removed=3 기록', meta.storage_removed === 3,
      JSON.stringify(meta))
    check('⑦ storage_error 없음(정리 실패 아님)', !('storage_error' in meta), JSON.stringify(meta))

    if ((alive ?? 0) === 0) { custId = ''; planted = [] }
  }
} catch (e) {
  check('예외 없이 완주', false, String((e as Error)?.stack ?? e))
} finally {
  if (browser) await browser.close().catch(() => {})
  // 정리 — 내가 만든 것만. 삭제가 성공했으면 위에서 비워 두었다.
  if (planted.length) await raw.storage.from(BUCKET).remove(planted).catch(() => {})
  if (custId) {
    await raw.from('customer_contacts').delete().eq('customer_id', custId)
    await raw.from('buildings').delete().eq('customer_id', custId)
    await raw.from('inspection_plan_items').delete().eq('customer_id', custId)
    await raw.from('activity_logs').delete().eq('entity_id', custId)
    const { error } = await raw.from('customers').delete().eq('id', custId)
    if (error) console.error(`⚠ 정리 실패 ${custId}: ${error.message}`)
  }
  if (userId) await delUser(userId)
  summary()
}
