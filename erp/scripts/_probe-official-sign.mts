/** 공문 하단 발신 명의 블록 (147) — 순수 렌더 검증. DB·서버 불필요.
 *  실행: npx tsx scripts/_probe-official-sign.mts
 *
 *  사내 서식(갑지 공문) 재현:
 *      주식회사 승진소방ENG
 *      대표이사 김흥준(직인생략)
 *  회사정보 [공문 발신 명의]에서 오고, 비우면 상호=회사명 / 직함='대표이사'로 폴백한다.
 */
import { renderOfficial, type OfficialData } from '../src/lib/doc-templates/official'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : `\n     ${detail}`}`)
}

const base: OfficialData = {
  company: { name: '승진소방ENG', address: '경기 양평군 양평읍 잿말길10번길 50-1', phone: '031-772-3019', fax: '' },
  docNo: '승 진 2608-1',
  sendDate: '2026년 8월',
  recipient: '서림사',
  reference: '소방안전관리자 및 관계인',
  sender: '승진소방ENG',
  senderSign: { name: '주식회사 승진소방ENG', title: '대표이사', rep: '김흥준' },
  year: 2026,
  typeLabel: '작동점검',
}
/** 태그를 걷어낸 본문 (문자열 대조용) */
const text = (html: string) => html.replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ')
  .split('\n').map(s => s.trim()).filter(Boolean)

// ── ① 지정한 명의가 두 줄로 찍힌다 ──
{
  const t = text(renderOfficial(base))
  check('① 상호 줄', t.includes('주식회사 승진소방ENG'), t.slice(-6).join(' | '))
  check('① 직함·대표자·(직인생략) 줄', t.some(s => s === '대표이사 김흥준(직인생략)'), t.slice(-6).join(' | '))
  const i1 = t.indexOf('주식회사 승진소방ENG')
  const iEnd = t.findIndex(s => s === '끝.')
  check('① 명의는 "끝." 아래에 온다', iEnd >= 0 && i1 > iEnd, `끝.=${iEnd} 명의=${i1}`)
  check('① 레터헤드 상호는 그대로 회사명', t.filter(s => s === '승진소방ENG').length >= 1, t.slice(0, 4).join(' | '))
}

// ── ② 폴백: 상호를 비우면 회사명, 직함을 비우면 대표이사 ──
{
  // assembleOfficial의 폴백을 그대로 재현한 입력(빈 값이 아니라 폴백된 값이 온다)
  const t = text(renderOfficial({ ...base, senderSign: { name: '승진소방ENG', title: '대표이사', rep: '김흥준' } }))
  check('② 상호 폴백 = 회사명', t.some(s => s === '승진소방ENG'), '')
  check('② 직함 폴백 = 대표이사', t.some(s => s === '대표이사 김흥준(직인생략)'), '')
}

// ── ③ 대표자가 없으면 상호 한 줄만 (반쪽 명의를 찍지 않는다) ──
{
  const t = text(renderOfficial({ ...base, senderSign: { name: '주식회사 승진소방ENG', title: '대표이사', rep: '' } }))
  check('③ 대표자 없음 → 상호 줄은 있다', t.includes('주식회사 승진소방ENG'), '')
  check('③ 대표자 없음 → "(직인생략)"만 뜬 줄은 없다', !t.some(s => s.includes('(직인생략)')), t.slice(-4).join(' | '))
}

// ── ④ 상호가 아예 없으면 블록 자체를 만들지 않는다 ──
{
  const html = renderOfficial({ ...base, senderSign: { name: '', title: '대표이사', rep: '김흥준' } })
  // ⚠ 'of-sign' 문자열만 보면 안 된다 — CSS에 `.of-sign { … }`이 항상 들어 있어 늘 참이 된다(프로브 오탐)
  check('④ 상호 없음 → 명의 블록 없음', !html.includes('class="of-sign"'), '')
  check('④ 그래도 공문 본문은 정상', text(html).some(s => s === '끝.'), '')
}

// ── ⑤ HTML 이스케이프 (상호에 <, & 가 들어와도 서식이 깨지지 않는다) ──
{
  const html = renderOfficial({ ...base, senderSign: { name: '<b>주식&회사</b>', title: '대표', rep: '홍<길>동' } })
  check('⑤ 상호 이스케이프', html.includes('&lt;b&gt;') && html.includes('주식&amp;회사'), '')
  check('⑤ 대표자 이스케이프', html.includes('홍&lt;길&gt;동'), '')
}

console.log(`\n${fail === 0 ? '✅ 전건 통과' : '❌ 실패 있음'} — ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
