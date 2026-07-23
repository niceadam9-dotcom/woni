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

  // ── R7: ⑥ 배치신고 도우미 ──
  await page.goto(`${BASE}/inspections/${inspA}`)
  await page.waitForSelector('button:has-text("신고 정보 복사")')
  await page.click('button:has-text("신고 정보 복사")')
  await page.waitForSelector('text=협회 배치신고 정보')
  check('R7-a/b 신고 정보 미리보기 팝오버', true)
  // 팝오버 필드는 async 로드 — 복사 버튼(팝오버 내부) 대기 후 검증
  await page.waitForSelector('div:has-text("협회 배치신고 정보") button:has-text("복사")', { timeout: 8000 }).catch(() => {})
  check('R7-b 복사 버튼', await page.isVisible('div:has-text("협회 배치신고 정보") button:has-text("복사")'))
  check('R7 협회 신고 링크 병치', await page.locator('div:has-text("협회 배치신고 정보")').locator('a[href*="kfma"]').first().isVisible())
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
