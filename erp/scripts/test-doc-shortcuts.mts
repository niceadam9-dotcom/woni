// 목록 문서 바로가기 — 고객 관리 / 점검 업무 **첫페이지** (2026-09-16 사용자 요청)
//
// 종전에는 두 문서 모두 상세 화면 안쪽에서만 받을 수 있었다(소방계획서 엑셀·PDF = 고객 상세
// 계획서 탭, 결과보고서 엑셀 = 점검 상세 작업대). 목록에서 바로 받게 꺼낸 것이 이 축이다.
//
// 계약 셋:
//   A. 고객 목록 — 행마다 「엑셀」·「PDF」가 **글씨로** 있고, 그 행의 **자기 고객** 문서를 가리킨다
//   B. 점검 업무 — 행마다 「엑셀」이 있고, 받은 파일이 **그 행 고객**의 결과보고서다
//   C. 화면 관문이 라우트와 **같은 권한 술어**를 쓴다
//
// 🎯 이 검사에서 가장 중요한 단언은 개수가 아니라 **행-문서 대응**이다. 전 행이 같은 고객의
//    문서를 가리켜도 「행 수 = 버튼 수」는 초록이다 — 개수만 세는 단언은 배선이 뒤집혀도 통과한다.
//
// 🎯 「글씨로」는 사용자 지시다(파일 아이콘 셋이 겹쳐 구분이 안 됐다). 그래서 라벨 글자만 묻지
//    않고 **svg가 0개인지도** 함께 묻는다 — 아이콘을 남긴 채 글씨만 더해도 앞의 단언은 초록이다.
//
// 🚨 권한은 **역할 기반 음성 검사를 일부러 넣지 않았다.** 역할이 employee/manager/admin 셋뿐이고
//    셋 다 customer_manage·inspection_register를 가져(lib/permissions.ts) 「권한 없는 사람에게
//    안 보인다」는 지금 **잡힐 수 없는 변이**다(동등 변이 — 넣으면 영원히 공허 통과한다).
//    대신 C절이 두 파일의 술어가 **같은가**를 본다. 권한표가 바뀌는 날 갈라지면 그때 잡힌다.
import { readFileSync } from 'fs'
import { launch, login, mkUser, delUser, check, summary, BASE } from './_e2e-helpers.mjs'
import { codeOnly, strippedStats } from './_code-only.mts'

const EMAIL = 'e2e-doc-shortcut@test.local'
const uid = await mkUser({ email: EMAIL, name: 'E2EDoc', employeeId: 'EDS', role: 'admin' })
const { browser, page } = await launch()
// 다른 세션이 동시에 빌드 중이면 헬퍼 기본 15초로는 로그인조차 못 넘긴다(_verify-pending-plan-list 교훈)
page.setDefaultTimeout(60000)
page.setDefaultNavigationTimeout(60000)

const idOf = (href: string | null) => /\/customers\/([0-9a-f-]{36})/i.exec(href ?? '')?.[1] ?? null

try {
  await login(page, EMAIL)

  // ── A. 고객 목록 ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/customers`)
  await page.waitForSelector('[data-testid="fire-plan-xlsx"]')

  const rows = await page.locator('table tbody tr').count()
  // 전제 — 표본이 0이면 아래 단언이 전부 «공허 통과»한다
  check('A-0 전제: 고객 행이 있다', rows > 0, `행 ${rows}`)

  const xlsx = page.locator('[data-testid="fire-plan-xlsx"]')
  const pdf = page.locator('[data-testid="fire-plan-pdf-link"]')
  check('A-1 행마다 엑셀 버튼', await xlsx.count() === rows, `${await xlsx.count()} ≠ ${rows}`)
  check('A-2 행마다 PDF 링크', await pdf.count() === rows, `${await pdf.count()} ≠ ${rows}`)

  // 글씨인가 — 라벨 글자 + 아이콘 부재를 **함께** 묻는다
  check('A-3 엑셀이 글씨 「엑셀」', (await xlsx.first().innerText()).trim() === '엑셀')
  check('A-4 PDF가 글씨 「PDF」', (await pdf.first().innerText()).trim() === 'PDF')
  check('A-5 엑셀에 아이콘(svg) 없음', await xlsx.first().locator('svg').count() === 0)
  check('A-6 PDF에 아이콘(svg) 없음', await pdf.first().locator('svg').count() === 0)

  // 🎯 행-문서 대응 — 각 행의 PDF 링크가 **그 행 상세 링크와 같은 고객**을 가리키는가
  const detailHrefs = await page.locator('a[title="상세보기"]').evaluateAll(
    (els: Element[]) => els.map(e => e.getAttribute('href')))
  const pdfHrefs = await pdf.evaluateAll((els: Element[]) => els.map(e => e.getAttribute('href')))
  const paired = detailHrefs.length === pdfHrefs.length && detailHrefs.length === rows
  check('A-7 전제: 상세 링크도 행 수만큼', paired, `${detailHrefs.length}/${pdfHrefs.length}/${rows}`)
  const mismatch = paired
    ? detailHrefs.map((d, i) => idOf(d) === idOf(pdfHrefs[i]) ? null : `${i}행 ${idOf(d)}≠${idOf(pdfHrefs[i])}`)
      .filter(Boolean)
    : ['짝을 못 맞춤']
  check(`A-8 행마다 자기 고객 PDF를 가리킨다 (${rows}행)`, mismatch.length === 0, mismatch.slice(0, 3).join(' / '))

  // PDF 규약 — 고지 헤더가 없어 새 탭 조회가 정본(fire-plan-view.openPdf와 같은 축)
  const firstPdf = await pdf.first().getAttribute('href')
  check('A-9 PDF href가 fire-plan/pdf', /\/customers\/[0-9a-f-]{36}\/fire-plan\/pdf$/.test(firstPdf ?? ''), String(firstPdf))
  check('A-10 PDF는 새 탭', await pdf.first().getAttribute('target') === '_blank')
  check('A-11 PDF에 download=1 없음(조회 규약)', !(firstPdf ?? '').includes('download=1'), String(firstPdf))

  // 실제로 내려오는가 + 행 클릭 전파로 상세로 튕기지 않는가(ClickableRow 안이다)
  // ⚠ 넉넉히 기다린다 — 이 엑셀은 즉석 조립이라 dev에서 4~45초가 걸린다(3MB 실측).
  //   실패하면 타임아웃 문구만 남기지 말고 **화면이 말하는 사유**(고지·오류 토스트)를 찍는다.
  const urlA = page.url()
  const dlA = page.waitForEvent('download', { timeout: 180000 })
  await xlsx.first().click()
  let nameA: string | null = null
  try { nameA = (await dlA).suggestedFilename() } catch (e) {
    nameA = null
    const toast = await page.locator('[data-testid="doc-notice-toast"]').count()
      ? (await page.locator('[data-testid="doc-notice-toast"]').innerText()).trim() : '(토스트 없음)'
    console.log(`  A 다운로드 실패: ${(e as Error).message.split('\n')[0]}\n    화면 사유: ${toast}`)
  }
  check('A-12 소방계획서 엑셀이 실제로 내려온다', !!nameA && nameA.endsWith('.xlsx'), String(nameA))
  check('A-13 「소방계획서」 파일명 규약', !!nameA && nameA.includes('소방계획서'), String(nameA))
  await page.waitForTimeout(1200)
  check('A-14 엑셀 클릭이 상세로 튕기지 않는다', page.url() === urlA, `${urlA} → ${page.url()}`)

  // ── B. 점검 업무 목록 ─────────────────────────────────────────────────
  await page.goto(`${BASE}/inspections`)
  await page.waitForSelector('[data-testid="workbook-xlsx"]')

  const irows = await page.locator('table tbody tr').count()
  check('B-0 전제: 점검 행이 있다', irows > 0, `행 ${irows}`)

  const wb = page.locator('[data-testid="workbook-xlsx"]')
  check('B-1 행마다 엑셀 버튼', await wb.count() === irows, `${await wb.count()} ≠ ${irows}`)
  check('B-2 엑셀이 글씨 「엑셀」', (await wb.first().innerText()).trim() === '엑셀')
  check('B-3 엑셀에 아이콘(svg) 없음', await wb.first().locator('svg').count() === 0)
  // 문서 열을 신설했다 — 머리글이 6칸이면 열이 사라진 것이고, 셀은 있는데 머리가 없으면 표가 밀린다
  check('B-4 머리글 7칸(문서 열 신설)', await page.locator('table thead th').count() === 7,
    String(await page.locator('table thead th').count()))

  // 🎯 행-문서 대응 — 첫 행 고객명이 **받은 파일명**에 들어 있는가(규약: 고객명_종류결과보고서_연도)
  const firstCust = (await page.locator('table tbody tr').first().locator('td').first().innerText()).trim()
  const urlB = page.url()
  const dlB = page.waitForEvent('download', { timeout: 180000 })
  await wb.first().click()
  let nameB: string | null = null
  try { nameB = (await dlB).suggestedFilename() } catch (e) { nameB = null; console.log('  다운로드 실패:', (e as Error).message) }
  check('B-5 결과보고서 엑셀이 실제로 내려온다', !!nameB && nameB.endsWith('.xlsx'), String(nameB))
  check(`B-6 받은 파일이 그 행 고객(${firstCust})의 것`, !!nameB && nameB.startsWith(firstCust),
    `${nameB} ↛ ${firstCust}`)
  check('B-7 「결과보고서」 파일명 규약', !!nameB && nameB.includes('결과보고서'), String(nameB))
  await page.waitForTimeout(1200)
  check('B-8 엑셀 클릭이 상세로 튕기지 않는다', page.url() === urlB, `${urlB} → ${page.url()}`)

  // ── C. 관문 술어 결합 (소스 축) ───────────────────────────────────────
  // 화면이 라우트와 다른 권한을 물으면 «눌러도 403인 버튼»이 생긴다. 두 파일에서 각각 뽑아
  // 대조한다 — 기대값을 여기 하드코딩하면 양쪽이 같이 틀려도 초록이 되므로 그러지 않는다.
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const permOf = (src: string) => /can\(\s*profile\.role as UserRole,\s*'([a-z_]+)'\s*\)/.exec(codeOnly(src))?.[1] ?? null

  const custPageRaw = read('src/app/(dashboard)/customers/page.tsx')
  const inspPageRaw = read('src/app/(dashboard)/inspections/page.tsx')
  // 🚨 계측기 자기 검사 — codeOnly가 실제로 물었는가(CRLF에서 한 줄도 못 걷던 전례가 있다)
  for (const [nm, raw] of [['고객 목록', custPageRaw], ['점검 업무', inspPageRaw]] as const) {
    const st = strippedStats(raw)
    check(`C-0 계측기가 ${nm} 주석을 걷었다`, st.leftover === 0 && st.removed > 0,
      `남은 줄주석 ${st.leftover} / 지운 글자 ${st.removed}`)
  }

  const xlsxRoutePerm = permOf(read('src/app/(dashboard)/customers/[id]/fire-plan/xlsx/route.ts'))
  const pdfRoutePerm = permOf(read('src/app/(dashboard)/customers/[id]/fire-plan/pdf/route.ts'))
  const wbRoutePerm = permOf(read('src/app/(dashboard)/inspections/[id]/workbook/route.ts'))
  check('C-1 전제: 라우트에서 권한 술어를 뽑았다', !!xlsxRoutePerm && !!pdfRoutePerm && !!wbRoutePerm,
    `${xlsxRoutePerm}/${pdfRoutePerm}/${wbRoutePerm}`)
  check('C-2 엑셀·PDF 라우트가 같은 권한', xlsxRoutePerm === pdfRoutePerm, `${xlsxRoutePerm} ≠ ${pdfRoutePerm}`)

  const custCode = codeOnly(custPageRaw)
  const inspCode = codeOnly(inspPageRaw)
  check(`C-3 고객 목록 관문이 라우트와 같은 술어(${xlsxRoutePerm})`,
    !!xlsxRoutePerm && custCode.includes(`'${xlsxRoutePerm}'`), String(xlsxRoutePerm))
  check(`C-4 점검 목록 관문이 라우트와 같은 술어(${wbRoutePerm})`,
    !!wbRoutePerm && inspCode.includes(`'${wbRoutePerm}'`), String(wbRoutePerm))
} catch (e) {
  check('프로브 완주', false, (e as Error).message)
} finally {
  await browser.close()
  await delUser(uid)
}
summary()
