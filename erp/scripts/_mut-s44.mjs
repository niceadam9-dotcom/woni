/* S4-4 판별자 생존 검증(일회성) — 제품 소스는 건드리지 않는다.
 *
 * 2026-08-29 판정이 남긴 것: "종전 9/9는 커버리지 구멍 위의 초록이었다 — form=annex를
 * form=1.1로 변조해도 프로브가 초록을 유지했다." 그 뒤 34가 목적지를 ?tab=annex로 바꾸고
 * 프로브가 세 동선 모두 href를 단언하도록 이식됐다. 남은 질문은 하나다:
 * **그 단언이 실제로 비교하는가, 아니면 늘 참인가.**
 *
 * 공유 작업트리에서 제품 파일을 잠깐이라도 변조하면 타 세션 커밋에 섞일 수 있다(오늘 그 사고를
 * 냈다). 그래서 **기대값 쪽을 변조한 프로브 사본**을 만들어 빨개지는지 본다 — 제품 민감도까지는
 * 증명하지 못하지만, 단언이 살아 있다(공허하지 않다)는 것은 결정적으로 가른다.
 *
 * 실행: node scripts/_mut-s44.mjs   (dev 서버 필요)
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\//, '')
const src = path.join(dir, '_probe-plan-access-paths.mts')
const dst = path.join(dir, '_mut-s44-probe.mts')

const body = fs.readFileSync(src, 'utf8')
const MARK = '?tab=annex'
const hits = body.split(MARK).length - 1
console.log(`기대 문자열 "${MARK}" 출현 ${hits}곳`)
if (hits === 0) { console.log('🚨 기대 문자열을 못 찾았다 — 프로브 구조가 바뀌었다'); process.exit(1) }

// 기대값만 뒤튼다(제품이 아니라 검사 쪽). 살아 있는 단언이면 세 동선이 전부 빨개져야 한다.
fs.writeFileSync(dst, body.split(MARK).join('?tab=zzzmutant'), 'utf8')
console.log(`변이본 작성: ${path.basename(dst)}`)

let out = ''
try {
  out = execSync(`npx tsx scripts/${path.basename(dst)}`, { cwd: path.join(dir, '..'), encoding: 'utf8' })
  console.log('rc=0 (변이본이 통과했다)')
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '')
  console.log('rc!=0 (변이본이 실패했다 — 기대한 결과)')
} finally {
  fs.unlinkSync(dst)
  console.log('변이본 삭제 완료')
}

const fails = (out.match(/❌/g) ?? []).length
const tail = out.split(String.fromCharCode(10)).filter(l => l.includes('결과')).pop() ?? ''
console.log(`\n변이본 실패 단언 ${fails}건 · ${tail.trim()}`)
console.log(fails >= 3
  ? '\n판정: ✅ 판별자 생존 — 목적지 단언이 세 동선에서 실제로 비교한다. 2026-08-29의 "구멍 위의 초록"은 재현되지 않는다.'
  : `\n판정: ⚠ 실패가 ${fails}건뿐이다 — 세 동선 중 일부는 여전히 목적지를 안 보고 있을 수 있다. 어느 축이 초록으로 남았는지 확인할 것.`)
