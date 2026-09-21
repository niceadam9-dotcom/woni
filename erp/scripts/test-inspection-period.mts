/** 점검 기간 — **종료일 ↔ 일수가 서로를 따라오는가** (2026-09-21 사용자 요청).
 *
 *  왜 생겼나: 두 칸이 독립 state라 서로를 전혀 몰랐다. 사용자는 종료일만 고치고 저장했고,
 *  일수는 `1`로 남았다. 실측에서 **다일 점검 3건 중 3건 전부**가 그 상태였다(기간 3·4·8일 / 일수 1).
 *  🚨 이 일수는 **별지 9호에 인쇄된다** — 법정 서류 한 장에서 기간과 일수가 서로를 부정했다.
 *
 *  이 검사가 지키는 것:
 *   ① 순수 — 양끝 포함 셈법(시작일이 1일차)과 왕복 항등, 상한 판정
 *   ② 화면 — 종료일을 넣으면 일수가 따라오고, 일수를 넣으면 종료일이 따라온다(양방향)
 *   ③ 화면 — 5일 초과는 **저장 전에** 막고 이유를 말한다(종전엔 말없이 받고 서버가 1로 떨궜다)
 *   ④ 서버 — 저장된 쌍이 **실제로 일치한다**(화면을 우회해도 어긋난 쌍이 안 박힌다)
 *
 *  실행: npx tsx scripts/test-inspection-period.mts   (로컬 dev + 스테이징 DB)
 */
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'
import { readFileSync } from 'node:fs'
import {
  daysFromRange, endFromDays, inspectionPeriodError, MAX_INSPECTION_DAYS,
} from '../src/lib/inspection-period'
/* ⚠ 서버 액션은 **직접 import할 수 없다** — `supabase/admin`이 `server-only`를 끌어와 tsx에서
   즉시 throw한다. 그래서 서버 축은 ①저장 뒤 DB 실측(아래 ④)과 ②배선 단언으로 나눠 묻는다. */

const EMAIL = 'insp-period-e2e@erp-test.com'
let userId = '', custId = '', inspId = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const plus = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

// ══ ① 순수 ════════════════════════════════════════════════════════════════
check('① 종료일 없으면 1일 (079 「NULL이면 당일」)', daysFromRange(today, null) === 1)
check('① 같은 날이면 1일 — 양끝 포함이라 0이 아니다', daysFromRange(today, today) === 1)
check('① 하루 뒤면 2일 (시작일이 1일차)', daysFromRange(today, plus(1)) === 2)
check('① 역전이면 null — 숫자로 조용히 쓰지 못하게', daysFromRange(plus(1), today) === null)
check('① 날짜꼴이 아니면 null', daysFromRange('2026-09', plus(1)) === null)
check('① 1일이면 종료일은 빈 문자열(없는 날짜를 지어내지 않는다)', endFromDays(today, 1) === '')
check('① 3일이면 종료 = 시작+2', endFromDays(today, 3) === plus(2))
/* 🚨 왕복 항등 — 한쪽만 고치면 이 줄이 먼저 깨진다. 「+N」으로 세던 하루 어긋남의 재발 방어. */
for (const n of [2, 3, 4, 5]) {
  check(`① 왕복 항등 ${n}일 → 종료일 → 다시 ${n}일`, daysFromRange(today, endFromDays(today, n)) === n)
}
check('① 상한 안(5일)은 통과', inspectionPeriodError(today, plus(MAX_INSPECTION_DAYS - 1)) === null)
check('① 상한 초과(6일)는 막는다', (inspectionPeriodError(today, plus(MAX_INSPECTION_DAYS)) ?? '').includes('최대'))
/* 🚨 순서가 뜻을 만든다 — 역전 입력에 「최대 5일」이 붙으면 엉뚱한 이유를 말하는 것이다 */
check('① 역전은 **거꾸로다**라고 말한다(최대 일수 탓이 아니라)',
  (inspectionPeriodError(plus(9), today) ?? '').includes('빠를 수 없습니다'),
  String(inspectionPeriodError(plus(9), today)))
check('① 한쪽만 입력된 상태는 통과(타이핑 도중을 빨갛게 만들지 않는다)',
  inspectionPeriodError(today, null) === null && inspectionPeriodError(null, plus(2)) === null)

// ══ ⑤ 서버 배선 — 화면 검사만 두면 액션이 그대로 뚫린다('use server' 규약) ══
/* 🚨 이 묶음을 **브라우저 앞에** 둔다. 처음엔 try 안 끝에 뒀더니, 변이 P5가 dev 빌드를 깨
   로그인에서 타임아웃 나자 **단언이 한 줄도 안 돌고** 「빨강」으로 보였다 — 변이가 죽은 게
   아니라 계측기가 죽은 것이었다. 소스 축은 서버도 브라우저도 필요 없다. */
{
  const src = readFileSync(new URL('../src/app/(dashboard)/inspections/actions.ts', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n')
  check('⑤ 서버가 일수를 **기간에서 유도한다**(받은 값을 그대로 쓰지 않는다)',
    /const days = daysFromRange\(start, input\.endDate\) \?\? 1/.test(code))
  check('⑤ 서버도 **같은 판정 함수**를 부른다(사본 금지)',
    /const periodErr = inspectionPeriodError\(start, input\.endDate\)/.test(code)
    && /if \(periodErr\) return \{ error: periodErr \}/.test(code))
  /* 🚨 (음성) 종전의 **조용한 떨굼**이 되살아나면 안 된다 — `<= 5 ? days : 1`은 7을 5도 아닌
     1로 만들었고, 그 손실은 화면 어디에도 안 드러났다. 그 모양 자체를 금지한다. */
  check('🚨 ⑤ (음성) 범위 밖 일수를 조용히 1로 떨구는 옛 코드가 없다',
    !/input\.days >= 1 && input\.days <= 5 \? input\.days : 1/.test(code))
  check('🚨 ⑤ (음성) 액션이 `input.days`를 저장값으로 **직접** 쓰지 않는다',
    !/inspection_days: input\.days/.test(code) && !/const days = input\.days/.test(code))
}

try {
  userId = await mkUser({ email: EMAIL, name: '점검기간프로브', employeeId: 'E2E-PRD' })
  custId = await mkCustomer({ customer_name: '점검기간프로브고객', address: '경기 양평군 테스트로 91', created_by: userId })
  const { data: ins, error: iErr } = await raw.from('inspections').insert({
    customer_id: custId, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
    inspection_start_date: today, status: 'in_progress', assigned_employee_id: userId, created_by: userId,
  }).select('id').single()
  if (iErr) throw new Error(`점검 생성 실패: ${iErr.message}`)
  inspId = ins.id

  const l = await launch(); browser = l.browser; const page = l.page
  page.on('dialog', (d: { accept: () => Promise<void> }) => { void d.accept() })
  await login(page, EMAIL)
  await page.goto(`${BASE}/inspections/${inspId}?step=1`)

  const endBox = page.locator('[data-testid="multiday-end"]')
  const dayBox = page.locator('[data-testid="multiday-days"]')
  const saveBtn = page.locator('[data-testid="multiday-save"]')
  const seen = await endBox.waitFor({ state: 'visible', timeout: 60000 }).then(() => true).catch(() => false)
  check('(전제) 점검 기간 칸이 보인다', seen)
  if (!seen) throw new Error('기간 칸 없음 — 이후 단언이 공허하다')

  // ══ ② 종료일 → 일수 ══════════════════════════════════════════════════════
  await endBox.fill(plus(2))
  await page.waitForTimeout(400)
  check('② 종료일을 넣으면 **일수가 따라온다** (시작+2 → 3일)',
    (await dayBox.inputValue()) === '3', `일수=${await dayBox.inputValue()}`)

  // ══ ② 일수 → 종료일 ══════════════════════════════════════════════════════
  await dayBox.fill('2')
  await page.waitForTimeout(400)
  check('② 일수를 넣으면 **종료일이 따라온다** (2일 → 시작+1)',
    (await endBox.inputValue()) === plus(1), `종료일=${await endBox.inputValue()}`)

  await dayBox.fill('1')
  await page.waitForTimeout(400)
  check('② 1일이면 종료일을 **비운다**(당일 점검 표기)',
    (await endBox.inputValue()) === '', `종료일=${await endBox.inputValue()}`)

  // ══ ③ 상한 — 저장 전에 막고 말한다 ═══════════════════════════════════════
  await endBox.fill(plus(7))
  await page.waitForTimeout(400)
  check('③ 5일을 넘기면 경고가 뜬다',
    await page.locator('[data-testid="multiday-warn"]').isVisible().catch(() => false))
  check('③ 그때 [저장]이 잠긴다 — 종전엔 말없이 받고 서버가 일수를 1로 떨궜다',
    await saveBtn.isDisabled().catch(() => true))
  check('③ 일수 칸은 **실제 일수(8)**를 보여준다 — 5로 잘라 숨기지 않는다',
    (await dayBox.inputValue()) === '8', `일수=${await dayBox.inputValue()}`)

  /* ⚠ 일수 칸으로 넘기는 길은 **상한에서 자른다**(종료일 쪽과 다르다): 여기서 8을 그대로 두면
     8일짜리 종료일을 만들어 놓고 스스로 막는 꼴이 된다. 축이 다르므로 둘 다 단언한다. */
  await dayBox.fill('9')
  await page.waitForTimeout(400)
  check('③ 일수 칸에 9를 치면 상한 5로 잘린다',
    (await dayBox.inputValue()) === '5', `일수=${await dayBox.inputValue()}`)
  check('③ 그때 종료일도 5일치로 맞춰진다', (await endBox.inputValue()) === plus(4),
    `종료일=${await endBox.inputValue()}`)

  // ══ ④ 저장하면 DB의 쌍이 일치한다 ════════════════════════════════════════
  await endBox.fill(plus(2))
  await page.waitForTimeout(400)
  await saveBtn.click()
  await page.waitForTimeout(2500)
  const { data: after } = await raw.from('inspections')
    .select('inspection_end_date, inspection_days').eq('id', inspId).single()
  check('④ 저장된 종료일', after?.inspection_end_date === plus(2), String(after?.inspection_end_date))
  check('④ 저장된 일수가 기간과 **일치한다**(종전엔 1로 남았다)',
    after?.inspection_days === 3, `일수=${after?.inspection_days}`)

} catch (e) {
  check('예외 없음', false, String(e))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (inspId) await raw.from('inspections').delete().eq('id', inspId)
  if (custId) await cleanupCustomer(custId)
  if (userId) await delUser(userId)
  summary()
}
