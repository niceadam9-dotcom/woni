// 스파이크: Storage remove()의 실패·집계 거동 확인 (소방계획서_18 잔여 공백 해소안 검토용)
// 묻는 것 ① 없는 키를 지우면 error인가 data:[]인가 ② 어떤 키 모양이 확실히 error를 내는가
// 실행: npx tsx scripts/_spike-storage-remove.mts   (스테이징, 실제 파일은 건드리지 않음)
// @ts-expect-error mjs 헬퍼
import { raw } from './_e2e-helpers.mjs'

const BUCKET = 'fire-plans'
// 후보는 두 조건을 동시에 만족해야 한다:
//  ① Storage remove()가 error를 낼 것  ② 그 문자열을 DB에 insert할 때 Cloudflare WAF에 걸리지 않을 것
//  (`../../etc/passwd`는 ①은 되지만 ②에서 차단된다 — 전형적인 LFI 시그니처)
const cases: Array<{ name: string; paths: string[] }> = [
  { name: '없는 키(정상 형식)', paths: ['00000000-0000-0000-0000-000000000000/2020/nope.pdf'] },
  { name: '빈 문자열 키', paths: [''] },
  { name: '아주 긴 키(2000자)', paths: ['a'.repeat(2000) + '.pdf'] },
  { name: '개행 포함 키', paths: ['bad\nkey.pdf'] },
  { name: '중간 상위참조 a/../b', paths: ['seed/../keep.pdf'] },
  { name: '점두개 단독', paths: ['..'] },
  { name: '앞 슬래시', paths: ['/leading.pdf'] },
  { name: '끝 슬래시(폴더형)', paths: ['some/dir/'] },
  { name: '점 하나 세그먼트', paths: ['seed/./keep.pdf'] },
  { name: '빈 배열', paths: [] },
]

for (const c of cases) {
  const { data, error } = await raw.storage.from(BUCKET).remove(c.paths)
  console.log(`${error ? '❌ error' : '✅ ok   '} | ${c.name.padEnd(20)} | ` +
    (error ? `${error.name}: ${error.message}` : `data.length=${(data ?? []).length}`))
}
