// 소방계획서_18 S4-1 — 병합 프로브: mergePdfs가 실제로 여러 PDF를 한 문서로 합치는가.
// 실행: npx tsx --conditions=react-server scripts/_probe-merge-pdf.mts
//   (GOTENBERG_URL 필요 · pdf.ts가 server-only 모듈이라 react-server 조건 필수 — 저장소 관례)
// 페이지 수는 병합본의 /Type /Page 개수로 센다(원본 페이지 수 합과 일치해야 한다).
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local', override: true })

const { convertHtmlToPdf, mergePdfs, gotenbergHealthy } = await import('../src/lib/pdf.ts')

let pass = 0, fail = 0
const skipped: string[] = []
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 병합본의 페이지 수.
 *  주의: `/Type /Page`를 원문에서 세는 방식은 신뢰할 수 없다 — PDF 1.5+는 객체를 압축 스트림에
 *  넣기 때문에 문자열이 아예 안 보이거나(누락), 스트림 본문에 우연히 등장할 수 있다(과다).
 *  그래서 세지 못하면 0이 아니라 null을 돌려주고, 호출부가 '판정 불가'로 다루게 한다. */
function pageCount(pdf: Uint8Array): number | null {
  const s = Buffer.from(pdf).toString('latin1')
  const byType = (s.match(/\/Type\s*\/Page(?![s])/g) ?? []).length
  // 페이지 트리 루트의 /Count 와 교차 검증 — 둘이 일치할 때만 신뢰한다
  const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map(m => Number(m[1]))
  const byCount = counts.length > 0 ? Math.max(...counts) : 0
  if (byType > 0 && byType === byCount) return byType
  return null
}

const page = (title: string, n: number) =>
  `<html><body>${Array.from({ length: n }, (_, i) =>
    `<div style="page-break-after:always">${title} ${i + 1}쪽</div>`).join('')}</body></html>`

if (!await gotenbergHealthy()) {
  console.log('⏭  Gotenberg 미가동 — 프로브 건너뜀 (GOTENBERG_URL 확인)')
  process.exit(0)
}

// 2쪽짜리 + 1쪽짜리 → 3쪽
const a = await convertHtmlToPdf(page('별지9호', 2))
const b = await convertHtmlToPdf(page('별지4호', 1))
const pa = pageCount(a), pb = pageCount(b)
const merged = await mergePdfs([a, b])
const pm = pageCount(merged)

check('병합 — 산출물이 PDF', Buffer.from(merged.slice(0, 5)).toString() === '%PDF-')
check('병합 — 크기가 단일 원본보다 큼', merged.length > Math.max(a.length, b.length))

// 페이지 수는 셀 수 있을 때만 판정한다 — 못 세면 통과가 아니라 '미판정'으로 남긴다
if (pa === null || pb === null || pm === null) {
  skipped.push(`페이지 수 판정 불가(PDF 객체 압축) — a=${pa} b=${pb} merged=${pm}`)
} else {
  check('원본 PDF 생성 — 2쪽 / 1쪽', pa === 2 && pb === 1, `a=${pa} b=${pb}`)
  check('병합 — 페이지 수 = 합(3쪽)', pm === pa + pb, `merged=${pm}`)
}

// 순서 제어 — 파일명 0패딩 인덱스로 앞 문서가 먼저 와야 한다.
// 텍스트가 압축돼 안 보이면 '통과'가 아니라 미판정으로 뺀다(허수 단언 방지)
const text = Buffer.from(merged).toString('latin1')
const i9 = text.indexOf('별지9호'), i4 = text.indexOf('별지4호')
if (i9 < 0 || i4 < 0) skipped.push('병합 순서 판정 불가 — 본문 텍스트가 압축돼 검색되지 않음')
else check('병합 — 인자 순서대로 배치(9호 → 4호)', i9 < i4, `i9=${i9} i4=${i4}`)

// 단일 입력은 그대로 통과(불필요한 왕복 없음)
const single = await mergePdfs([a])
check('병합 — 단일 입력은 원본 그대로', single === a)

let threw = ''
try { await mergePdfs([]) } catch (e) { threw = (e as Error).message }
check('병합 — 빈 입력은 명시적 에러', threw.includes('병합할 PDF가 없습니다'), threw)

for (const s of skipped) console.log(`  ⏭  미판정: ${s}`)
console.log(`\n${fail === 0 ? '✅' : '❌'} 병합 프로브 ${pass}/${pass + fail}${skipped.length ? ` (미판정 ${skipped.length})` : ''}`)
process.exit(fail === 0 ? 0 : 1)
