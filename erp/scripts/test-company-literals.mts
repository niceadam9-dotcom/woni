// 운영사 고정 문구 치환 단위 테스트 (통합 실행계획 C5 2차, 2026-10-02) — 서버·DB 불필요
// 실행: npx tsx scripts/test-company-literals.mts   (test-all 등재)
//
// 고정하는 것:
//  [1] 가상 테넌트 정보를 넣으면 두 템플릿에서 운영사(승진소방) 흔적이 **0**이다 — SaaS에서 남의 회사가 안 찍힌다
//  [2] 승진소방 자신의 정보를 넣으면 결정(2026-10-02)대로 **통일**된다 — 정식/약식 두 꼴·10번길·회사정보 형식 등록번호
//  [3] 순수 함수 — 상호 두 꼴·지번 꼬리·띄운 이름·exact/substring 우선순위
//  [4] 규칙이 템플릿의 실제 원문을 하나도 놓치지 않는다(규칙 from이 템플릿에 실재)
import { readFileSync } from 'fs'
import JSZip from 'jszip'
import {
  reportWorkbookRules, firePlanWorkbookRules, companyNames, jibunTail, spacedName, applyLiteralRules,
  officialSignLine, sealPlacement, estimateTextPx,
  type CompanyLiteralSource,
} from '../src/lib/company-literals'
import { personalizeWorkbook } from '../src/lib/xlsx-personalize'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { console.log(`  ${c ? '✅' : '❌'} ${m}${!c && d ? ` — ${d}` : ''}`); c ? pass++ : fail++ }

const OPERATOR = /승진|덕평|2020-01|772-3019|772-2419|586-86|김흥준|김 흥 준|김  흥  준|잿말길/

async function allTexts(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes)
  const dec = (s: string) => s.replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const out: string[] = []
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? [])
    out.push(dec([...si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')))
  for (const p of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    const xml = await zip.file(p)!.async('string')
    for (const m of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) out.push(dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')))
    for (const m of xml.matchAll(/t="str"[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>/g)) out.push(dec(m[1]))
  }
  return out
}

const SEUNGJIN: CompanyLiteralSource = {
  company_name: '승진소방ENG', official_sender_name: '주식회사 승진소방ENG', representative: '김흥준',
  business_number: '586-86-00740', phone: '031-772-3019', fax: '031-772-2419',
  address: '경기도 양평군 양평읍 잿말길10번길 50-1', address_jibun: '경기도 양평군 양평읍 덕평리 98-1',
  management_reg_no: '경기양평 제2020-01호', official_rep_title: null,
}
const TENANT: CompanyLiteralSource = {
  company_name: '한빛방재', official_sender_name: '주식회사 한빛방재', representative: '이도윤',
  business_number: '123-45-67890', phone: '02-555-0100', fax: '02-555-0101',
  address: '서울특별시 마포구 월드컵로 100', address_jibun: '서울특별시 마포구 망원동 1-2',
  management_reg_no: '서울마포 제2024-07호', official_rep_title: '대표',
}

const TEMPLATES = [
  { file: 'templates/report-workbook-full.xlsx', rules: reportWorkbookRules },
  { file: 'templates/fire-plan-workbook.xlsx', rules: firePlanWorkbookRules },
] as const

for (const t of TEMPLATES) {
  const bytes = new Uint8Array(readFileSync(t.file))
  const before = await allTexts(bytes)
  console.log(`\n── ${t.file} ──`)

  // [4] 규칙 원문이 템플릿에 실재 — 오타 규칙은 조용히 아무것도 안 바꾼다
  for (const r of t.rules(TENANT)) {
    const hit = r.mode === 'exact' ? before.includes(r.from) : before.some(s => s.includes(r.from))
    ok(hit, `[4] 원문 실재: ${r.note}`, JSON.stringify(r.from).slice(0, 60))
  }

  // [1] 가상 테넌트 — 운영사 흔적 0
  const ten = await personalizeWorkbook(bytes, t.rules(TENANT))
  const tenTexts = await allTexts(ten.bytes)
  const leftovers = tenTexts.filter(s => OPERATOR.test(s))
  ok(leftovers.length === 0, `[1] 가상 테넌트 — 운영사 흔적 0 (바뀐 칸 ${ten.changed.length})`, leftovers.slice(0, 3).map(s => JSON.stringify(s.slice(0, 50))).join(' | '))
  ok(tenTexts.some(s => s.includes('한빛방재')), '[1] 테넌트 상호가 실렸다')

  // [2] 승진소방 — 결정대로 통일
  const sj = await allTexts((await personalizeWorkbook(bytes, t.rules(SEUNGJIN))).bytes)
  ok(!sj.some(s => /승진소방이엔지|승진소방 ENG/.test(s)), '[2] 「이엔지」·「승진소방 ENG」 변형 0')
  ok(!sj.some(s => /잿말길 50-1/.test(s)), '[2] 「잿말길 50-1」(10번길 빠진 주소) 0')
  ok(!sj.some(s => s.includes('제 경기양평-2020-01호')), '[2] 옛 등록번호 꼴 0')
  if (t.file.includes('report')) {
    ok(sj.includes('주식회사 승진소방ENG'), '[2] 정식 상호(공문 머리·계약서) 실림')
    ok(sj.includes('㈜승진소방ENG'), '[2] 약식 상호 실림')
    ok(sj.includes('경기도 양평군 양평읍 잿말길10번길 50-1 (덕평리 98-1)'), '[2] 완료보고서 도로명 (지번) 꼴 유지')
    ok(sj.some(s => s.includes('소방시설관리업체(등록번호):  ㈜승진소방ENG  (경기양평 제2020-01호)') && s.includes('대 표 자:          김  흥  준             (인)')), '[2] 대상물2 서명란 — 약식 상호·회사정보 등록번호·띄운 대표자(정렬 공백 유지)')
    ok(sj.includes('경기도 양평군 양평읍 잿말길10번길 50-1 / Tel) 031-772-3019 / Fax) 031-772-2419'), '[2] 공문 레터헤드 연락처 줄 무변화')
    ok(sj.includes('대표이사 김흥준(직인생략)'), '[2] 공문 하단 명의 무변화')
    ok(sj.some(s => s.includes('주식회사 승진소방ENG(이하 "계약대상자"')), '[2] 계약서 본문 계약대상자 — 정식 상호')
    ok(!sj.includes('경기도 양평군 양평읍 잿말길10번길50-1 (덕평리98-1)'), '[2] 띄어쓰기 없는 주소 변형 0')
    ok(tenTexts.includes('서울특별시 마포구 월드컵로 100 / Tel) 02-555-0100 / Fax) 02-555-0101'), '[1] 테넌트 레터헤드 연락처 줄')
    ok(tenTexts.includes('대표 이도윤(직인생략)'), '[1] 테넌트 하단 명의 — 회사정보 직함')
  } else {
    ok(sj.includes('㈜승진소방ENG'), '[2] 1.8·1.15 약식 상호 실림')
    ok(sj.includes('경기도 양평군 양평읍 덕평리 98-1'), '[2] 1.8 지번 주소 유지')
    ok(sj.filter(s => s.includes('㈜승진소방ENG 031-772-3019')).length >= 5, '[2] 2.4 임무카드 5장 비상연락처')
  }
}

// [3] 순수 함수
console.log('\n── 순수 함수 ──')
ok(JSON.stringify(companyNames(SEUNGJIN)) === JSON.stringify({ formal: '주식회사 승진소방ENG', short: '㈜승진소방ENG' }), '[3] 상호 두 꼴(법인)')
ok(companyNames({ ...TENANT, official_sender_name: null, company_name: '개인방재' }).short === '개인방재', '[3] 법인 아님 → ㈜ 안 붙임')
ok(companyNames({ ...TENANT, official_sender_name: null, company_name: '㈜다온소방' }).short === '㈜다온소방', '[3] 회사명이 이미 ㈜ → 그대로')
ok(jibunTail('경기도 양평군 양평읍 잿말길10번길 50-1', '경기도 양평군 양평읍 덕평리 98-1') === '덕평리 98-1', '[3] 지번 꼬리')
ok(spacedName('김흥준') === '김 흥 준' && spacedName('남궁 민') === '남 궁 민', '[3] 띄운 이름')
const rs = reportWorkbookRules(TENANT)
ok(applyLiteralRules('031-772-3019', rs) === '02-555-0100', '[3] exact 전체 일치만')
ok(applyLiteralRules('연락 031-772-3019 끝', rs) === '연락 031-772-3019 끝', '[3] exact는 부분 문자열을 안 바꾼다')
const fr = firePlanWorkbookRules(TENANT)
ok(applyLiteralRules('– 119\n승진소방이엔지 031-772-3019\n –', fr) === '– 119\n㈜한빛방재 02-555-0100\n –', '[3] substring 치환(카드)')
const blank = reportWorkbookRules({ ...TENANT, address_jibun: null, management_reg_no: null, representative: null })
ok(applyLiteralRules('경기도 양평군 양평읍 잿말길10번길 50-1 (덕평리 98-1)', blank) === '서울특별시 마포구 월드컵로 100', '[3] 지번 없음 → 괄호 없이 도로명만')
const signFrom = rs.find(r => r.note.startsWith('대상물2'))!.from
ok(!applyLiteralRules(signFrom, blank).includes('()'), '[3] 등록번호 없음 → 빈 괄호 없음')
ok(applyLiteralRules('경기도 양평군 양평읍 잿말길10번길 50-1 / Tel) 031-772-3019 / Fax) 031-772-2419', reportWorkbookRules({ ...TENANT, fax: null })) === '서울특별시 마포구 월드컵로 100 / Tel) 02-555-0100', '[3] 팩스 없음 → 연락처 줄에서 뺀다')
ok(applyLiteralRules('대표이사 김흥준(직인생략)', reportWorkbookRules({ ...TENANT, official_rep_title: null })) === '대표이사 이도윤(직인생략)', '[3] 직함 비면 대표이사')
ok(spacedName('이도윤', '  ') === '이  도  윤', '[3] 띄운 이름 — 간격 지정')

// [5] 직인(174) — 엑셀 공문 명의 문구·자리
console.log('\n── 직인 ──')
ok(applyLiteralRules('대표이사 김흥준(직인생략)', reportWorkbookRules(SEUNGJIN, { seal: true })) === '대표이사 김흥준', '[5] 직인 있음 → (직인생략) 뺌')
ok(applyLiteralRules('대표이사 김흥준(직인생략)', reportWorkbookRules(SEUNGJIN)) === '대표이사 김흥준(직인생략)', '[5] 직인 없음(기본) → 종전 문구')
ok(officialSignLine({ representative: null, official_rep_title: '대표' }, true) === '', '[5] 대표자 없음 → 빈 명의(직인 안 찍음)')
ok(estimateTextPx('대표이사 김흥준', 20) === 7.3 * 20, '[5] 글자 폭 추정 — 한글 7 + 공백 0.3em')
const sp = sealPlacement('대표이사 김흥준')
ok(sp.w === 60 && sp.h === 60 && sp.dy === 12 && Math.abs(sp.dx - 7.3 * 20 * 96 / 72 / 2) < 1e-9, '[5] 직인 자리 — 중심이 이름 끝(절반 걸침)', JSON.stringify(sp))

console.log(fail === 0 ? `\n✅ 운영사 문구 치환 전건 통과 (${pass})` : `\n❌ 실패 ${fail}건 / 통과 ${pass}`)
process.exit(fail ? 1 : 0)
