// 전화번호 표기 통일 프로브 (2026-08-20 요청 — 입력·조회·인쇄 전부 010-0000-0000)
//   ① 표시 규칙(formatTel)이 옳고, 이미 하이픈이 있어도 안전하며, 훼손하면 안 되는 값은 건드리지 않는다
//   ② 입력 중 자동 하이픈(formatPhoneKR)이 진행형으로 동작한다
//   ③ SMS 발송은 하이픈이 섞여도 숫자만 보낸다 — 저장 형식이 바뀌어도 발송이 깨지지 않는다
//   ④ 정적 가드: 전화번호를 입력·표시·인쇄하는 지점이 포맷터를 거치는가 (다음 사람이 빠뜨리면 여기서 걸린다)
// 서버·DB 불필요. 실행: npx tsx scripts/_probe-phone-format.mjs
import { readFileSync } from 'node:fs'
const { formatTel } = await import('../src/lib/format-contact.ts')
const { formatPhoneKR } = await import('../src/components/ui/fields.tsx')
const { normalizePhone, isSendablePhone } = await import('../src/lib/sms-recipients.ts')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}
const eq = (name, got, want) => check(`${name} → ${JSON.stringify(want)}`, got === want, `실제: ${JSON.stringify(got)}`)

console.log('\n── ① 표시 규칙 formatTel ──')
eq('휴대전화 11자리', formatTel('01032162321'), '010-3216-2321')   // image-57에서 붙어 나오던 값
eq('서울 10자리', formatTel('0212345678'), '02-1234-5678')
eq('서울 9자리', formatTel('021234567'), '02-123-4567')
eq('지역 10자리', formatTel('0311234567'), '031-123-4567')
eq('대표번호 8자리', formatTel('15881588'), '1588-1588')
check('이미 하이픈이 있어도 그대로(멱등) — 두 번 거쳐도 안전',
  formatTel('010-3216-2321') === '010-3216-2321' && formatTel(formatTel('01032162321')) === '010-3216-2321')
eq('빈 값', formatTel(null), '')
console.log('  · 훼손 금지 — 재구성하면 정보가 사라지는 값은 원문 유지')
eq('이름+번호 한 칸(서식 1.2.1 담당자)', formatTel('홍길동 031-000-0000'), '홍길동 031-000-0000')
eq('연번 표기', formatTel('031-123-4567~8'), '031-123-4567~8')
eq('내선 표기', formatTel('02-123-4567(내선100)'), '02-123-4567(내선100)')
eq('자릿수 미달은 손대지 않는다', formatTel('12345'), '12345')

console.log('\n── ② 입력 중 자동 하이픈 formatPhoneKR ──')
eq('입력 진행형 4자리', formatPhoneKR('0103'), '010-3')
eq('입력 진행형 7자리', formatPhoneKR('0103216'), '010-3216')
eq('완성', formatPhoneKR('01032162321'), '010-3216-2321')
eq('붙여넣기(하이픈 포함)도 정규화', formatPhoneKR('010-3216-2321'), '010-3216-2321')
eq('서울', formatPhoneKR('0212345678'), '02-1234-5678')
eq('11자리 초과분은 버린다', formatPhoneKR('010321623219999'), '010-3216-2321')
check('문자를 넣어도 숫자만 남는다', formatPhoneKR('010a3216b2321') === '010-3216-2321')

console.log('\n── ③ SMS는 하이픈이 섞여도 숫자만 발송한다 (저장 형식이 바뀌어도 안 깨진다) ──')
eq('하이픈 제거', normalizePhone('010-3216-2321'), '01032162321')
eq('숫자만 들어와도 동일', normalizePhone('01032162321'), '01032162321')
check('두 표기가 같은 번호로 취급된다 — 중복 발송·경합 판정이 어긋나지 않는다',
  normalizePhone('010-3216-2321') === normalizePhone('01032162321'))
check('하이픈 표기도 발송 가능 판정을 통과한다',
  isSendablePhone(normalizePhone('010-3216-2321')) === true)
check('빈 값·잘린 번호는 발송 대상이 아니다',
  isSendablePhone(normalizePhone('')) === false && isSendablePhone(normalizePhone('010-32')) === false)

console.log('\n── ④ 정적 가드 — 포맷터를 거치는가 ──')
const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
/** 파일에서 needle 이 들어간 줄이 있는가 */
const has = (p, needle) => src(p).split(/\r?\n/).some(l => l.includes(needle))

console.log('  · 인쇄 문서 — 조립 지점에서 통일')
const ACO = 'src/lib/annex-cover-official.ts'
check('표지·공문 회사 전화/팩스 (annex-cover-official)',
  (src(ACO).match(/phone: formatTel\(company\?\.phone\)/g) ?? []).length === 2
  && (src(ACO).match(/fax: formatTel\(company\?\.fax\)/g) ?? []).length === 2)
check('위임장 관계인 전화', has(ACO, "phone: formatTel(fstr('ownerPhone')"))
check('위임장 대리인 전화', has(ACO, "phone: formatTel(fstr('agentPhone'))"))
check('별지 9호 2쪽 대표자·소방안전관리자 (종전부터 적용)',
  has('src/app/(dashboard)/inspections/report9-actions.ts', 'ownerPhone: formatTel(owner?.phone)'))
check('소방계획서 2장 자위소방대 표', has('src/lib/fire-plan-template.ts', 'v(formatTel(b.phone))'))
check('소방계획서 1.10.3 다중이용업소 (종전부터 적용)', has('src/lib/fire-plan-template.ts', 'formatTel(mu.phone)'))
// 템플릿(cover/official)은 받은 문자열을 그대로 찍는 게 맞다 — 통일은 조립 지점의 책임이다.
// 그러니 조립 지점에 '원문 그대로 넘기는' 잔재가 남아 있지 않은지를 본다.
check('조립 지점에 company.phone/fax를 원문 그대로 넘기는 자리가 없다',
  !/(?:phone|fax): company\?\.(?:phone|fax) \?\? ''/.test(src(ACO)),
  src(ACO).split(/\r?\n/).filter(l => /company\?\.(phone|fax) \?\? ''/.test(l)).join(' | '))

console.log('  · 입력칸 — 자동 하이픈')
for (const [label, p, needle] of [
  ['고객 신규 등록 · 대표 관계인', 'src/components/customers/customer-new-client.tsx', "setContact('대표', 'phone', formatPhoneKR"],
  ['고객 신규 등록 · 추가 관계인', 'src/components/customers/customer-new-client.tsx', "setContact(role, 'phone', formatPhoneKR"],
  ['고객 관계인 수정', 'src/components/customers/edit-contacts-client.tsx', 'formatPhoneKR'],
  ['주소록 전화번호', 'src/components/address-book/address-book-client.tsx', 'phone: formatPhoneKR'],
  ['주소록 휴대폰', 'src/components/address-book/address-book-client.tsx', 'mobile: formatPhoneKR'],
  ['문의 등록', 'src/components/inquiries/inquiry-new-client.tsx', "setField('contact_phone', formatPhoneKR"],
  ['문의 수정', 'src/components/inquiries/inquiry-detail-client.tsx', "setField('contact_phone', formatPhoneKR"],
  ['서식 1.10.3 다중이용업소', 'src/components/customers/plan-form110.tsx', 'phone: formatPhoneKR'],
  ['본사 정보 대표전화·팩스', 'src/components/company/company-form-client.tsx', 'formatPhoneKR'],
  ['거래처 연락처', 'src/components/partners/partner-form-client.tsx', 'formatPhoneKR'],
  ['소방계획서 2장 자위소방대', 'src/components/customers/plan-ch2.tsx', 'PhoneField'],
]) check(label, has(p, needle))
check('서식 1.2.1 담당자(연락처)는 자동 하이픈을 걸지 않는다 — 이름+번호 한 칸이라 이름이 지워진다',
  !has('src/components/customers/plan-form12.tsx', 'formatPhoneKR'))

console.log('  · 조회 표시 — formatTel')
for (const [label, p, needle] of [
  ['고객 상세 요약 패널(대표)', 'src/components/customers/customer-summary-panel.tsx', 'formatTel(repPhone)'],
  ['고객 관계인 카드', 'src/components/customers/edit-contacts-client.tsx', 'formatTel(contact!.phone)'],
  ['주소록 가져오기 목록', 'src/components/customers/edit-contacts-client.tsx', 'formatTel(e.phone)'],
  ['주소록 카드 전화', 'src/components/address-book/address-book-client.tsx', 'formatTel(c.phone)'],
  ['주소록 카드 휴대폰', 'src/components/address-book/address-book-client.tsx', 'formatTel(c.mobile)'],
  ['문의 상세', 'src/components/inquiries/inquiry-detail-client.tsx', 'formatTel(inquiry.contact_phone)'],
  ['점검 등록 관계인 드롭다운', 'src/components/inspections/inspection-new-client.tsx', 'formatTel(c.phone)'],
  ['문의 목록', 'src/app/(dashboard)/inquiries/page.tsx', 'formatTel(r.contact_phone)'],
  ['점검 정보 팝오버(관계인)', 'src/components/inspections/inspection-info-popover.tsx', 'formatTel(info.contactPhone)'],
  ['소방계획서 자위소방대 후보 목록', 'src/components/customers/fire-plan-info-panel.tsx', 'formatTel(p.phone)'],
]) check(label, has(p, needle))
// 전수 스캔 — 전화번호를 `{x.phone}` 꼴로 **그대로** 뿌리는 자리가 더 남아 있지 않은가.
// 개별 항목을 하나씩 세는 위 목록은 '내가 아는 곳'만 본다. 이건 '내가 모르는 곳'을 잡는다.
{
  const { readdirSync, statSync } = await import('node:fs')
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir)) {
      const p = `${dir}/${e}`
      if (statSync(p).isDirectory()) walk(p, out)
      else if (p.endsWith('.tsx')) out.push(p)
    }
    return out
  }
  const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  // 값을 그대로 렌더하는 꼴: {r.phone} {c.mobile} {info.contactPhone} `${x.phone}` 등
  const RAW = /[{`$]\s*\$?\{?\s*[A-Za-z_$][\w$]*(?:[.!?]+[\w$]+)*\.(?:phone|mobile|fax|contactPhone|contact_phone)\s*\}/
  const ALLOW = [
    'phoneMasked',                     // 서버가 이미 010-****-1234 로 가린 값
    'plan-form12.tsx',                 // 1.2.1 담당자(연락처) = 이름+번호 한 칸 — 재구성 금지
  ]
  const offenders = []
  let candidates = 0, files = 0
  for (const f of walk(root)) {
    files++
    for (const [i, line] of readFileSync(f, 'utf8').split(/\r?\n/).entries()) {
      if (!RAW.test(line)) continue
      candidates++
      if (line.includes('formatTel') || line.includes('formatPhoneKR')) continue
      if (line.includes('value=') || line.includes('onChange')) continue   // 입력칸은 위에서 따로 본다
      if (ALLOW.some(a => line.includes(a) || f.includes(a))) continue
      offenders.push(`${f.slice(root.length + 1)}:${i + 1}  ${line.trim().slice(0, 100)}`)
    }
  }
  // 이 스캔은 `{x.phone}` 꼴 **직접 렌더**만 본다. `{x.phone && <p>…</p>}` 같은 조건부는 못 잡으므로
  // 이것만 믿으면 안 된다(위 항목별 목록이 그 몫). 후보 수를 함께 단언해 스캔이 조용히 0줄이 되는 것을 막는다.
  check(`스캔이 실제로 동작한다 — tsx ${files}개에서 후보 ${candidates}줄`, candidates >= 10)
  check('`{x.phone}` 꼴 직접 렌더 중 포맷터를 안 거친 자리가 없다',
    offenders.length === 0, offenders.join('\n       '))
}

console.log('  · 전화걸기 링크는 숫자만')
check('고객 관계인 카드 tel:', has('src/components/customers/edit-contacts-client.tsx', "tel:${contact!.phone.replace(/\\D/g, '')}"))
check('요약 패널 tel:', has('src/components/customers/customer-summary-panel.tsx', "tel:${repPhone.replace(/\\D/g, '')}"))

console.log('  · 검색은 하이픈 유무를 가리지 않는다')
check('주소록 번호 검색 정규화', has('src/components/address-book/address-book-client.tsx', 'digits(c.phone).includes(qd)'))

console.log(`\n결과: ${pass} pass / ${fail} fail\n`)
process.exit(fail ? 1 : 0)
