/** 고객 완전 삭제가 **모든 버킷**을 치우는가 — 소방계획서_32 S8-3.
 *
 *  실패 양상이 조용하다: 버킷을 새로 만들고 삭제 경로에 안 넣으면 아무 오류도 안 나고
 *  파일만 남는다. DB 행은 156이 지우므로 어떤 FK로도 따라갈 수 없는 고아가 된다.
 *  실측(2026-09-08)으로 실제 그랬다 — 5개 버킷 중 `inspection-reports`가 빠져 있었고,
 *  **그 버킷이 가진 파일 전부(1/1)가 사라진 점검을 가리키고 있었다.**
 *
 *  판정 방식: 실제 버킷 목록(서비스 롤로 조회)과 삭제 액션 소스에 적힌 버킷을 대조한다.
 *  파일을 올려 보는 대신 배선을 보는 이유는 싸고 결정적이기 때문이다 — 정리 로직 자체는
 *  `_purgeStoragePrefix`가 하나뿐이라 한 번 연결되면 동작은 공용이다.
 *
 *  ⚠ 이 검사는 '연결됐는가'만 본다. 접두사 규약이 맞는지(예: 새 버킷이 `{userId}/`로
 *    나뉜다면 고객 id로는 못 지운다)는 사람이 봐야 한다 — 그래서 미등록 버킷을 발견하면
 *    경로 표본을 함께 찍어 준다.
 *
 *  실행: npx tsx scripts/test-storage-purge-coverage.mts */
import { readFileSync } from 'fs'
import { join } from 'path'
// @ts-expect-error mjs 헬퍼
import { raw, check, summary } from './_e2e-helpers.mjs'

const SRC = join(process.cwd(), 'src', 'app', '(dashboard)', 'customers', 'actions.ts')

/** 고객 축이 아닌 버킷 — 여기 넣을 때는 **왜 아닌지**를 함께 적을 것 */
const NOT_CUSTOMER_SCOPED: Record<string, string> = {
  'log-archives': '활동로그 아카이브 — 고객이 아니라 기간 단위로 쌓인다(purge-activity-logs 크론 소관)',
}

const src = readFileSync(SRC, 'utf8')
// `_purgeStoragePrefix(admin, 'x', …)` 와 `.from('x').remove(` 둘 다 정리 경로다
const wired = new Set([
  ...[...src.matchAll(/_purgeStoragePrefix\(\s*admin\s*,\s*'([^']+)'/g)].map(m => m[1]),
  ...[...src.matchAll(/storage\s*\.from\('([^']+)'\)\s*\.remove\(/g)].map(m => m[1]),
])
console.log(`삭제 액션이 치우는 버킷: ${[...wired].sort().join(', ') || '(없음)'}`)

const { data: buckets, error } = await raw.storage.listBuckets()
if (error) {
  check('버킷 목록 조회', false, error.message)
} else {
  const names = (buckets as Array<{ name: string }>).map(b => b.name).sort()
  console.log(`실제 버킷 ${names.length}개: ${names.join(', ')}`)

  const missing = names.filter(n => !wired.has(n) && !(n in NOT_CUSTOMER_SCOPED))
  check('모든 고객 축 버킷이 삭제 경로에 연결돼 있다', missing.length === 0,
    `미연결: ${missing.join(', ')} — 고객을 지워도 이 버킷의 파일은 남는다. ` +
    `고객 축이 아니면 NOT_CUSTOMER_SCOPED에 **사유와 함께** 등록할 것`)

  // 미연결 버킷의 경로 표본 — 접두사 규약을 사람이 판단할 재료
  for (const b of missing) {
    const { data } = await raw.storage.from(b).list('', { limit: 3 })
    console.log(`   ${b} 표본: ${((data ?? []) as Array<{ name: string }>).map(o => o.name).join(' | ') || '(비어 있음)'}`)
  }

  // 반대 방향 — 소스에 적힌 버킷이 실제로 존재하는가(오타·이름 변경으로 조용히 헛도는 것 방지)
  const ghosts = [...wired].filter(w => !names.includes(w))
  check('삭제 경로에 적힌 버킷이 전부 실재한다(오타·이름 변경 없음)', ghosts.length === 0,
    `실재하지 않는 버킷: ${ghosts.join(', ')} — 그 줄은 아무것도 안 지우면서 지우는 척한다`)

  // 제외 목록이 낡지 않았는지 — 사라진 버킷을 계속 예외로 두면 다음 사람이 오해한다
  const staleExcuse = Object.keys(NOT_CUSTOMER_SCOPED).filter(n => !names.includes(n))
  check('제외 목록에 사라진 버킷이 남아 있지 않다', staleExcuse.length === 0,
    `이미 없는 버킷: ${staleExcuse.join(', ')}`)
}

// ⚠ Storage 클라이언트(listBuckets)가 keep-alive 소켓을 남겨, summary()의 process.exit가
//   그 핸들 정리와 겹치면 Windows/libuv가 assertion으로 죽는다(실측: rc=-1073740791 재현 2/2).
//   **검사는 전부 초록인데 종료 코드만 실패**라 test:all이 이 단계를 빨갛게 본다 —
//   내용이 아니라 마무리에서 지는 유형이라 원인을 찾기 어렵다. 소켓이 닫힐 틈을 준다.
await new Promise(r => setTimeout(r, 300))
summary()
