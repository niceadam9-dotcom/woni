/** 고객 등록 화면 정렬 — 한 줄기 네 카드 + 고객명 첫 커서 (2026-09-23)
 *  실행: npx tsx scripts/test-customer-new-layout.mts   — **서버·DB 불필요**
 *
 *  사용자: 「고객등록이 너무 산만하게 분산되어 있다 — 편리하고 쉽게 보기 좋게 정렬」 + 「처음 커서는 고객명」.
 *  종전 좌(필수)|우(선택) 두 칸은 ①필수인 사용승인일이 **오른쪽 선택 칸**에 있었고 ②선택인 등급이 필수 사이에
 *  끼었고 ③오른쪽이 기본 펼침이라 필수보다 길었다. 이제 **위→아래 = 입력 순서 = 탭 순서**다.
 *
 *  여기서 지키는 것:
 *   ① 첫 커서는 고객명(autoFocus)
 *   ② ★ 주소 검색이 **이미 친 고객명을 덮지 않는다** — 고객명을 첫 칸으로 올리면 「이름부터 치고 주소 검색」이
 *      정상 동선이 된다. 종전의 무조건 덮기가 남으면 첫 커서 요청이 곧 데이터 손실 경로가 된다.
 *   ③ 화면 순서: 고객명 < 주소 < 사용승인일 < 점검일자 < 점검유형 < 대표 < ④(담당·등급·건물정보)
 *   ④ 필수 칸이 접힌 ④ 안에 **들어가지 않는다**(접혀 있으면 못 채워 [등록]이 영영 잠긴다)
 *   ⑤ ④는 기본 접힘 · 하단 바는 sticky · 하단 칩도 화면 순서
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

const src = codeOnly(readFileSync(new URL('../src/components/customers/customer-new-client.tsx', import.meta.url), 'utf8'))
const jsxStart = src.indexOf('  return (\n    <form')
const jsx = jsxStart > 0 ? src.slice(jsxStart) : ''

console.log('— ① 첫 커서')
ok('★ 고객명 칸에 autoFocus가 있다',
  /id="new-customer-name"\s*\n\s*ref=\{customerNameRef\}\s*\n\s*autoFocus\b/.test(jsx))
ok('autoFocus는 고객명 **하나뿐**이다 (둘이면 마지막이 이긴다)', (jsx.match(/\bautoFocus\b/g) ?? []).length === 1,
  String((jsx.match(/\bautoFocus\b/g) ?? []).length))

console.log('\n— ② ★ 주소 검색이 친 이름을 덮지 않는다')
{
  const i = src.indexOf('function handleAddressSearch()')
  const body = i > 0 ? src.slice(i, src.indexOf('checkAddressAction(data.roadAddress)', i)) : ''
  ok('판정은 **지금 칸의 값**(ref)으로 한다 — 콜백의 form은 낡을 수 있다',
    /const typedName = \(customerNameRef\.current\?\.value \?\? ''\)\.trim\(\)/.test(body))
  ok('★ 친 이름이 있으면 건물명을 뽑지도 않는다',
    /const building = typedName \? '' : extractBuildingName\(data\.roadAddress\)/.test(body))
  ok('★ setForm도 비었을 때만 채운다 (이중 가드)',
    /customer_name: prev\.customer_name\.trim\(\) \? prev\.customer_name : building/.test(body))
  ok('★ 음성 — 무조건 덮는 옛 줄이 없다',
    !/setForm\(prev => \(\{ \.\.\.prev, customer_name: building \}\)\)/.test(body))
}

console.log('\n— ③ 화면 순서 = 입력 순서 = 탭 순서')
{
  const marks: Array<[string, string]> = [
    ['고객명', 'id="new-customer-name"'],
    ['주소', 'id="new-address"'],
    ['사용승인일', 'id="new-use-approval"'],
    ['점검일자', 'id="new-anchor-date"'],
    ['점검유형', 'name="inspection_category"'],
    ['대표 관계인', 'id="contact-대표-name"'],
    ['④ 접이', 'data-testid="new-optional-toggle"'],
    ['담당직원', 'id="new-assignee"'],
    ['소방안전관리등급', 'label="소방안전관리등급"'],
    ['건물용도', 'ariaLabel="건물용도"'],
    ['하단 바', 'data-testid="new-submit-bar"'],
  ]
  const at = marks.map(([n, m]) => [n, jsx.indexOf(m)] as const)
  const missing = at.filter(([, i]) => i < 0).map(([n]) => n)
  ok('표식이 전부 있다', missing.length === 0, missing.join(', '))
  const bad: string[] = []
  for (let k = 1; k < at.length; k++) if (!(at[k - 1][1] < at[k][1])) bad.push(`${at[k - 1][0]} ≮ ${at[k][0]}`)
  ok('★ 순서: 고객명 < 주소 < 사용승인일 < 점검일자 < 점검유형 < 대표 < ④(담당·등급·건물) < 하단 바', bad.length === 0, bad.join(' · '))
  ok('★ 두 칸 배치(좌 필수 | 우 선택)가 없다', !/lg:flex-row/.test(jsx))
  ok('읽기전용 우편번호·지번 입력칸이 없다 (글자 한 줄로 — 탭에 안 걸린다)',
    !/readOnly/.test(jsx) && /data-testid="new-address-meta"/.test(jsx))
}

console.log('\n— ④ ★ 필수 칸은 접힌 ④ 안에 없다')
{
  const a = jsx.indexOf('data-testid="new-optional-body"'), b = jsx.indexOf('data-testid="new-submit-bar"')
  const opt = a > 0 && b > a ? jsx.slice(a, b) : ''
  ok('④ 본문을 찾았다', opt.length > 0)
  const leaked = ['id="new-customer-name"', 'id="new-address"', 'id="new-use-approval"', 'id="new-anchor-date"',
    'name="inspection_category"', 'id="contact-대표-name"'].filter(m => opt.includes(m))
  ok('★ 필수 6칸 중 어느 것도 ④ 안에 없다', leaked.length === 0, leaked.join(', '))
  ok('선택 칸(담당·계약일·등급·건물용도·비고)은 ④ 안에 있다',
    ['id="new-assignee"', 'id="new-contract-date"', 'label="소방안전관리등급"', 'ariaLabel="건물용도"', 'id="new-notes"']
      .every(m => opt.includes(m)))
}

console.log('\n— ⑤ 접힘 · 하단 바 · 칩 순서')
ok('★ ④는 기본 접힘', /const \[showOptional, setShowOptional\] = useState\(false\)/.test(src))
ok('접힌 머리가 대장 자동 채움 개수를 알린다', /data-testid="new-optional-auto"/.test(jsx) && /autoBuildingCount/.test(src))
ok('★ 하단 바가 sticky다 (스크롤해도 [등록]이 보인다)',
  /data-testid="new-submit-bar"\s*\n\s*className="sticky bottom-0/.test(jsx))
ok('하단 칩 순서 = 화면 순서', () => {
  const m = src.match(/const requiredChecks[\s\S]*?\n  \]/)
  const items = m ? [...m[0].matchAll(/\n\s*\['([^']+)'/g)].map(x => x[1]) : []
  return JSON.stringify(items) === JSON.stringify(['고객명', '주소', '사용승인일', '점검일자', '점검유형', '대표 관계인'])
})
ok('날짜 칸은 라벨과 이어져 있다 (id ↔ htmlFor — 검사·보조기기가 순번 아닌 이름으로 잡는다)',
  ['new-use-approval', 'new-anchor-date', 'new-contract-date'].every(id => jsx.includes(`htmlFor="${id}"`) && jsx.includes(`id="${id}"`)))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
