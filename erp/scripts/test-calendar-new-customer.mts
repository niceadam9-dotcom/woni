/** 달력에서 고객 등록 → 등록 페이지 → **왔던 사이드바로 복귀** — 배선 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-calendar-new-customer.mts   — **서버·DB 불필요**
 *
 *  🚨 2026-09-22 **계약 교대**. 처음 판은 달력 위 **모달**이었고, 이 검사는 「폼을 모달에
 *    복제하지 않았는가」를 지켰다. 사용자 요청으로 등록은 `/customers/new` **페이지**로
 *    옮겼다 — 우편번호 레이어·건축물대장 조회·중복 확인이 딸린 긴 폼이라 400px 사이드바 위
 *    모달에 얹기엔 좁았다. 낡은 단언은 **지우지 않고 반대 방향으로 갈아끼운다**: 모달이
 *    되살아나면 폼이 두 자리에 살게 되므로 여기서 멈춰 서야 한다.
 *
 *  이 축에서 실제로 무서운 실패는 「버튼이 안 뜬다」가 아니라 넷이다:
 *
 *  ① **폼이 복제된다.** `customer-new-client.tsx`에는 필수 6칸 판정, 고객코드 자동생성 대기,
 *     주소·고객명 **중복검사**, 건축물대장 자동조회가 들어 있다. 「달력용 간단 폼」이 생기면
 *     두 벌이 되고 한쪽만 고쳐진다 — 그 순간 달력 등록만 중복 고객을 허용하게 된다.
 *  ② **권한 없이 뜬다.** 버튼을 안 가리면 눌러 봐야 서버가 던진다.
 *  ③ **왕복이 안 닫힌다.** 사용자 요청의 본문이 여기다 — 「입력 다 하고 다시 사이드바 화면으로
 *     복귀하도록, **만약 사이드바에서 왔다면**」. 그 조건을 코드가 따로 판정하지 않는다:
 *     데이 패널이 열려 있으면 주소에 `day=`가 실리고 닫혀 있으면 안 실린다. **주소가 조건이다.**
 *     그래서 ㉠달력이 `day`를 주소에 쓰고 ㉡복귀 주소에 싣고 ㉢서버가 되읽고 ㉣패널 버튼이
 *     떠나기 전에 패널을 **닫지 않는** 네 고리가 전부 있어야 한다. 하나만 끊겨도 달력만 남는다.
 *  ④ **기존 화면이 부서진다.** `/customers/new`를 그냥 열면(`from` 없음) 종전대로
 *     `/customers/{id}?created=1&onboarding=1`로 가야 한다. 그 폴백이 사라지면
 *     사이드바 밖에서 등록한 사람은 등록하고 아무 데도 못 간다.
 */
import { readFileSync } from 'node:fs'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const read = (p: string) => codeOnly(readFileSync(new URL(p, import.meta.url), 'utf8'))
const form = read('../src/components/customers/customer-new-client.tsx')
const client = read('../src/components/inspections/inspection-calendar-client.tsx')
const page = read('../src/app/(dashboard)/inspections/calendar/page.tsx')
const newPage = read('../src/app/(dashboard)/customers/new/page.tsx')
const actions = read('../src/app/(dashboard)/customers/actions.ts')

console.log('— ① 폼은 한 벌이다 (복제 금지)')
ok('★ 달력이 등록 폼을 **품지 않는다** — `/customers/new`로 보낸다',
  /router\.push\(`\/customers\/new\?\$\{q\.toString\(\)\}`\)/.test(client)
  && !/<CustomerNewClient\b/.test(client))
ok('★ 음성 — 달력에 등록 모달이 되살아나지 않았다',
  !/calendar-new-customer-modal/.test(client)
  && !/customer-new-client['"]\)/.test(client))
ok('★ 필수 판정이 폼에만 있다 — 달력이 자기 판정을 만들지 않았다',
  !/requiredChecks/.test(client) && !/대표 관계인/.test(client))
ok('★ 중복검사도 달력에 복제되지 않았다',
  !/checkAddressAction|checkCustomerNameAction|customerNameDupKey/.test(client))
// ⚠ `['`를 그냥 세면 항목 안의 `contacts['대표']`까지 걸려 7이 된다(첫 판이 그랬다).
//   항목은 **줄 머리**에서 시작하므로 줄바꿈+들여쓰기를 앵커로 건다.
ok('폼의 필수는 여전히 **6칸**이고 그 6칸이다', () => {
  const m = form.match(/const requiredChecks[\s\S]*?\n  \]/)
  if (!m) return false
  // ⚠ `match(/…/g)`는 **전체 매치**를 돌려준다(그룹이 아니다) — 뒤따옴표가 남아 비교가 빗나간다.
  //   `matchAll`로 캡처 그룹만 꺼낸다.
  const items = [...m[0].matchAll(/\n\s*\['([^']+)'/g)].map(x => x[1])
  return items.length === 6
    && ['주소', '고객명', '점검유형', '점검일자', '사용승인일', '대표 관계인'].every(k => items.includes(k))
}, (form.match(/const requiredChecks[\s\S]*?\n  \]/)?.[0].match(/\n\s*\['[^']+'/g) ?? []).join(' '))

console.log('\n— ② 권한 — 버튼 자체를 가린다')
ok('서버가 customer_manage로 cap을 내린다',
  /canCreateCustomer=\{can\(profile\.role as UserRole, 'customer_manage'\)\}/.test(page))
ok('★ 데이 패널 버튼이 cap으로 가려진다', /canCreateCustomer && \([\s\S]{0,400}?daypanel-new-customer/.test(client))
ok('★ 툴바 버튼도 cap으로 가려진다', /canCreateCustomer && \([\s\S]{0,400}?calendar-new-customer["']/.test(client))
ok('서버 액션도 같은 권한을 요구한다',
  /createCustomerAction[\s\S]{0,300}?requirePermission\('customer_manage'\)/.test(actions))

console.log('\n— ③ ★ 왕복 — 「사이드바에서 왔다면」의 네 고리')
// ㉠ 열린 데이 패널이 주소에 남는가 (닫으면 지우는가 — 남기면 다음에 엉뚱한 날짜가 열린다)
ok('★ ㉠ 데이 패널이 `?day=`로 주소에 기록된다 (닫으면 지운다)', () => {
  const i = client.indexOf('if (dayPanelDate) sp.set(\'day\', dayPanelDate)')
  return i > 0 && /else sp\.delete\('day'\)/.test(client.slice(i, i + 200))
})
// ㉡ 복귀 주소가 그 값을 싣는가 — **한 곳**(calendarBackHref)에서. 두 벌이면 한쪽만 고쳐진다.
ok('★ ㉡ 복귀 주소(calendarBackHref)가 day를 싣는다', () => {
  const i = client.indexOf('const calendarBackHref = useMemo(')
  if (i < 0) return false
  const block = client.slice(i, client.indexOf('}, [searchParams', i))
  return /sp\.set\('day', dayPanelDate\); else sp\.delete\('day'\)/.test(block)
}, '(calendarBackHref 블록 안에 day가 없다)')
ok('★ ㉡ 등록 링크가 anchor와 from을 **둘 다** 싣는다', () => {
  const i = client.indexOf('const openNewCustomer = useCallback(')
  if (i < 0) return false
  const block = client.slice(i, i + 400)
  return /anchor: date/.test(block) && /from: calendarBackHref/.test(block)
})
// ㉢ 서버가 되읽는가 — 형식 검증만(지어내지 않는다)
ok('★ ㉢ 달력 서버가 `?day=`를 되읽어 패널을 복원한다',
  /const initialDayPanelDate = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(params\.day \?\? ''\)/.test(page)
  && /initialDayPanelDate=\{initialDayPanelDate\}/.test(page)
  && /useState<string \| null>\(initialDayPanelDate \|\| null\)/.test(client))
/* ㉢의 짝 — 패널만 열리고 **달력이 기한초과 달로 뛰면** 11월 패널 옆에 7월 달력이 선다.
   `?day=`가 기한초과 점프보다 **먼저** 와야 한다(삼항의 첫 가지). 2026-09-23 변이 R6이
   이 단언 없이 살아남았다 — 메모에만 있고 검사엔 없던 축이다. */
ok('★ ㉢ 복귀하면 달력도 **보던 달**(패널의 달)로 선다 — 기한초과 점프보다 먼저', () => {
  const m = client.match(/const \[calDate, setCalDate\] = useState\(\(\) =>\s*([^\n]+)/)
  return !!m && /^initialDayPanelDate \? new Date\(initialDayPanelDate \+ 'T12:00:00'\)/.test(m[1].trim())
}, '(calDate 초기값의 첫 가지가 initialDayPanelDate가 아니다)')
/* ㉣ **떠나기 전에 패널을 닫으면 안 된다.** 닫는 순간 effect가 주소에서 `day=`를 지워
   복귀 주소가 사이드바를 잃는다 — 「돌아왔는데 달력만 있다」가 정확히 이 한 줄에서 난다.
   ⚠ 이름으로 찾지 않고 **그 버튼의 onClick 안쪽**을 본다(다른 자리의 setDayPanelDate(null)은
     정당하다 — 패널 닫기 X버튼·배경 클릭). */
ok('★ ㉣ 데이 패널 등록 버튼이 떠나기 전에 패널을 닫지 않는다', () => {
  const i = client.indexOf('data-testid="daypanel-new-customer"')
  if (i < 0) return false
  const block = client.slice(i, i + 300)
  return /onClick=\{\(\) => openNewCustomer\(dayPanelDate\)\}/.test(block)
    && !/setDayPanelDate\(null\)/.test(block)
}, '(버튼 onClick이 setDayPanelDate(null)을 부른다 — 복귀 주소가 day를 잃는다)')
// 등록 페이지 쪽 — 받은 값을 폼에 꽂고, 마치면 그리로 돌려보낸다
ok('★ 등록 페이지가 anchor를 프리필로, from을 복귀 주소로 넘긴다',
  /initialAnchorDate=\{initialAnchorDate\}/.test(newPage) && /returnHref=\{returnHref\}/.test(newPage))
ok('★ 폼이 복귀 주소로 돌아간다', /if \(returnHref\) \{ router\.push\(returnHref\); return \}/.test(form))
/* 🚨 오픈 리다이렉트 — 검증 없이 push하면 `//evil.com`이 프로토콜 상대 URL로 해석돼 밖으로 튄다.
   판정은 **페이지에서** 한 벌로 한다(폼은 이미 걸러진 값을 받는다). 실제로 걸러지는지 여기서 돌려 본다. */
ok('★ 복귀 주소는 내부 경로만 받는다 (오픈 리다이렉트 차단)', () => {
  const m = newPage.match(/const returnHref = (\/.*\/)\.test\(from\) \? from : ''/)
  if (!m) return false
  const re = new RegExp(m[1].slice(1, -1))
  return re.test('/inspections/calendar?day=2026-09-22')
    && !re.test('//evil.com') && !re.test('/\\evil.com')
    && !re.test('https://evil.com') && !re.test('')
}, '(returnHref 검증식을 못 찾았거나 통과시키면 안 될 값을 통과시킨다)')

console.log('\n— ④ 기존 화면 회귀 방지')
ok('★ from이 없으면 종전대로 고객 상세로 이동한다 (폴백 보존)',
  /router\.push\(`\/customers\/\$\{result\.customerId\}\?created=1&onboarding=1`\)/.test(form))
ok('프리필은 **lazy 초기값에만** 꽂힌다 (effect로 덮지 않는다)',
  /plan_anchor_date: initialAnchorDate/.test(form) && !/setField\('plan_anchor_date', initialAnchorDate/.test(form))
ok('짚은 날짜가 세 입구(칸 [+]·툴바·데이 패널) 모두에서 점검일자로 넘어간다',
  /calendar-cell-new-customer/.test(client) && /openNewCustomer\(iso\)/.test(client)
  && /openNewCustomer\(today\)/.test(client) && /openNewCustomer\(dayPanelDate\)/.test(client))

console.log('\n— 비용 — 달력 초기 로드에 얹지 않는다')
/* 폼을 페이지로 내보낸 덕에 지연 로드 장치(dynamic import)가 **필요 없어졌다** — 달력 번들에
   877줄 폼이 애초에 안 들어간다. 종전의 「dynamic으로 미뤘는가」를 「아예 안 들여오는가」로 바꾼다. */
ok('★ 등록 폼이 달력 번들에 **들어가지 않는다**',
  !/customer-new-client/.test(client))
ok('★ 폼 데이터도 달력 서버가 미리 싣지 않는다',
  !/getCustomerNewFormDataAction/.test(client)
  && !/listBuildingPurposes|getCompanyProfile/.test(page))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
