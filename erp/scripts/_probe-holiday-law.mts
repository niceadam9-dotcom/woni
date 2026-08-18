/** 「관공서의 공휴일에 관한 규정」 제2·3조 원문 조회 (소방계획서_25 S-9) — 읽기 전용.
 *  실행: npx tsx scripts/_probe-holiday-law.mts
 *
 *  왜: `holiday-rules.ts`의 대체공휴일 상수 3종은 법령을 코드로 옮긴 것이다. 법이 개정되면
 *  코드가 조용히 틀려지므로(노동절 신설이 그 사례), 근거를 언제든 다시 뽑아 대조할 수 있게 둔다.
 *  법제처 OPEN API는 공용 샘플 계정(OC=test)으로도 조회되어 IP 등록이 필요 없다.
 */
import { config } from 'dotenv'
config({ path: '.env.local', quiet: true })

const QUERY = '관공서의 공휴일에 관한 규정'

const get = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url.split('?')[0]}`)
  return r.text()
}

const searchUrl = (oc: string) =>
  `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=XML&query=${encodeURIComponent(QUERY)}`

// 1) 법령일련번호(MST) 찾기 — 주 계정(LAW_OC)은 VPS IP로 등록돼 있어 개발 PC에서는 실패한다.
//    크론(law-revision-check)과 같은 방식으로 공용 샘플(test)로 폴백한다.
let OC = process.env.LAW_OC || 'test'
let searchXml = await get(searchUrl(OC))
if (searchXml.includes('사용자 정보 검증에 실패') || !/<법령일련번호>/.test(searchXml)) {
  if (OC !== 'test') {
    console.log(`  ℹ 주 계정(${OC}) 검증 실패 — 공용 샘플(test)로 폴백 (IP 등록은 VPS 기준)`)
    OC = 'test'
    searchXml = await get(searchUrl(OC))
  }
}
const mst = /<법령일련번호>(\d+)<\/법령일련번호>/.exec(searchXml)?.[1]
const title = /<법령명한글>\s*(?:<!\[CDATA\[)?([^\]<]+)/.exec(searchXml)?.[1]?.trim()
const promulgated = /<공포일자>(\d+)<\/공포일자>/.exec(searchXml)?.[1]
console.log(`OC=${OC} · ${title ?? '(제목 미상)'} · 공포일자 ${promulgated ?? '?'} · MST=${mst ?? '없음'}`)
if (!mst) { console.error('법령일련번호를 찾지 못했습니다.'); process.exit(1) }

// 2) 본문에서 제2조·제3조만 추출
const bodyXml = await get(
  `https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(OC)}&target=law&type=XML&MST=${mst}`)

const strip = (s: string) => s
  .replace(/<!\[CDATA\[|\]\]>/g, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .split('\n').map(l => l.trim()).filter(Boolean).join('\n')

for (const article of ['제2조', '제3조']) {
  const re = new RegExp(`<조문번호>${article.replace('제', '').replace('조', '')}</조문번호>[\\s\\S]*?</조문단위>`)
  const block = re.exec(bodyXml)?.[0]
  console.log(`\n${'='.repeat(60)}\n${article}\n${'='.repeat(60)}`)
  console.log(block ? strip(block) : '(추출 실패 — XML 구조가 바뀌었을 수 있습니다)')
}

// 3) 코드 상수를 나란히 출력 — 사람이 눈으로 대조한다
console.log(`\n${'='.repeat(60)}\nholiday-rules.ts 상수 (대조용)\n${'='.repeat(60)}`)
const src = await import('fs').then(fs => fs.readFileSync('src/lib/holiday-rules.ts', 'utf8'))
for (const line of src.split('\n')) {
  if (/^const SUB_ON_|^const NAME_PERIODS|^\s*'제헌절'|^\s*'노동절'/.test(line)) console.log('  ' + line.trim())
}
