// 소방계획서_5 S3 E2E — ②③ 바로 생성(R3·R4) + ⑤ 갤러리(R6) + ⑥ 배치신고 도우미(R7) + ⑫ 불량 입력(R13)
// 실행: npx tsx scripts/test-report-s3.mts   (로컬 dev + 스테이징 DB)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'report-s3-e2e@erp-test.com'
let userId = ''
let custA = ''
let inspA = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const NAME_A = '보고서S3자체점검'

function kstShift(days: number): string {
  const d = new Date(Date.now() + 9 * 3600_000)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

try {
  userId = await mkUser({ email: EMAIL, name: '보고서S3E2E', employeeId: 'E2E-S3' })
  custA = await mkCustomer({ customer_name: NAME_A, created_by: userId, inspection_type: '작동', inspection_sub_type: '작동', address: '서울시 강남구 테스트로 12' })

  const { data: iA, error: eA } = await raw.from('inspections').insert({
    customer_id: custA, inspection_type: '작동', sequence_num: 1,
    inspection_start_date: kstShift(-12), inspection_end_date: kstShift(-12),
    status: 'completed', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (eA) throw new Error(`점검 생성 실패: ${eA.message}`)
  inspA = iA!.id

  // 불량 2건 — A는 전/후 사진(페어), B는 사진 없음·미조치
  await raw.from('inspection_defects').insert([
    { inspection_id: inspA, defect_name: 'S3불량A_감지기', severity: '보통', photo_url: 'https://example.com/before.jpg', after_photo_url: 'https://example.com/after.jpg', action_completed_at: kstShift(-1) },
    { inspection_id: inspA, defect_name: 'S3불량B_유도등', severity: '중대' },
  ])

  const l = await launch()
  browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── R4: ③ 이행계획·완료 10·11호 바로 생성 목록 ──
  await page.goto(`${BASE}/reports?form=report10&q=${encodeURIComponent(NAME_A)}`)
  await page.waitForSelector(`text=${NAME_A}`)
  check('R4-a 불량 보유 건 목록 + 이유 문구', await page.isVisible('text=이행계획서(10호) 제출 대상'))
  check('R4-a 조치 진행 표시(1/2)', await page.isVisible('text=조치 1/2'))
  check('R4-b [10호 생성] 인라인', await page.isVisible('button:has-text("10호 생성")'))
  check('R4-b [11호 생성] 인라인', await page.isVisible('button:has-text("11호 생성")'))

  // ── R3: ② 별지 9호 바로 생성 목록 ──
  await page.goto(`${BASE}/reports?form=report9&q=${encodeURIComponent(NAME_A)}`)
  await page.waitForSelector(`text=${NAME_A}`)
  check('R3-b [바로 생성] 인라인', await page.isVisible('button:has-text("바로 생성")'))
  check('R3-d 상태 필터 칩(완료)', await page.isVisible('button:has-text("완료")'))

  // ── R13: ⑫ 불량 입력 편의 (불량내역 추가 폼) ──
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('text=불량내역')
  check('R6-b 진입점 ⓐ — 전/후 사진 모아보기 버튼', await page.isVisible('button:has-text("전/후 사진 모아보기")'))
  await page.click('button:has-text("불량내역 추가")')
  await page.waitForSelector('text=저장 후 계속 입력')
  check('R13-b 연속 입력 모드 토글', true)
  check('R13-c 저장 폼 [전(불량) 사진] 버튼', await page.isVisible('button:has-text("전(불량) 사진")'))
  // 단골 칩은 서버 통계 로드 후 렌더 — 대기
  await page.waitForSelector('text=단골 불량 — 1탭 등록', { timeout: 8000 }).catch(() => {})
  check('R13-a 단골 불량 칩 영역', await page.isVisible('text=단골 불량 — 1탭 등록'))

  // ── R6: ⑤ 전/후 사진 갤러리 모달 (#photos 딥링크) ──
  await page.goto(`${BASE}/inspections/${inspA}#photos`)
  await page.waitForSelector('text=전/후 사진 (1/2쌍)')
  check('R6-a 갤러리 모달 + 쌍 수', true)
  check('R6-a 불량명 페어 카드', await page.isVisible('text=S3불량A_감지기'))
  check('R6-a 조치완료 뱃지', await page.isVisible('text=조치완료'))
  check('R6-c 빈 슬롯 앰버(후 사진 추가)', await page.isVisible('text=후(조치) 추가'))

  // ── R7: ② 배치신고 — 2026-09-07 개편 후 ──
  // 종전 R7은 [신고 정보 복사] 팝오버(협회 사이트에 옮겨 적기용)를 고정했다. 대표가 협회에서
  // 직접 신고하게 되면서 그 도우미가 폐지됐다 — 이제 남는 것은 **완료 표시와 협회 링크**뿐이다.
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('[data-testid="workbench-stepbar"]')
  await page.locator('[data-testid="workbench-stepbar"] button[data-step="cert"]').click()
  await page.waitForSelector('text=점검인력 배치신고')
  check('R7-a 완료 체크 노출', await page.getByTestId('cert-reported-toggle').count() > 0)
  check('R7-b [신고 정보 복사] 폐지', await page.locator('button:has-text("신고 정보 복사")').count() === 0)
  check('R7-c 협회 신고 사이트 링크는 유지', await page.locator('a[href*="kfma"]').first().isVisible())
} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close()
  if (custA) {
    const { data: allInsps } = await raw.from('inspections').select('id').eq('customer_id', custA)
    for (const i of (allInsps ?? []) as Array<{ id: string }>) {
      await raw.from('inspection_defects').delete().eq('inspection_id', i.id)
      await raw.from('inspection_reports').delete().eq('inspection_id', i.id)
      await raw.from('fire_plan_gen_jobs').delete().eq('inspection_id', i.id)
    }
    await cleanupCustomer(custA)
  }
  if (userId) await delUser(userId)
}
summary()
