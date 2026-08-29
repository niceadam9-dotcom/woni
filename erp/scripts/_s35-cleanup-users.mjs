// 소방계획서_35 세션이 흘린 테스트 계정 정리.
//
// 원인: mkUser는 **id 문자열**을 반환하는데(_e2e-helpers.mjs:47) 내 스크립트들이
// `u.id`(=undefined)를 delUser에 넘겼고, delUser는 falsy면 조용히 return한다(:52).
// → 실패도 경고도 없이 계정이 계속 쌓였다. '조용한 no-op'의 전형이다.
import { raw } from './_e2e-helpers.mjs'

const PREFIXES = ['s35font_', 's35shot_', 's35read_', 's35var_', 's35rt_', 's35fin_', 's35diag_', 's35fsA_', 's35fsB_']
const hit = []
for (let page = 1; page <= 20; page++) {
  const { data } = await raw.auth.admin.listUsers({ page, perPage: 1000 })
  const users = data?.users ?? []
  for (const u of users) if (PREFIXES.some(p => (u.email ?? '').startsWith(p))) hit.push(u)
  if (users.length < 1000) break
}
console.log(`대상 계정 ${hit.length}개`)
let ok = 0, fail = 0
for (const u of hit) {
  await raw.from('profiles').delete().eq('id', u.id)
  const { error } = await raw.auth.admin.deleteUser(u.id)
  if (error) { fail++; console.log(`  실패 ${u.email}: ${error.message}`) } else ok++
}
console.log(`삭제 ${ok} / 실패 ${fail}`)

// 잔재 확인 — '0이어야 정상'을 실제로 재확인한다(지웠다고 믿지 않는다)
const left = []
for (let page = 1; page <= 20; page++) {
  const { data } = await raw.auth.admin.listUsers({ page, perPage: 1000 })
  const users = data?.users ?? []
  for (const u of users) if (PREFIXES.some(p => (u.email ?? '').startsWith(p))) left.push(u.email)
  if (users.length < 1000) break
}
console.log(`잔존 ${left.length}개${left.length ? ': ' + left.join(', ') : ''}`)
process.exitCode = left.length === 0 ? 0 : 1
