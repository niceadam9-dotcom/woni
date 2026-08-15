/** 위임장 렌더 프로브 (소방계획서_22 S8) — renderDelegation 순수 함수 단언.
 *  서식 원천('보고서 갑지.xls' [위임장] 탭 실측)의 구성 요소가 실제 렌더 경로에 살아 있는지 검사.
 *  실행: npx tsx scripts/_probe-delegation-render.mts */
import { renderDelegation, type DelegationData } from '../src/lib/doc-templates/delegation'

let pass = 0, fail = 0
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`)
  ok ? pass++ : fail++
}

const full: DelegationData = {
  typeLabel: '최초점검',
  owner: { name: '홍관계', position: '소방안전관리자', phone: '010-0000-0001', birth: '1972.12.27' },
  agent: { name: '김대리', position: '과장', phone: '010-0000-0002', birth: '1987.10.13' },
  periodLabel: '2026.12.20 부터 ~ 2026.12.20 까지',
  daysLabel: '1일',
  submitDate: '2026년 7월 16일',
  station: '양평',
}
const h = renderDelegation(full)

// 제목·체크박스 — typeLabel과 일치하는 행만 √
check('제목: 소방시설등 … 점검결과 보고서 제출용 위임장', h.includes('소방시설등') && h.includes('점검결과 보고서 제출용 위임장'))
check('체크박스: 최초에만 √', /\[√\]<\/td><td>최초/.test(h) && !/\[√\]<\/td><td>작동/.test(h) && !/\[√\]<\/td><td>종합/.test(h))

// 당사자 표 — 두 당사자 헤더 + 4행 값
check('당사자 헤더 2종', h.includes('특정소방대상물 관계인(본인)') && h.includes('소방시설관리업체(대리인)'))
check('관계인 값 4종', ['홍관계', '소방안전관리자', '010-0000-0001', '1972.12.27'].every(v => h.includes(v)))
check('대리인 값 4종', ['김대리', '과장', '010-0000-0002', '1987.10.13'].every(v => h.includes(v)))
check('점검일자 + 일수', h.includes('2026.12.20 부터 ~ 2026.12.20 까지') && h.includes('1일'))

// 위임내용 — 법 조문 인용 축자(띄어쓰기 교정본)
check('위임내용: 법 제22조 제1항·시행규칙 제23조', h.includes('제22조 제1항') && h.includes('시행규칙 제23조') && h.includes('제출을 대리인에게 위임합니다'))

// 서명·수신처
check('관계인 서명란 (서명 또는 인)', h.includes('(서명 또는 인)'))
check('관할 소방서 귀하', h.includes('양평') && h.includes('소방서(본부) 귀하'))

// 붙임서류·유의사항 — 샘플 축자
check('붙임서류 문구', h.includes('관계인 신분증명서 사본 1부'))
check('유의사항 1 (형법 231·232)', h.includes('제231조') && h.includes('제232조') && h.includes('사문서 위조ㆍ변조죄'))
check('유의사항 2 (질서위반행위규제법)', h.includes('질서위반행위규제법') && h.includes('100만원 이하의 과태료'))
check('용지 푸터 (재활용품 표기 — 샘플 축자)', h.includes('210mm×297mm[백상지 80g/㎡(재활용품)]'))

// Q-4 철학 — 값이 전부 비어도 서식은 온전히 렌더(칸만 공란)
const empty = renderDelegation({
  typeLabel: '작동점검',
  owner: { name: '', position: '', phone: '', birth: '' },
  agent: { name: '', position: '', phone: '', birth: '' },
  periodLabel: '', daysLabel: '', submitDate: '', station: '',
})
check('공란 데이터도 렌더 성립(서식 온전)', empty.includes('위 임 내 용') && empty.includes('유 의 사 항') && /\[√\]<\/td><td>작동/.test(empty))
check('공란: 일수 괄호 미출력', !empty.includes('（'))

console.log(`\n${pass}/${pass + fail} 통과`)
if (fail) process.exit(1)
