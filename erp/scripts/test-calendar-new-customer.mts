/** 달력에서 고객 등록 — 배선 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-calendar-new-customer.mts   — **서버·DB 불필요**
 *
 *  이 축에서 실제로 무서운 실패는 「버튼이 안 뜬다」가 아니라 다음 셋이다:
 *
 *  ① **폼이 복제된다.** `customer-new-client.tsx`(877줄)에는 필수 6칸 판정, 고객코드 자동생성
 *     대기, 주소·고객명 **중복검사**, 건축물대장 자동조회가 들어 있다. 「달력용 간단 폼」을
 *     새로 짜면 두 벌이 되고 한쪽만 고쳐진다 — 그 순간 달력 등록만 중복 고객을 허용하게 된다.
 *  ② **권한 없이 뜬다.** 버튼을 안 가리면 눌러 봐야 서버가 던진다.
 *  ③ **기존 화면이 부서진다.** `/customers/new`는 `onCreated`를 안 넘기므로 종전대로
 *     `router.push`로 이동해야 한다. 그 폴백이 사라지면 등록하고 아무 일도 안 일어난다.
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
const actions = read('../src/app/(dashboard)/customers/actions.ts')

console.log('— ① 폼은 한 벌이다 (복제 금지)')
ok('★ 달력이 CustomerNewClient를 **그대로** 쓴다',
  /import\(['"]@\/components\/customers\/customer-new-client['"]\)/.test(client)
  && /<CustomerNewClient\b/.test(client))
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
  /getCustomerNewFormDataAction[\s\S]{0,300}?requirePermission\('customer_manage'\)/.test(actions))

console.log('\n— ③ 기존 화면 회귀 방지')
ok('★ onCreated를 안 넘기면 종전대로 이동한다 (폴백 보존)',
  /router\.push\(`\/customers\/\$\{result\.customerId\}\?created=1&onboarding=1`\)/.test(form))
ok('★ onCreated가 있으면 이동하지 않는다', /if \(onCreated\) \{[\s\S]{0,300}?return\n/.test(form))
ok('프리필은 **lazy 초기값에만** 꽂힌다 (effect로 덮지 않는다)',
  /plan_anchor_date: initialAnchorDate/.test(form) && !/setField\('plan_anchor_date', initialAnchorDate/.test(form))

console.log('\n— 동선 — 달력에 머물고 다음 걸음을 준다')
ok('등록 후 달력이 띠를 남긴다', /calendar-created-banner/.test(client))
ok('★ 「나머지 채우기」의 목적지 탭을 화면이 고르지 않는다 (서버가 첫 미완 탭으로 정한다)',
  /created\.customerId\}\?created=1&onboarding=1/.test(client) && !/tab=plan|tab=buildings/.test(client))
// ⚠ `A|B`로 쓰면 둘 중 하나만 맞아도 통과한다 — 「링크가 있고 **거기에** from이 실렸다」를 묻는다
ok('★ 「나머지 채우기」 링크에 복귀 경로(from=)가 실려 있다', () => {
  const m = client.match(/href=\{`\/customers\/\$\{created\.customerId\}[^`]*`\}/)
  return !!m && m[0].includes('from=${encodeURIComponent(calendarBackHref)}')
}, client.match(/href=\{`\/customers\/\$\{created\.customerId\}[^`]*`\}/)?.[0] ?? '(링크 없음)')
ok('짚은 날짜가 점검일자로 넘어간다', /initialAnchorDate=\{newCustomerDate\}/.test(client))

console.log('\n— 비용 — 달력 초기 로드에 얹지 않는다')
ok('★ 폼은 지연 로드된다(dynamic)', /dynamic\(\s*\(\) => import\(['"]@\/components\/customers\/customer-new-client/.test(client))
ok('★ 폼 데이터는 **열 때** 받는다 (서버 컴포넌트가 미리 싣지 않는다)',
  /getCustomerNewFormDataAction\(\)/.test(client)
  && !/listBuildingPurposes|getCompanyProfile/.test(page))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
