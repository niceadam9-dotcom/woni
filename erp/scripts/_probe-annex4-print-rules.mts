// 소방계획서_22 인쇄 규칙 프로브 — renderReport4 순수 렌더 검증 (DB·네트워크 무접촉)
// S1(○·×·／·공란 4분기) · S2(●/○ 불릿) · S12(설비당 독립 쪽번호) · S4(비고+각주) ·
// S3/S6(목차 — 법정 번호·본문 동일 집합·Q-11 펌프 조건부)
// 실행: npx tsx scripts/_probe-annex4-print-rules.mts
import { renderReport4, type Report4Data, type Report4SheetSection } from '../src/lib/doc-templates/report4'

let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

// 부속 3개 설비 — ① 소화기구(그룹·소제목·／전용 그룹 포함) ② 자탐(전부 ／) ③ 대형(분할 유발 45항목)
const s1: Report4SheetSection = {
  no: 1, name: '소화기구 및 자동소화장치',
  items: [
    { code: '1-A-001', name: '거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부', mark: 'O', comprehensive: false, group: '1-A. 소화기구(소화기, 자동확산소화기, 간이소화용구)', subgroup: null },
    { code: '1-A-002', name: '설치높이 적합 여부', mark: 'X', comprehensive: false, group: '1-A. 소화기구(소화기, 자동확산소화기, 간이소화용구)', subgroup: null },
    { code: '1-A-009', name: '설치수량 적정 여부', mark: null, comprehensive: true, group: '1-A. 소화기구(소화기, 자동확산소화기, 간이소화용구)', subgroup: null },
    { code: '1-B-031', name: '수신부의 정상(예비전원, 음향장치 등) 작동 여부', mark: 'N', comprehensive: false, group: '1-B. 자동소화장치', subgroup: '가스·분말·고체에어로졸 자동소화장치' },
    { code: '1-B-032', name: '소화약제의 지시압력 적정 및 외관의 이상 여부', mark: 'N', comprehensive: false, group: '1-B. 자동소화장치', subgroup: '가스·분말·고체에어로졸 자동소화장치' },
    { code: '1-B-033', name: '감지부(또는 화재감지기) 설치상태 적정 및 정상 작동 여부', mark: 'N', comprehensive: false, group: '1-B. 자동소화장치', subgroup: '가스·분말·고체에어로졸 자동소화장치' },
  ],
}
const s15: Report4SheetSection = {
  no: 15, name: '자동화재탐지설비 및 시각경보장치',
  items: [
    { code: '15-A-001', name: '경계구역 구분 적정 여부', mark: 'N', comprehensive: true, group: '15-A. 경계구역', subgroup: null },
    { code: '15-A-002', name: '감지기 지구·경계구역 표시 적정 여부', mark: 'N', comprehensive: true, group: '15-A. 경계구역', subgroup: null },
  ],
}
const big: Report4SheetSection = {
  no: 3, name: '스프링클러설비',
  items: Array.from({ length: 45 }, (_, i) => ({
    code: `3-A-${String(i + 1).padStart(3, '0')}`,
    name: `점검항목 ${i + 1} — 헤드 설치 상태 및 방호구역 유수검지장치 적정 여부 확인`,
    mark: (i % 3 === 0 ? 'O' : i % 3 === 1 ? 'X' : null) as 'O' | 'X' | null,
  })),
}
const s31: Report4SheetSection = {
  no: 31, name: '기타사항',
  items: [{ code: '31-A-001', name: '방화문 및 방화셔터의 관리 상태', mark: null }],
}

const base: Report4Data = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '프로브빌딩', purpose: '업무시설', address: '경기도 양평군',
  facilityChecks: [], resultMarks: {}, muResults: {},
  main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '1',
  companyName: '승진소방', specs: {},
  sheetSections: [s1, s15, big, s31],
  pumpRows: [],
}

const html = renderReport4(base)

// ── S1 — ／ 복원·무응답 공란·발췌 문구 삭제 ──
check('S1: ／(N) 마크 렌더', html.includes('>/<') || />\/</.test(html))
check('S1: 1-B-031~033 전원 ／ 생존', ['1-B-031', '1-B-032', '1-B-033'].every(c => html.includes(c)))
check('S1: 15-A 전부 ／ 그룹 생존(시트·그룹 소멸 없음)', html.includes('15-A-001') && html.includes('15-A. 경계구역'))
check('S1: 발췌 안내 문구 삭제', !html.includes('점검항목만 수록'))
check('S1: 무응답 항목 행 존재(1-A-009)', html.includes('1-A-009'))

// ── S2 — ●/○ 불릿 ──
check('S2: 종합전용 ● 불릿', html.includes('● 설치수량 적정 여부') && html.includes('● 경계구역 구분 적정 여부'))
check('S2: 일반 ○ 불릿', html.includes('○ 설치높이 적합 여부'))

// ── S12 — 설비당 독립 쪽번호·페이지 분할 ──
check('S12: 설비당 (1쪽 중 1쪽) 독립 축', (html.match(/\(1쪽 중 1쪽\)/g) ?? []).length >= 3)
check('S12: 대형 설비 분할 (2쪽 중 1쪽)·(2쪽 중 2쪽)', html.includes('(2쪽 중 1쪽)') && html.includes('(2쪽 중 2쪽)'))
check('S12: 설비 제목이 각자 페이지에', html.includes('1. 소화기구 및 자동소화장치 점검표') && html.includes('15. 자동화재탐지설비 및 시각경보장치 점검표'))
check('S12: 점검표 전용 용지 푸터', html.includes('210mm×297mm [백상지(80g/㎡)]'))

// ── S4 — 비고 행 + 각주(설비 수만큼) ──
const tails = (html.match(/※ 점검결과란은 양호 “○”, 불량 “×”, 해당없는 항목은 “\/”로 표시한다\./g) ?? []).length
check('S4: 각주가 설비마다 반복(4설비 = 4회)', tails === 4, `${tails}회`)
check('S4: 비고 행 존재', html.includes('>비고<'))

// ── S3/S6 — 목차 ──
check('S6: 목차 쪽 존재', html.includes('목  차'))
check('S3: 법정 번호 유지(1·3·15·31)', ['1. 소화기구 및 자동소화장치 점검표', '3. 스프링클러설비 점검표', '15. 자동화재탐지설비 및 시각경보장치 점검표', '31. 기타사항 점검표'].every(l => html.includes(l)))
check('S3: 펌프 없음 → 목차에 펌프성능시험 없음', !html.includes('>펌프성능시험<'))
const tocIdx = html.indexOf('목  차')
const sheetIdx = html.indexOf('1. 소화기구 및 자동소화장치 점검표')
check('S6: 목차가 부속 점검표 직전(앞)에 위치', tocIdx > -1 && tocIdx < sheetIdx)

// ── Q-11 — 펌프 값 있으면 목차 조건부 1줄 ──
const withPump = renderReport4({
  ...base,
  pumpRows: [{ sheetNo: 2, pumpKind: '주', shutoffFlow: 1, shutoffPress: 1, ratedFlow: 1, ratedPress: 1, overFlow: 1, overPress: 1, setStartPress: 1, setStopPress: 1, judges: ['O', 'O', 'O'], note: null }],
})
check('Q-11: 펌프 값 있음 → 목차에 조건부 1줄', withPump.includes('펌프성능시험</td>'))

// ── 회귀 — 목차·부속이 비면 쪽 자체가 없다(별지 4호 7쪽은 유지) ──
const noSheets = renderReport4({ ...base, sheetSections: [] })
// '점검표</h1>'는 1쪽 제목(소방시설등 점검표)에도 걸리므로 설비별 쪽번호 축으로 판정한다
check('회귀: 부속 없으면 목차·점검표 쪽 없음', !noSheets.includes('목  차') && !noSheets.includes('(1쪽 중 1쪽)'))
check('회귀: 1~2쪽 본문 유지', noSheets.includes('소방시설등 점검표') && noSheets.includes('다중이용업소 안전시설등 점검결과'))

console.log(fail === 0 ? '\n전건 통과' : `\n실패 ${fail}건`)
process.exit(fail === 0 ? 0 : 1)
