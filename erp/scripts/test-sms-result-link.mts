/** 발송 결과 확인 동선 — 소방계획서_24 S8-10. 정적 배선 검사(무서버·무DB).
 *
 *  주 발송 경로는 달력인데 결과 창구는 문자 발송 화면이다(Q-14·Q-15). 그 사이를 잇는 링크
 *  하나가 끊기면 **실패를 못 보고 닫는다** — 이 설계에서 가장 비싼 실수로 규정된 것이다(G-26).
 *
 *  링크 자체는 예전부터 있었다. 문제는 **약속한 화면에 도착하지 못했다**는 것이고, 실패 방향이
 *  셋 다 조용하다(오류도 빈 화면도 아니고 '그냥 아무것도 없는 목록'으로 보인다):
 *
 *    ① 상태 — 도착 화면의 기본 필터가 `not_sent`(발송 제외)다. 방금 보낸 건은 status 파생이
 *       'sent'라 **정확히 그 필터에 걸려 사라진다**. 실패 건은 'failed'라 남으므로,
 *       테스트하는 사람이 실패 케이스만 보면 멀쩡해 보인다.
 *    ② 기간 — 비어 있으면 서버가 오늘~+30일로 해석한다. 방문일이 그 밖이면 안 보인다.
 *    ③ 이동 방식 — 이 모달은 **문자 발송 화면 자체에서도 열린다**(sms-status-client가 setModal).
 *       거기서 누르면 `/inspections/sms` → `/inspections/sms?…`가 되는데 **같은 경로로 가는
 *       `<Link>`는 서버를 재렌더하지 않아** searchParams가 다시 읽히지 않는다. 달력에서는
 *       되고 결과 창구에서는 안 되는, 경로에 따라 갈리는 버그가 된다.
 *
 *  정적 검사인 것을 정직하게 적어 둔다: 이 파일은 **배선이 있는가**만 본다. 실제로 그 필터가
 *  걸린 목록이 옳은지는 서버 액션의 몫이고, 여기서 E2E로 확인하려면 실제 발송이 필요하다 —
 *  문자는 돈이 나가고 되돌릴 수 없어 회귀 스위트에서 할 일이 아니다.
 *
 *  실행: npx tsx scripts/test-sms-result-link.mts */
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8')
const modal = read('components', 'sms', 'inspection-sms-modal.tsx')
const page = read('app', '(dashboard)', 'inspections', 'sms', 'page.tsx')
const client = read('components', 'sms', 'sms-status-client.tsx')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? `\n     ${d}` : ''}`) }
}

// 링크 요소 블록을 잘라낸다 — 파일 전체에서 문자열을 찾으면 다른 링크의 속성에 속는다
const at = modal.indexOf('data-testid="sms-result-link"')
check('결과 링크가 존재한다(data-testid="sms-result-link")', at >= 0)
if (at >= 0) {
  // ⚠ `lastIndexOf('<', at)`로 잡으면 안 된다 — href 식 안의 `a < b` **비교 연산자**를 태그로
  //   오인해 블록이 잘리고, 멀쩡한 제품을 빨갛다고 말한다(실제로 처음에 그랬다).
  //   여는 태그 이름을 명시해 찾는다.
  const before = modal.slice(0, at)
  const opens = [...before.matchAll(/<(a|Link)\b/g)]
  const open = opens.length ? opens[opens.length - 1].index! : -1
  const closeA = modal.indexOf('</a>', at), closeL = modal.indexOf('</Link>', at)
  const end = closeA >= 0 && (closeL < 0 || closeA < closeL) ? closeA : closeL
  const block = open >= 0 && end > open ? modal.slice(open, end) : ''
  check('링크 블록을 잘라냈다(검사 자체가 성립)', block.length > 0,
    `open=${open} end=${end} — 못 자르면 아래 판정이 전부 공허해진다`)

  // ③ 이동 방식 — 같은 경로 Link는 서버를 안 깨운다
  check('③ 전체 이동(<a>)이다 — <Link>면 문자 발송 화면에서 누를 때 필터가 무시된다',
    /^<a\b/.test(block.trim()),
    `실제 시작 태그: ${block.trim().slice(0, 40)}`)

  // ② 기간 — 방금 보낸 방문일 범위를 싣는다
  check('② 방문일 범위(from·to)를 싣는다', /\bfrom:/.test(block) && /\bto:/.test(block),
    '기간이 없으면 서버가 오늘~+30일로 해석해, 그 밖의 방문일은 안 보인다')

  // ① 상태 — 도착 화면의 기본 필터가 결과를 숨기지 않게
  check('① 상태(status)를 싣는다', /\bstatus:/.test(block))
  check('① 성공·실패 모두 결과가 보이는 상태로 간다(sent/failed)',
    /'sent'/.test(block) && /'failed'/.test(block),
    '기본값 not_sent로 가면 방금 보낸 건이 그 필터에 걸려 사라진다')
  check('① not_sent로 보내지 않는다(자기가 만든 결과를 자기가 가린다)',
    !/not_sent/.test(block))
}

// 받는 쪽 — 실어 보내도 안 받으면 아무 일도 안 일어난다(양쪽을 함께 본다)
check('page가 searchParams를 받는다', /searchParams\??\s*:\s*Promise</.test(page))
check('page가 세 값을 클라이언트로 넘긴다',
  /initialFrom=/.test(page) && /initialTo=/.test(page) && /initialStatus=/.test(page))
check('page가 status를 화이트리스트로 거른다(URL은 사용자가 손댈 수 있다)',
  /STATUSES\s*\.\s*includes/.test(page) || /STATUSES\.includes/.test(page))
check('page가 날짜 형식을 검증한다', /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(page))

check('client가 initialFrom/To를 초기 상태로 쓴다',
  /useState\(initialFrom\s*\?\?/.test(client) && /useState\(initialTo\s*\?\?/.test(client))
check('client가 initialStatus를 초기 상태로 쓴다', /useState<[^>]*>\(initialStatus\s*\?\?/.test(client))
check('기본값은 그대로 not_sent다(링크 없이 들어오면 종전 동작)',
  /initialStatus\s*\?\?\s*'not_sent'/.test(client))

console.log(`\n합계 ${pass}/${pass + fail} · 실패 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
