// B2 — lib/biz-no 단위 단언(서버 저장 검증·발행 화면·홈택스 엑셀이 같은 함수를 쓴다)
import { bizNoDigits, formatBizNoDash, isValidBizNo, isValidTaxEmail, billingProfileReady } from '../src/lib/biz-no'
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }
// 체크섬 통과 표본은 계산으로 만든다(실재 사업자 번호를 테스트에 박지 않는다)
const makeValid = (nine: string) => {
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0
  for (let i = 0; i < 9; i++) s += Number(nine[i]) * w[i]
  s += Math.floor((Number(nine[8]) * 5) / 10)
  return nine + String((10 - (s % 10)) % 10)
}
const good = makeValid('123456789'), bad = good.slice(0, 9) + String((Number(good[9]) + 1) % 10)
ok(isValidBizNo(good) === true, `체크섬 통과 ${good}`)
ok(isValidBizNo(formatBizNoDash(good)) === true, '하이픈 형식도 통과')
ok(isValidBizNo(bad) === false, `검증번호 1 다르면 실패 ${bad}`)
ok(isValidBizNo('12345') === null, '10자리 미만은 판정 보류(null)')
ok(isValidBizNo(null) === null && isValidBizNo('') === null, '빈 값은 null')
ok(formatBizNoDash(good) === `${good.slice(0, 3)}-${good.slice(3, 5)}-${good.slice(5)}`, '000-00-00000 형식')
ok(bizNoDigits(formatBizNoDash(good)) === good, '숫자만 10자리 복원(홈택스 엑셀 형식)')
ok(isValidTaxEmail('a@b.co') && !isValidTaxEmail('a@b') && !isValidTaxEmail(' ') && !isValidTaxEmail(null), '이메일 형식')
ok(billingProfileReady({ business_no: good, tax_email: 'x@y.kr' }) === true, '발급 가능 = 번호 유효 + 이메일')
ok(billingProfileReady({ business_no: bad, tax_email: 'x@y.kr' }) === false, '번호 틀리면 발급 불가')
ok(billingProfileReady({ business_no: good, tax_email: '' }) === false, '이메일 없으면 발급 불가')
ok(billingProfileReady(null) === false, '사업자정보 없으면 발급 불가')
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
