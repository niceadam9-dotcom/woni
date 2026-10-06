// 공사 완료 사진첩 E2E (2026-10-06) — 작업대 ⑥ 칸 [사진첩 한글파일]·[사진첩 PDF 생성] 버튼과
// [보고서 엑셀]의 맨 끝 「사진첩」 시트를 실제 dev 서버로 받는다.
// 라우트는 읽기 전용이라 스테이징의 불량 있는 자체점검 1건을 쓴다(심는 것은 검증 사용자 하나, 끝에 지운다).
// ⚠ [사진첩 PDF 생성]은 버튼 존재만 본다 — 로컬엔 Gotenberg가 없어 변환은 운영 확증(verify)에서 본다.
// 실행: npx tsx scripts/test-photo-album-e2e.mts   (dev 서버 기동 상태, BASE=localhost:3000)
import JSZip from 'jszip'
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const email = `e2e-album-${Date.now()}@test.local`
let userId: string | null = null
let browser: { close: () => Promise<void> } | null = null
try {
  // 대상 — 불량이 등록된 자체점검 중 최신 1건
  const { data: defs, error: dErr } = await raw.from('inspection_defects').select('inspection_id').limit(1000)
  if (dErr) throw new Error(`불량 조회 실패: ${dErr.message}`)
  const withDefects = [...new Set(((defs ?? []) as Array<{ inspection_id: string }>).map(d => d.inspection_id))]
  const { data: insps, error } = await raw.from('inspections')
    .select('id, year, plan_type, inspection_start_date, customers:customer_id(customer_name)')
    .in('id', withDefects).order('inspection_start_date', { ascending: false })
  if (error) throw new Error(`대상 점검 조회 실패: ${error.message}`)
  const target = ((insps ?? []) as unknown as Array<{ id: string; year: number; plan_type: string | null; customers: { customer_name: string } | null }>)
    .find(i => !i.plan_type || i.plan_type.startsWith('special'))
  if (!target) throw new Error('불량 있는 자체점검이 스테이징에 없다')
  const custName = target.customers?.customer_name ?? ''
  const nDefects = withDefects.length && ((defs ?? []) as Array<{ inspection_id: string }>).filter(d => d.inspection_id === target.id).length
  console.log(`대상: ${target.id} ${custName} · 불량 ${nDefects}건`)

  console.log('\n[1] 무인증 — 라우트가 직접 막는다')
  const anon = await fetch(`${BASE}/inspections/${target.id}/photo-album-hwpx`, { redirect: 'manual' })
  check('1-1 로그인 없으면 401(또는 로그인으로 돌림)', anon.status === 401 || (anon.status >= 300 && anon.status < 400), String(anon.status))

  userId = await mkUser({ email, name: '사진첩 검증', employeeId: `AL-${Date.now() % 100000}`, role: 'admin' })
  const l = await launch(); browser = l.browser; const page = l.page
  await login(page, email)
  await page.goto(`${BASE}/inspections/${target.id}`, { waitUntil: 'networkidle' })

  console.log('\n[2] ⑥ 칸 버튼')
  await page.getByTestId('workbench-stepbar').getByRole('button', { name: /이행완료/ }).click()
  const hwpxBtn = page.getByTestId('photo-album-hwpx')
  await hwpxBtn.waitFor({ timeout: 15000 }).catch(() => {})
  check('2-1 [사진첩 한글파일] 버튼', await hwpxBtn.count() === 1)
  check('2-2 [사진첩 PDF 생성] 버튼', await page.getByTestId('photoalbum-generate').count() === 1)

  console.log('\n[3] 사진첩 한글파일 내려받기')
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), hwpxBtn.click()])
  const name = dl.suggestedFilename()
  check('3-1 파일 이름 = 고객명_공사완료사진첩_연도.hwpx', name === `${custName}_공사완료사진첩_${target.year}.hwpx`, name)
  const buf = await (await dl.createReadStream()).toArray().then(cs => Buffer.concat(cs as Buffer[]))
  const z = await JSZip.loadAsync(buf)
  check('3-2 HWPX 구조(mimetype 첫 항목)', Object.keys(z.files)[0] === 'mimetype')
  const sec = await z.file('Contents/section0.xml')!.async('string')
  const pics = [...sec.matchAll(/<hp:pic /g)].length
  check(`3-3 그림 = 불량 ${nDefects}건 × 2`, pics === nDefects * 2, `${pics}`)
  check('3-4 오류 문구 없음', await page.getByTestId('photo-album-hwpx-error').count() === 0)

  console.log('\n[4] 보고서 엑셀 — 맨 끝 「사진첩」 시트')
  const res = await page.request.get(`${BASE}/inspections/${target.id}/workbook`)
  check('4-1 200', res.status() === 200, String(res.status()))
  const wz = await JSZip.loadAsync(await res.body())
  const wb = await wz.file('xl/workbook.xml')!.async('string')
  const sheets = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map(m => m[1])
  check('4-2 마지막 시트 = 사진첩', sheets[sheets.length - 1] === '사진첩', sheets.slice(-2).join('→'))
  check('4-3 옛 「불량사진」 시트 없음', !sheets.includes('불량사진'))
  const ps = await wz.file('xl/worksheets/sheetPhoto.xml')!.async('string')
  check(`4-4 「공사 전」 라벨 = 불량 ${nDefects}건`, [...ps.matchAll(/>공사 전</g)].length === nDefects)
  check('4-5 머리 문구에 고객명', ps.includes(`공사 완료 사진첩  [ ${custName} ]`))
} catch (e) {
  check('실행 중 예외 없음', false, e instanceof Error ? e.message : String(e))
} finally {
  await browser?.close()
  if (userId) await delUser(userId)
}
summary()
