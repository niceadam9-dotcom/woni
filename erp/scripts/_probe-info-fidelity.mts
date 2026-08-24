/** 정보 시트 12칸 — **텍스트 충실도**(뷰어가 실제로 그리는 글자) 검증.
 *
 *  '열리는가'(_probe-xlsx-opens: 쪽수)와 '텍스트가 사는가'는 다른 검사다 — 2026-08-23 판정에서
 *  줄바꿈 67칸이 리터럴 `&#10;`로 인쇄되는데도 LO는 72쪽으로 멀쩡히 열렸다. 그래서 여기서는
 *  LibreOffice에게 **HTML로 다시 뽑게** 해서(=LO가 해석한 글자) 원문·주입값을 대조한다.
 *  soffice 프로필은 격리한다(다른 세션과 겹치면 ETIMEDOUT — risk_soffice_profile_lock). */
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { buildWorkbookValues, toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import type { OfficialData } from '../src/lib/doc-templates/official.ts'
import type { DelegationData } from '../src/lib/doc-templates/delegation.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const dir = mkdtempSync(join(tmpdir(), 'wbfid-'))
const profile = `file:///${join(dir, 'loprofile').replace(/\\/g, '/')}`
const out: string[] = []
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  out.push(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++
}

const official: OfficialData = {
  company: { name: '㈜테스트소방', address: '주소', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-7', sendDate: '2026년 8월', recipient: '충실도대상빌딩', reference: '관계인',
  sender: '㈜테스트소방', senderSign: { name: '주식회사 테스트소방', title: '대표이사', rep: '홍대표' },
  year: 2026, typeLabel: '작동점검',
}
const delegation: DelegationData = {
  typeLabel: '작동점검',
  owner: { name: '박관계', position: '소방안전관리자', phone: '010-1111-2222', birth: '1980.01.02' },
  agent: { name: '김점검', position: '과장', phone: '010-3333-4444', birth: '1990.03.04' },
  periodLabel: '2026.08.20 부터 ~ 2026.08.21 까지', daysLabel: '2일', submitDate: '2026년 8월 21일', station: '양평',
}
const values = buildWorkbookValues({
  official, delegation, customerAddress: '경기도 양평군 검증로 1',
  startISO: '2026-08-20', endISO: '2026-08-21', useApprovalISO: '2011-06-25',
  building: {
    purpose: '근린생활시설', totalArea: 999.99, buildingArea: 300.5, floorsAbove: 5, floorsBelow: 2,
    height: 21.5, households: 12, buildingCount: 2, permitDateISO: '2009-04-25',
  },
  report9: {
    ckOp: true, ckInitial: false, ckCompEtc: false, consent: true, repRole: '점유자',
    managerGrade: '2급', mgrEduDate: '2024년 5월 2일', rampCount: '4',
    main: { name: '김주된', grade: '소방시설관리사', licenseNo: '제2026-1호' }, assistants: [],
    mgrAppointType: '겸직',
    hasFirePlan: false, firePlanNone: true, firePlanStored: false,
    prevOpDone: false, prevOpNone: true, prevCompDone: true,
    eduDone: false, eduNone: true, drillDone: true,
    insuranceJoined: false, insCompany: 'DB손해보험', insPeriod: '2027년 5월 1일 ~ 2028년 4월 30일',
    insPerson: '3000', insProperty: '30000',
    multiUseNone: false, multiUseCounts: { '노래연습장업': '5', '인터넷컴퓨터게임시설제공업': '9' },
    stCon: false, stSteel: false, stBrick: true, stWood: false, stEtc: false,
    rfSlab: false, rfTile: true, rfSlate: false, rfEtc: false,
    stairsCount: '8', specialStairCount: '',
    elvR: '', elvE: '3', elvV: '',
    pkIn: false, pkMech: false, pkRoof: true, pkOut: false,
  },
})
const r = await injectWorkbook(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')),
  toInjectTargets(values).targets, { forbidden: SCRUB_NEEDLES })
check('주입 대상 미발견 0', r.missed.length === 0, r.missed.join(', '))

const xlsxPath = join(dir, 'fid.xlsx')
writeFileSync(xlsxPath, r.bytes)
// LO에게 HTML로 재출력시킨다 = LO가 해석한 글자. 부트스트랩 실패가 있어 재시도(§5 함정)
let html = ''
for (let i = 0; i < 3 && !html; i++) {
  try {
    execFileSync(SOFFICE, [`-env:UserInstallation=${profile}`, '--headless', '--norestore',
      '--convert-to', 'html', '--outdir', dir, xlsxPath], { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
  } catch { /* 재시도 */ }
  // ⚠ LibreOffice가 산출물을 `.html`로 rename하지 못하고 **`lu*.tmp`로 남기는** 경우가 있다.
  //    `.endsWith('.html')`만 찾으면 조용히 빈 문자열을 얻고, 그러면 아래 `!text.includes(...)`
  //    **금지 단언이 전부 가짜 초록**이 된다(2026-08-24 독립 판정이 이 함정에 걸려 오보를 냈다).
  //    확장자가 아니라 **내용**으로 고른다 — 서식 텍스트가 든 가장 큰 파일.
  const cands = readdirSync(dir)
    .filter(n => /\.(html?|tmp)$/i.test(n) || n.startsWith('lu'))
    .map(n => join(dir, n)).filter(existsSync)
    .map(p => ({ p, s: readFileSync(p, 'utf8') }))
    .filter(x => x.s.includes('<table') || x.s.includes('<TABLE'))
    .sort((a, b) => b.s.length - a.s.length)
  if (cands.length) html = cands[0].s
}
check('LibreOffice HTML 재출력 성공', html.length > 0, `${Math.round(html.length / 1024)}KB`)
// 표본 서식의 고정 문구가 보이는가 — **빈 문자열로 금지 단언이 통과하는 것**을 막는 하한선.
// 이 단언이 없으면 변환 실패가 '표본 잔재 0건'이라는 가짜 초록으로 보고된다
check('추출 텍스트가 실제 서식 내용을 담고 있다(빈 문자열 방어)',
  html.includes('특정소방대상물') && html.length > 100_000, `${Math.round(html.length / 1024)}KB`)

// HTML 엔티티 해제 + 태그 제거 → LO가 그린 글자만 남긴다
const text = html
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')

// ① 주입값이 실제로 그려진다
const must: Array<[string, string]> = [
  ['선임구분 겸직 √', '[√]겸직'],
  ['소방계획서 미작성 √', '[√]미작성'],
  ['전년도 작동 미실시 √', '[√]미실시'],
  ['보험사', 'DB손해보험'],
  ['가입기간', '2027년 5월 1일 ~ 2028년 4월 30일'],
  ['가입금액 대인(만원 단위)', '3000'],
  ['가입금액 대물(만원 단위)', '30000'],
  ['다중이용업 개소', '[√]노래연습장업( 5 개소)'],
  ['다중이용업 2줄 업종', '제공업( 9 개소)'],
  ['구조 조적조 √', '[√]조적조'],
  ['지붕 기와 √', '[√]기와'],
  ['계단 8개소', '( 8 개소 )'],
  ['승강기 비상용 3대', '[√]비상용( 3 대)'],
  ['주차장 옥상 √', '[√]옥상'],
]
for (const [name, needle] of must) check(`그려짐: ${name}`, text.includes(needle), needle)

// ② 표본 답이 하나도 남지 않는다 — '남의 답이 인쇄되는' 결함의 직접 반증
const forbid: Array<[string, string]> = [
  ['표본 선임구분', '[√]소방안전관리자수첩'],
  ['표본 소방계획서 작성 √', '[√]작성'],
  ['표본 보험 가입 √ 기간', '2024년  1월  1일'],
  ['표본 해당없음 √', '[√]해당없음'],
  ['표본 철근콘크리트 √', '[√]철근콘크리트구조'],
  ['표본 계단 1개소', '( 1 개소 )'],
  ['표본 주차장 옥외 √', '[√]옥외'],
]
for (const [name, needle] of forbid) check(`잔존 없음: ${name}`, !text.includes(needle), needle)

// ③ 리터럴 이스케이프가 글자로 새지 않는다(67칸 결함의 축)
// 가입금액 단위 — `천만원` 자체를 금하면 안 된다: 유의사항의 벌금 조항('1천만원 이하의 벌금')이
// 정본이다. 금할 것은 **가입금액 칸의 단위로 쓰인 천만원**이므로 문맥으로 좁힌다
{
  const hits = [...text.matchAll(/천만원/g)].map(m => text.slice(Math.max(0, m.index! - 24), m.index! + 6).replace(/\s+/g, ' '))
  const asUnit = hits.filter(h => !/벌금|이하의|과태료/.test(h))
  check(`가입금액 단위로 쓰인 천만원 0건(전체 ${hits.length}건은 벌금 조항)`, asUnit.length === 0, asUnit.join(' | '))
  // ⚠ 종전엔 `/가입금액[\s\S]{0,60}만원/`을 단언했는데 **주입 전 원문이 이미 만족**해 판별력이
  //    0이었다(2026-08-24 독립 판정). 주입한 **값**이 그 칸에 실제로 들어갔는지를 봐야 한다
  check('가입금액 칸에 주입값이 들어갔다(3000·30000)', /가입금액[\s\S]{0,80}3000[\s\S]{0,80}30000/.test(text))
}
check('리터럴 &#10; 0건', !text.includes('&#10;'))
// ⚠ 종전 `리터럴 &amp; 0건`은 사문이었다 — 정규화(:86)가 `&amp;`를 `&`로 되돌려 1중 이스케이프가
//    보이지 않았고, 3중에서만 붉어졌다(2026-08-24 독립 판정). 반대로 **원문의 `&amp;`를 통째로
//    금하면 오탐**이다: 텍스트 안의 진짜 `&`는 HTML에서 `&amp;`로 나오는 것이 정상이다
//    (내 첫 수정본이 이 오탐으로 붉어졌다). 이중 이스케이프의 지문은 `&amp;` **뒤에 엔티티가
//    이어지는 것** — `&amp;#10;`·`&amp;lt;`. 그것만 금한다
{
  const dbl = [...html.matchAll(/&amp;(?:#\d+|[a-zA-Z]+);/g)].map(m => m[0])
  check('이중 이스케이프(&amp;#10; 부류) 0건', dbl.length === 0, [...new Set(dbl)].slice(0, 5).join(' '))
}

// ④ 경사로(개요!D21 → 정보!J20) — F세대 §1-① 수리분이 뷰어에서도 사는가
check('경사로 실값 4가 그려짐(종전 전 고객 0)', /경사로[\s\S]{0,80}\b4\b/.test(text))
check('경사로 0 미출력', !/경사로[\s\S]{0,40}\b0\b[\s\S]{0,10}개소/.test(text))

out.push(`\n결과: ${pass} PASS / ${fail} FAIL`)
writeFileSync('scripts/_probe-info-fidelity.txt', out.join('\n'), 'utf8')
console.log(`${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
