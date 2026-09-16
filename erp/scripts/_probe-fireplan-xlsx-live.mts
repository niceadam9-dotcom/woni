/** 실서버에서 소방계획서 엑셀을 **실제로 받아** 1.10.4 배선을 확인한다.
 *
 *  오프라인 증명(`test-fire-plan-preview.mts [6]`)은 조립·주입·되읽기를 다 덮지만, 라우트에는
 *  그 위에 **권한·템플릿 캐시·체크박스·사진**이 더 얹혀 있다. 받은 파일이 곧 사용자가 받는 것이다.
 *
 *  실행: npx tsx scripts/_probe-fireplan-xlsx-live.mts   (localhost:3000 기동 필요)
 */
import JSZip from 'jszip'
import { launch, login, raw, mkUser, delUser } from './_e2e-helpers.mjs'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { FIREHIST_SHEET } from '../src/lib/fire-plan-anchors.ts'

const BASE = 'http://localhost:3000'
let ctx: Awaited<ReturnType<typeof launch>> | null = null
let userId: string | null = null
const EMAIL = 'e2e-fireplan-xlsx@test.local'

try {
  // ⭐ 새 고객을 만들지 않고 **스테이징의 실제 고객**을 쓴다 — 더 현실적이고, `created_by`
  //   같은 부수 제약에 걸리지 않는다. 화재이력이 없는 고객이면 빈칸이 정답이다.
  const { data: cust } = await raw.from('customers').select('id, customer_name').eq('is_active', true).limit(1).single()
  if (!cust) { console.error('🚨 스테이징에 고객이 없다'); process.exit(1) }
  const customerId = cust.id as string
  console.log(`대상 고객: ${cust.customer_name} (${customerId})`)

  userId = await mkUser({ email: EMAIL, name: '소방계획서엑셀E2E', employeeId: 'E2E-FPXLSX' })
  ctx = await launch()
  const page = ctx.page
  await login(page, EMAIL)

  const res = await page.request.get(`${BASE}/customers/${customerId}/fire-plan/xlsx`)
  console.log(`라우트 HTTP ${res.status()}`)
  if (!res.ok()) { console.error('🚨 본문:', (await res.text()).slice(0, 300)); process.exit(1) }

  const notice = res.headers()['x-fireplan-missing']
  if (notice) console.log('고지:', decodeURIComponent(notice).slice(0, 200))

  const buf = new Uint8Array(await res.body())
  console.log(`파일 ${(buf.byteLength / 1024).toFixed(0)}KB · zip 매직 ${buf[0] === 0x50 && buf[1] === 0x4b ? 'OK' : '🚨'}`)

  const g = await readSheetGrid(await JSZip.loadAsync(buf), FIREHIST_SHEET)
  const at = (r: string) => g.cells.find(x => x.ref === r)?.text ?? '(없음)'
  console.log(`\n${FIREHIST_SHEET} — 받은 파일에서 되읽기`)
  console.log(`  머리글 A2 = ${JSON.stringify(at('A2'))}`)
  console.log(`  1행 A3=${JSON.stringify(at('A3'))} I3=${JSON.stringify(at('I3'))} AM3=${JSON.stringify(at('AM3'))}`)
  // 이 고객은 화재이력이 없다 — **빈칸이 정답**이다(없는 사실을 지어내지 않는다).
  const ok = at('A2').startsWith('구분') && at('A3') === '' && at('AM3') === ''
  console.log(`\n${ok ? '✅' : '🚨'} 머리글 보존 + 데이터 없는 고객은 빈칸 유지`)
  process.exitCode = ok ? 0 : 1
} finally {
  if (ctx) await ctx.browser.close()
  if (userId) await delUser(userId)
  console.log('[정리] 완료')
}
