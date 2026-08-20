/**
 * A9-12 — 별지 9호 9쪽 «작성방법»이 현행판 hwpx 원문과 일치하는지 (소방계획서_15 재판정 2026-08-20)
 *
 * 왜 필요한가: 종전 템플릿은 출처가 erp_goal/_doc01/…0009.htm(파생 요약본)이었고 그게 구판이라
 * 항목 4가 통째로 다른 문장이었으며 ※ 1줄·항목 11·12가 빠져 있었다. 이 프로브는 템플릿을
 * **원문(hwpx)에서 뽑은 문장**과 직접 대조해, 누가 다시 파생본 기준으로 되돌리면 실패한다.
 *
 * 실행: npx tsx scripts/_probe-a9-12-page9.mts       (DB·네트워크·환경변수 불필요)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'

const HWPX = resolve(process.cwd(), '../erp_goal/_form/별지9호-placeholder.hwpx')
const TPL = resolve(process.cwd(), 'src/lib/doc-templates/report9.ts')

/** 원문·템플릿을 같은 축으로 — 굽은 따옴표·전각 공백·연속 공백 차이는 대조 대상이 아니다 */
function norm(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readOriginal(): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(HWPX))
  const entry = zip.file('Contents/section0.xml')
  if (!entry) throw new Error('Contents/section0.xml 없음 — hwpx 구조 변경?')
  const xml = await entry.async('string')
  const runs = [...xml.matchAll(/<hp:t>(.*?)<\/hp:t>/gs)].map(m =>
    m[1].replace(/<hp:lineBreak\/>/g, ' ').replace(/<[^>]+>/g, ''),
  )
  return norm(runs.join(' '))
}

function readTemplate(): string {
  const src = readFileSync(TPL, 'utf8')
  const start = src.indexOf('function page9()')
  if (start < 0) throw new Error('page9() 없음')
  const end = src.indexOf('\n}', start)
  return norm(src.slice(start, end))
}

/** 원문에서 anchor로 시작해 tail로 끝나는 한 문장을 잘라낸다 — 하드코딩이 아니라 원문 인용 */
function sentence(orig: string, anchor: string, tail: string): string {
  const i = orig.indexOf(anchor)
  if (i < 0) throw new Error(`원문에서 못 찾음: ${anchor}`)
  const j = orig.indexOf(tail, i)
  if (j < 0) throw new Error(`원문에서 끝을 못 찾음: ${anchor} … ${tail}`)
  return orig.slice(i, j + tail.length)
}

const results: Array<{ ok: boolean; name: string; detail?: string }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ ok, name, detail: ok ? undefined : detail })
}

const origFull = await readOriginal()
const tpl = readTemplate()

// ⚠ 문장 대조는 반드시 '작성방법' 절 안에서 — 앞쪽 본문에도 비슷한 문장이 있다.
//   예: '[ ]에는 해당 시설에 √ 표를 하고'는 1면 유의사항(점검 결과란 ○×/ 안내)에도 나와서,
//   전체 문서를 대상으로 찾으면 엉뚱한 문장을 원문으로 삼는다(프로브 최초판이 실제로 그랬다).
const secIdx = origFull.indexOf('작성방법 ※')
if (secIdx < 0) throw new Error("원문에서 '작성방법' 절을 못 찾음")
const orig = origFull.slice(secIdx)

// ── 1) ※ 5줄이 전부 원문 그대로 들어 있는가 (종전 4줄 — '불가피한 사유'가 빠져 있었다)
const notes: Array<[string, string, string]> = [
  ['※ 전산입력', '이 서식은 전산입력되는', '바랍니다.'],
  ['※ 하나의 대상물', '하나의 소방안전관리대상물에 대한', '보고합니다.'],
  ['※ [ ] √ 표', ']에는 해당 시설에', '기입합니다.'],
  ['※ 세부 현황 작성', '"3. 소방시설등의 세부 현황"의 작성에 있어', '변경하지 않습니다.)'],
  ['※ 불가피한 사유(신규)', '불가피한 사유로 점검을 수행하지 못한', '작성합니다.'],
]
for (const [name, anchor, tail] of notes) {
  const s = sentence(orig, anchor, tail)
  check(name, tpl.includes(s), tpl.includes(s) ? undefined : `원문: ${s.slice(0, 60)}…`)
}

// ── 2) 항목 4 — 구판 문장이 사라지고 현행판 문장이 들어왔는가 (이 결함의 핵심)
const item4 = sentence(orig, '4. 점검인력은 주된 점검인력과', '함께 기입해야 합니다.')
check('항목 4 = 현행판 문장', tpl.includes(item4), tpl.includes(item4) ? undefined : `원문: ${item4.slice(0, 70)}…`)
check(
  '항목 4 구판 문장 제거',
  !tpl.includes('관계인 점검의 경우 주된 기술인력란에'),
  '구판(_doc01 파생본) 문장이 아직 남아 있다',
)

// ── 3) 항목 11·12 — 종전엔 통째로 없었다
const item11 = sentence(orig, '11. "소방시설등의 세부 현황"의 작성방법은', '방법에 따릅니다.')
check('항목 11 신규', tpl.includes(item11), tpl.includes(item11) ? undefined : `원문: ${item11}`)
check('항목 12 신규', tpl.includes('12. "소방시설등 불량 세부 사항"은 점검번호 순에 따라 설비별로 작성하되'))

// ── 4) 10쪽 예시표는 미출력(사용자 확정) — 그래서 예시를 가리키는 '다음과 같이'는 빼기로 했다.
//     원문에는 있고 우리 템플릿에는 없어야 정상이다(의도된 이탈).
check('원문 항목 10에 "다음과 같이"가 실제로 있다', orig.includes('건축물정보를 다음과 같이 작성합니다'))
check('템플릿은 예시 참조 말미를 쓰지 않는다', !tpl.includes('다음과 같이'))
check('작성방법 절 한정 대조가 살아있다(1면 유의사항과 혼동 방지)', !orig.includes('점검 결과란은 양호'))
check('항목 10 자립 문구', tpl.includes('동별 다중이용업소 입점현황과 건축물정보를 동별로 나누어 작성합니다'))

// ── 5) 세대 수 각주 — 원문 예시표 아래 * 주석. 예시표를 안 쓰므로 항목 10에 괄호로 흡수했다
check('세대 수 각주 보존', tpl.includes('"세대 수"는 공동주택의 경우에만 연면적과 함께 작성합니다'))

// ── 6) 쪽 표기 — 안내면은 '8쪽 중 제N쪽'이 아니라 '(9쪽)'이다
check('쪽 표기 (9쪽)', tpl.includes("pageHeader(null, '(9쪽)')"))
// '(9쪽)'은 '작성방법' 머리말 **앞**에 찍혀 있어 절 슬라이스에 안 들어온다 — 전체 문서로 본다
check('원문 쪽 표기 대조', origFull.includes('(9쪽)') && origFull.includes('(10쪽)'))

// ── 7) 출처 주석이 파생본을 가리키지 않는가 (재발 방지)
const head = readFileSync(TPL, 'utf8')
const headBlock = head.slice(Math.max(0, head.indexOf('9쪽 — 작성방법') - 200), head.indexOf('function page9()'))
check('출처 주석 = hwpx 원문', headBlock.includes('별지9호-placeholder.hwpx'))

const pass = results.filter(r => r.ok).length
for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
console.log(`\n${pass}/${results.length} pass`)
if (pass !== results.length) process.exit(1)
