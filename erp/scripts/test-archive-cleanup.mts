// 소방계획서_18 S2 — 보관함 [과거본 정리] + 회차 묶음 라우트 보안 E2E
// 실행: npm run dev 후 npx tsx scripts/test-archive-cleanup.mts
// S3(삭제 전 드라이브 백업)는 D-6으로 폐지 — 게이트는 '종이 보관 완료' 확인 하나뿐이다.
// D-7: 업로드 스캔(cert_/contract_)도 과거 회차면 함께 삭제되고, 그 회차엔 정리 마커가 남아
//      증빙 누락 감시가 '누락'으로 오경고하지 않는다.
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'archive-cleanup-e2e@erp-test.com'
const BUCKET = 'fire-plans'
// 최소 유효 PDF (병합 검증용 아님 — 존재·삭제 검증용 바이트)
const TINY_PDF = new TextEncoder().encode('%PDF-1.4\n%fake for storage e2e\n%%EOF\n')

let userId = ''
let customerId = ''
let inspOld = ''
let inspNew = ''
let inspEmpty = ''
let inspContract = ''
let oldPlanId = ''
let newPlanId = ''
const uploaded: string[] = []
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

async function put(path: string) {
  const { error } = await raw.storage.from(BUCKET).upload(path, Buffer.from(TINY_PDF), { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`업로드 실패 ${path}: ${error.message}`)
  uploaded.push(path)
}
async function exists(path: string): Promise<boolean> {
  const dir = path.split('/').slice(0, -1).join('/')
  const name = path.split('/').pop()!
  const { data } = await raw.storage.from(BUCKET).list(dir, { limit: 1000 })
  return (data ?? []).some(f => f.name === name)
}
/** 고객 폴더 하위 전체 파일 수 — 화면 문구가 아니라 실제 잔존으로 멱등을 판정하기 위한 것 */
async function countFiles(prefix: string): Promise<number> {
  const { data } = await raw.storage.from(BUCKET).list(prefix, { limit: 1000 })
  let n = 0
  for (const o of data ?? []) {
    if (o.id === null) n += await countFiles(`${prefix}/${o.name}`)
    else n++
  }
  return n
}

try {
  // ── 셋업 ──
  userId = await mkUser({ email: EMAIL, name: '정리E2E', employeeId: 'E2E-ARC' })
  customerId = await mkCustomer({ customer_name: '과거본정리E2E고객', created_by: userId })

  // 계획서 3건 — 최신 판정 축 경계: 과거 연도본(2024)을 **가장 나중에** 업로드해 둔다.
  // created_at으로 최신을 고르면 2024본이 최신이 되어 2026본이 삭제된다(연도·개정 차수가 옳은 축).
  const oldPdf = `${customerId}/2025/plan_old.pdf`
  const newPdf = `${customerId}/2026/plan_new.pdf`
  const lateUploadedOldPdf = `${customerId}/2024/plan_2024.pdf`
  await put(oldPdf); await put(newPdf); await put(lateUploadedOldPdf)
  const { data: p1 } = await raw.from('fire_plans').insert({
    customer_id: customerId, year: 2025, title: '과거본E2E', pdf_name: 'old.pdf', pdf_path: oldPdf,
    uploaded_by: userId, created_at: '2025-03-01T00:00:00+09:00',
  }).select('id').single()
  const { data: p2 } = await raw.from('fire_plans').insert({
    customer_id: customerId, year: 2026, title: '최신본E2E', pdf_name: 'new.pdf', pdf_path: newPdf,
    uploaded_by: userId, created_at: '2026-03-01T00:00:00+09:00',
  }).select('id').single()
  await raw.from('fire_plans').insert({
    customer_id: customerId, year: 2024, title: '늦게올린2024본', pdf_name: '2024.pdf', pdf_path: lateUploadedOldPdf,
    uploaded_by: userId, created_at: '2026-06-01T00:00:00+09:00',   // 생성일로는 가장 최신
  })
  oldPlanId = p1!.id; newPlanId = p2!.id

  // 부속자료(지도·사진) — fire_plans 행이 CASCADE로 지워지면 파일이 고아가 된다(함께 지워야 함)
  const attPath = `${customerId}/att/${oldPlanId}/map.png`
  await put(attPath)
  await raw.from('fire_plan_attachments').insert({
    fire_plan_id: oldPlanId, kind: '지도', file_name: 'map.png', file_path: attPath, uploaded_by: userId,
  })

  // 개정이력 — 과거본에 연결(FK SET NULL 검증, D-5)
  await raw.from('fire_plan_revisions').insert({
    customer_id: customerId, year: 2025, seq: 1, revised_on: '2025-03-01',
    content: '정리E2E 개정이력', source: 'uploaded', fire_plan_id: oldPlanId,
  })

  // 회차 3개 — 과거(2025-1차, 파일 2)·최신(2026-1차, 최신+구본)·빈(2026-2차)
  // year는 GENERATED 컬럼(002:109 — inspection_start_date에서 파생) — 직접 insert 금지
  const mkInsp = async (year: number, seq: number) => {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: customerId, inspection_type: '작동', sequence_num: seq, plan_type: 'special_작동',
      inspection_start_date: `${year}-05-01`, status: 'completed', created_by: userId,
      assigned_employee_id: userId,   // NOT NULL
    }).select('id').single()
    if (error) throw new Error(`회차 시드 실패: ${error.message}`)
    return data!.id as string
  }
  inspOld = await mkInsp(2025, 1)
  inspNew = await mkInsp(2026, 1)
  // 계약서 스캔만 있는 과거 회차 — 삭제는 되지만 '배치확인서 정리' 마커는 남으면 안 된다
  // (남으면 진짜 배치확인서 누락 경고가 영구히 덮인다)
  inspContract = await mkInsp(2023, 1)
  // 산출물 0건 회차 — 작동점검은 sequence_num=1만 허용(2차는 종합 전용)이라 연도를 달리한다.
  // 파일이 없어 정리 대상 집계(파일 있는 회차만 본다)에는 잡히지 않는다.
  inspEmpty = await mkInsp(2024, 1)

  await put(`${customerId}/inspections/${inspOld}/report9_100.pdf`)
  await put(`${customerId}/inspections/${inspOld}/report9_100.html`)
  await put(`${customerId}/inspections/${inspOld}/cert_100.pdf`)      // 업로드 스캔 — 과거 회차라 삭제 대상(D-7)
  await put(`${customerId}/inspections/${inspContract}/contract_50.pdf`)  // 계약서만 있는 과거 회차
  await put(`${customerId}/inspections/${inspNew}/report9_200.pdf`)   // 구본
  await put(`${customerId}/inspections/${inspNew}/report9_300.pdf`)   // 최신
  await put(`${customerId}/inspections/${inspNew}/report4_250.pdf`)   // 최신(유일)
  // 최신 회차 스캔 2장 — 같은 슬롯의 서로 다른 원본이라 '구본'으로 지우면 유실이다. 둘 다 잔존해야 한다.
  await put(`${customerId}/inspections/${inspNew}/cert_400.pdf`)
  await put(`${customerId}/inspections/${inspNew}/cert_500.pdf`)

  const l = await launch()
  browser = l.browser
  const page = l.page

  // ── [1] bundle 라우트 보안 — 미로그인 차단 (공개 엔드포인트 교훈) ──
  // 리다이렉트를 따라가면 /login 페이지의 200이 되므로 원 응답을 그대로 본다.
  const anon = await page.request.get(`${BASE}/inspections/${inspNew}/bundle`, { maxRedirects: 0 })
  check('bundle 미로그인 차단(401 또는 로그인 리다이렉트)',
    anon.status() === 401 || [302, 307].includes(anon.status()), `status=${anon.status()}`)
  check('bundle 미로그인 — PDF 본문 유출 없음',
    !(anon.headers()['content-type'] ?? '').includes('application/pdf'))

  await login(page, EMAIL)

  // ── [2] bundle 산출물 0건 회차 404 ──
  const empty = await page.request.get(`${BASE}/inspections/${inspEmpty}/bundle`)
  check('bundle 빈 회차 404 + 안내', empty.status() === 404 && (await empty.text()).includes('생성된 별지 PDF가 없습니다'),
    `status=${empty.status()}`)

  // ── [3] 보관함 — 대상 확인 ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=archive`)
  await page.waitForSelector('[data-testid=archive-cleanup]')
  check('과거본 정리 블록 노출', await page.isVisible('text=과거본 정리'))
  await page.click('button:has-text("대상 확인")')
  await page.waitForSelector('text=총 8개 파일이 삭제됩니다')
  // 보관함 본문에도 계획서 목록이 있으므로 정리 블록 안으로 한정해서 본다
  const block = page.locator('[data-testid=archive-cleanup]')
  check('대상 — 계획서 과거본 1건', await block.locator('text=과거본E2E').isVisible())
  check('대상 — 최신본은 삭제 목록에 없음', await block.locator('text=최신본E2E').count() === 0)
  check('대상 — 과거 회차 2025년 1차 (2개)', await page.isVisible('text=2025년 1차 (파일 2개)'))
  check('대상 — 최신 회차 구본 1개', await page.isVisible('text=구본(재생성 이전 파일): 1개'))
  // D-7 — 업로드 스캔은 별도 표기(종이 원본 보유 확인을 유도)
  check('대상 — 업로드 스캔 2개 별도 고지', await page.isVisible('text=업로드 스캔 2개(배치확인서·계약서)가 함께 삭제됩니다'))
  // 최신 판정 축 — 나중에 올린 과거 연도본이 '최신'을 가로채면 안 된다
  check('대상 — 늦게 올린 2024본도 삭제 대상', await block.locator('text=늦게올린2024본').isVisible())
  // 같은 라벨이 둘일 수 있어 연도 표기가 없으면 무엇이 지워지는지 식별되지 않는다
  check('대상 — 라벨에 연도 표기', await block.locator('text=2024년 늦게올린2024본').isVisible())
  // 부속자료 — CASCADE로 행이 사라지므로 파일도 함께 지운다는 사실을 고지
  check('대상 — 부속자료 1개 별도 고지', await page.isVisible('text=부속자료(지도·사진) 1개도 함께 삭제됩니다'))
  // D-6 — 백업이 없다는 사실을 게이트가 직접 말한다
  check('D-6 — 복구 불가 경고 노출', await page.isVisible('text=백업이 없습니다'))
  check('D-6 — 드라이브 백업 문구 없음', !(await page.isVisible('text=드라이브')))

  // ── [4] 실행 게이트 — 인쇄 확인 하나뿐(D-6) ──
  const runBtn = page.locator('button:has-text("정리 실행")')
  check('게이트 — 체크 전 실행 비활성', await runBtn.isDisabled())
  await page.check('text=종이 보관(인쇄)을 완료했습니다 >> input[type=checkbox]')
  check('게이트 — 인쇄 확인 후 활성', await runBtn.isEnabled())

  // ── [4-b] 대상 대조 — 확인 이후 대상이 바뀌면 실행을 거부해야 한다(못 본 파일이 사라지는 것 방지) ──
  const raceMarkerPdf = `${customerId}/2027/plan_race.pdf`
  await put(raceMarkerPdf)
  const { data: racePlan } = await raw.from('fire_plans').insert({
    customer_id: customerId, year: 2027, title: '경합유입본', pdf_name: 'race.pdf', pdf_path: raceMarkerPdf,
    uploaded_by: userId, created_at: '2027-01-01T00:00:00+09:00',
  }).select('id').single()
  await runBtn.click()
  await page.waitForSelector('text=대상이 바뀌었습니다')
  check('대조 — 확인 이후 대상 변동 시 실행 거부', true)
  const { data: stillThere } = await raw.from('fire_plans').select('id').eq('customer_id', customerId)
  check('대조 — 거부 시 아무것도 삭제되지 않음', (stillThere ?? []).length === 4, `계획서=${stillThere?.length}`)
  check('대조 — 거부 후 [대상 확인]으로 복귀', await page.isVisible('button:has-text("대상 확인")'))

  // 경합분 제거 후 정상 흐름으로 복귀
  await raw.from('fire_plans').delete().eq('id', racePlan!.id)
  await raw.storage.from(BUCKET).remove([raceMarkerPdf])
  await page.click('button:has-text("대상 확인")')
  await page.waitForSelector('text=총 8개 파일이 삭제됩니다')
  await page.check('text=종이 보관(인쇄)을 완료했습니다 >> input[type=checkbox]')

  // ── [5] 실행 ──
  await runBtn.click()
  await page.waitForSelector('text=정리 완료')
  check('결과 — 계획서 2건·파일 8개·스캔 2개',
    await page.isVisible('text=계획서 과거본 2건, 파일 8개 삭제 (업로드 스캔 2개 포함)'))

  // ── [6] DB 검증 — 원천·이력 무손실 (D-5) ──
  const { data: plansAfter } = await raw.from('fire_plans').select('id').eq('customer_id', customerId)
  check('DB — 계획서 최신 1건(연도 축)만 잔존', plansAfter?.length === 1 && plansAfter[0].id === newPlanId, JSON.stringify(plansAfter))
  const { data: attAfter } = await raw.from('fire_plan_attachments').select('id').eq('fire_plan_id', oldPlanId)
  check('DB — 부속자료 행은 계획서와 함께 정리(CASCADE)', (attAfter ?? []).length === 0)
  const { data: rev } = await raw.from('fire_plan_revisions').select('content, fire_plan_id').eq('customer_id', customerId).maybeSingle()
  check('DB — 개정이력 무손실 + FK SET NULL', rev?.content === '정리E2E 개정이력' && rev?.fire_plan_id === null, JSON.stringify(rev))
  const { data: inspAfter } = await raw.from('inspections').select('id').eq('customer_id', customerId)
  check('DB — 점검 회차 4건 무손실', inspAfter?.length === 4, `회차=${inspAfter?.length}`)

  // D-7 ⚠ — 스캔을 지운 회차엔 정리 마커가 남아야 한다(증빙 누락 오경고 차단의 근거)
  const { data: marker } = await raw.from('activity_logs')
    .select('entity_id, metadata').eq('action', 'fire_plan_archive_cleanup')
    .eq('entity_type', 'inspection').eq('entity_id', inspOld).maybeSingle()
  check('D-7 — 배치확인서 정리 회차에 마커 기록', marker?.entity_id === inspOld && marker?.metadata?.certs === 1,
    JSON.stringify(marker))
  const { data: noMarker } = await raw.from('activity_logs')
    .select('entity_id').eq('action', 'fire_plan_archive_cleanup')
    .eq('entity_type', 'inspection').eq('entity_id', inspNew)
  check('D-7 — 스캔 안 지운 회차엔 마커 없음', (noMarker ?? []).length === 0)
  // 계약서만 지운 회차에 마커가 생기면 진짜 배치확인서 누락 경고가 영구히 덮인다
  const { data: contractMarker } = await raw.from('activity_logs')
    .select('entity_id').eq('action', 'fire_plan_archive_cleanup')
    .eq('entity_type', 'inspection').eq('entity_id', inspContract)
  check('D-7 — 계약서만 지운 회차엔 마커 없음(누락 경고 보존)', (contractMarker ?? []).length === 0)
  // 복구 불가 삭제라 '무엇이' 사라졌는지 감사 로그에 남아야 한다
  const { data: custLog } = await raw.from('activity_logs')
    .select('metadata').eq('action', 'fire_plan_archive_cleanup')
    .eq('entity_type', 'customer').eq('entity_id', customerId).maybeSingle()
  check('감사 — 삭제 경로 목록 기록', (custLog?.metadata?.deletedPaths ?? []).length === 8,
    JSON.stringify(custLog?.metadata?.deletedPaths?.length))

  // ── [7] Storage 검증 ──
  check('파일 — 과거 계획서 삭제', !(await exists(oldPdf)))
  check('파일 — 최신 계획서 잔존', await exists(newPdf))
  check('파일 — 과거 회차 별지 전부 삭제', !(await exists(`${customerId}/inspections/${inspOld}/report9_100.pdf`))
    && !(await exists(`${customerId}/inspections/${inspOld}/report9_100.html`)))
  check('파일 — 과거 회차 업로드 스캔 삭제(D-7)', !(await exists(`${customerId}/inspections/${inspOld}/cert_100.pdf`)))
  check('파일 — 최신 회차 구본만 삭제', !(await exists(`${customerId}/inspections/${inspNew}/report9_200.pdf`)))
  check('파일 — 최신 회차 최신본 잔존', await exists(`${customerId}/inspections/${inspNew}/report9_300.pdf`)
    && await exists(`${customerId}/inspections/${inspNew}/report4_250.pdf`))
  // 최신 회차 스캔은 재생성 불가 — 같은 슬롯 2장이 모두 남아야 한다(구본 판정 적용 금지)
  check('파일 — 최신 회차 스캔 2장 모두 잔존', await exists(`${customerId}/inspections/${inspNew}/cert_400.pdf`)
    && await exists(`${customerId}/inspections/${inspNew}/cert_500.pdf`))
  check('파일 — 늦게 올린 과거 연도본 삭제', !(await exists(lateUploadedOldPdf)))
  check('파일 — 부속자료 삭제(고아 방지)', !(await exists(attPath)))
  check('파일 — 계약서만 있던 과거 회차 삭제', !(await exists(`${customerId}/inspections/${inspContract}/contract_50.pdf`)))

  // ── [8] 멱등 — 재확인 시 대상 없음 (실행 후엔 결과 화면이라 [대상 확인]이 없다 → 새로 연다) ──
  await page.goto(`${BASE}/customers/${customerId}?tab=plan&form=archive`)
  await page.waitForSelector('[data-testid=archive-cleanup]')
  await page.click('button:has-text("대상 확인")')
  await page.waitForSelector('text=정리할 과거 산출물이 없습니다')
  // 화면 문구만 믿지 않는다 — 실제 잔존 파일 수로 재확인
  // 잔존해야 할 것: 최신 계획서 1 + 최신 회차 report9·report4 + 최신 회차 스캔 2장 = 5
  const remaining = await countFiles(customerId)
  check('멱등 — 재실행 대상 0 (잔존 파일이 보존 대상뿐)', remaining === 5, `잔존=${remaining}`)

  // ── [9] S1-4 — 산출물 0건 회차는 [전체 인쇄]를 열지 않는다 ──
  const empty2 = await page.request.get(`${BASE}/inspections/${inspEmpty}/bundle`)
  check('S1-4 — 0건 회차는 라우트도 404 유지', empty2.status() === 404, `status=${empty2.status()}`)
} finally {
  // 정리 실패가 본래 실패 원인을 덮지 않게 한다 — PostgREST 빌더는 thenable이라 .catch가 없다
  const quiet = async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* 정리 실패 무시 */ } }
  if (browser) await browser.close()
  if (uploaded.length > 0) await quiet(() => raw.storage.from(BUCKET).remove(uploaded))
  if (customerId) {
    await quiet(() => raw.from('fire_plan_revisions').delete().eq('customer_id', customerId))
    await quiet(() => raw.from('fire_plans').delete().eq('customer_id', customerId))
    await quiet(() => cleanupCustomer(customerId))
  }
  if (userId) await quiet(() => delUser(userId))
}
summary()
