/** C안 — 고객 등록 폼의 소방안전관리등급 칸 (선택 입력, **차단 없음**) 검증.
 *  실행: node scripts/_probe-grade-on-create.mjs   (dev 서버 필요)
 *
 *  왜 선택인가: 별표4의 2·3급은 설비 설치 여부로 갈리는데 등록 폼엔 설비 입력이 없다.
 *  실측상 최근 1년 등록 321건 중 315건이 등급 미입력이었고, 필수로 걸었다면 그 전부가 막혔다(2026-08-20).
 *  그래서 이 프로브의 핵심은 "채우면 저장된다"와 **"비워도 등록이 막히지 않는다"** 두 축이다.
 */
import { raw, BASE, check, summary, mkUser, delUser, launch, login } from './_e2e-helpers.mjs'

const EMAIL = 'grade-create@erp-test.com'
let userId = '', browser = null
const made = []

/** 등록 폼을 필수 항목만 채운다 — 선택자는 _probe-addr-dup-e2e와 같은 규약 */
async function fillForm(page, name, grade, address) {
  await page.goto(`${BASE}/customers/new`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill(address)
  await page.locator('input[placeholder="주소 검색 시 자동입력 또는 직접 입력"]').fill(name)
  for (const d of await page.locator('input[placeholder*="YYYY"]').all()) {
    await d.fill('2026-05-20'); break
  }
  const rep = page.locator('input[placeholder*="이름"]').first()
  if (await rep.count()) await rep.fill('홍대표')
  if (grade) {
    // 등급 버튼은 그 라벨 뒤에서 고른다 — 화면의 동명 버튼(자격구분 등)과 섞이지 않게
    await page.locator('label:has-text("소방안전관리등급")')
      .locator(`xpath=following::button[normalize-space()="${grade}"][1]`).click()
  }
}

/** 등록 버튼 — 헤더의 [로그아웃]도 type=submit이라 마지막 것을 잡아야 한다 */
const submitBtn = page => page.locator('button[type=submit]').last()

/** 제출 버튼이 활성화될 때까지 (고객코드 자동 생성 대기 포함) */
async function waitSubmitEnabled(page) {
  await page.waitForFunction(() => {
    const all = document.querySelectorAll('button[type=submit]')
    const b = all[all.length - 1]
    return !!b && !b.disabled
  }, { timeout: 30000 }).catch(() => {})
}

try {
  userId = await mkUser({ email: EMAIL, name: '등급등록프로브', employeeId: 'GOC-1', role: 'admin' })
  const l = await launch(); browser = l.browser
  const page = l.page
  await login(page, EMAIL)

  // ── 1) 칸이 화면에 있고, 필수(★)가 아니다 ──
  await page.goto(`${BASE}/customers/new`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const gradeLabel = page.locator('label:has-text("소방안전관리등급")').first()
  check('등록 폼에 [소방안전관리등급] 칸이 있다', await gradeLabel.count() > 0, '')
  const starred = await page.$$eval('span.text-red-500', els =>
    els.map(e => (e.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim()))
  check('등급에는 필수 별표가 붙지 않는다', !starred.some(s => s.includes('소방안전관리등급')), starred.join(' | '))
  check('기존 필수 5개는 그대로', ['도로명주소', '고객명', '점검유형', '점검계획일', '대표 관계인']
    .every(n => starred.some(s => s.includes(n))), starred.join(' | '))
  check('라벨이 대상물 급수임을 밝힌다', (await gradeLabel.innerText()).includes('대상물 급수'), await gradeLabel.innerText())

  // ── 2) 등급을 비운 채로도 등록이 막히지 않는다 (핵심) ──
  const tag = String(Date.now() % 1000000)
  const nameA = `PROBE등급없이${tag}`
  await fillForm(page, nameA, null, `경기 양평군 등급등록로 ${tag}-1`)
  await waitSubmitEnabled(page)
  const submit = submitBtn(page)
  check('등급 미선택이어도 [등록] 버튼이 활성', !(await submit.isDisabled()), (await submit.innerText()).trim())
  await submit.click()
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 60000 })
  const { data: a } = await raw.from('customers').select('id, building_grade').eq('customer_name', nameA).single()
  made.push(a.id)
  check('등급 미선택 등록 성공 · building_grade는 null', a.building_grade === null, String(a.building_grade))

  // ── 3) 선택하면 그대로 저장된다 ──
  const nameB = `PROBE등급2급${tag}`
  await fillForm(page, nameB, '2급', `경기 양평군 등급등록로 ${tag}-2`)
  await waitSubmitEnabled(page)
  await submitBtn(page).click()
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 60000 })
  const { data: b } = await raw.from('customers').select('id, building_grade').eq('customer_name', nameB).single()
  made.push(b.id)
  check('선택한 등급이 building_grade로 저장', b.building_grade === '2급', String(b.building_grade))

  // ── 4) 저장된 등급이 관계인 탭 [소방안전관리] 구역에 그대로 뜬다 (창구 둘·저장소 하나) ──
  await page.goto(`${BASE}/customers/${b.id}?tab=contacts`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const panel = page.locator('[id="c-fire-safety-manager"]')
  await panel.waitFor({ timeout: 30000 }).catch(() => {})
  check('관계인 탭에 [소방안전관리] 구역이 뜬다', await panel.count() > 0, '')
  const cls = (await panel.locator('button:text-is("2급")').first().getAttribute('class')) ?? ''
  // ⚠ 종전엔 cls.includes('#7b68ee')를 봤다 — 소방계획서_29 토큰 코드모드가 지운 문자열이라
  //   **항상 거짓**이 되어 멀쩡한 앱을 빨갛게 만들고 있었다(소방계획서_37 R-b).
  // ⚠ 그렇다고 includes('bg-brand')로 갈아끼우면 **항상 참**이 된다 — 미선택 클래스가
  //   'hover:bg-brand-tint'라 부분일치에 걸린다(실측: selected=true, unselected=**true**).
  //   text-white를 함께 걸면 지금은 구별된다(unselected=false). 다만 그건 우연히 살아난 것이고,
  //   미선택에 text-white가 붙는 순간 무너진다 — 그래서 **토큰 경계**로 못 박는다.
  //   선택 상태는 fire-safety-manager-panel.tsx의 segBtn() = 'bg-brand text-white'.
  const onCls = /(^|\s)bg-brand(\s|$)/.test(cls) && /(^|\s)text-white(\s|$)/.test(cls)
  check('그 구역에서 2급이 선택 상태로 보인다 (같은 저장소를 읽는다)', onCls, cls)

  // ── 5) 별지 9호가 그 값을 등급으로 읽는다 — 등록 → 문서까지 이어지는지 ──
  const { data: cust5 } = await raw.from('customers').select('building_grade').eq('id', b.id).single()
  check('등록에서 넣은 값이 별지 9호 등급 원천(building_grade)에 그대로', cust5.building_grade === '2급', String(cust5.building_grade))
} catch (e) {
  // summary()가 process.exit을 부르면 스택이 묻힌다 — 원인을 먼저 남긴다
  console.error('프로브 중단:', e?.message ?? e)
  check('프로브가 끝까지 진행됨', false, String(e?.message ?? e))
} finally {
  await browser?.close().catch(() => {})
  for (const id of made) {
    await raw.from('customer_contacts').delete().eq('customer_id', id)
    await raw.from('inspection_plan_items').delete().eq('customer_id', id)
    await raw.from('buildings').delete().eq('customer_id', id)
    await raw.from('customers').delete().eq('id', id)
  }
  if (userId) await delUser(userId).catch(() => {})
  const { data: left } = await raw.from('customers').select('id').like('customer_name', 'PROBE등급%')
  console.log(`[정리] 잔존 고객 ${(left ?? []).length}건`)
  summary()
}
