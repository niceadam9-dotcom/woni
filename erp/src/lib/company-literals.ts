/** 엑셀 템플릿 운영사 고정 문구 → 회사정보 (통합 실행계획 C5 2차, 2026-10-02)
 *
 *  갑지(report-workbook-full.xlsx)·소방계획서(fire-plan-workbook.xlsx) 템플릿에는 운영사(승진소방) 정보가
 *  리터럴로 박혀 있다(실측: 갑지 14칸·소방계획서 12칸, scripts/_probe-c5-company-cells.mts). 회사정보를 바꿔도
 *  따라오지 않고, 표기도 다섯 가지로 갈려 있었다(주식회사 승진소방 ENG / ㈜승진소방 ENG / ㈜승진소방ENG /
 *  ㈜승진소방이엔지 / 승진소방). SaaS 테넌트에게는 남의 회사가 찍힌다.
 *
 *  사용자 결정(2026-10-02):
 *   · 상호 — 법인격이 필요한 칸(공문 머리·계약서)은 **정식** `official_sender_name`(주식회사 승진소방ENG),
 *     나머지는 **약식** `㈜` + 회사명(㈜승진소방ENG). 「이엔지」·띄어쓰기 변형은 없어진다.
 *   · 주소 — 템플릿의 「잿말길10번길 50-1 (덕평리 98-1)」이 맞다. 회사정보 주소를 그 도로명으로 고치고
 *     지번은 address_jibun(173)에 둔다.
 *   · 등록번호 — 회사정보 형식 「경기양평 제2020-01호」로 통일(갑지 대상물2의 「제 경기양평-2020-01호」도).
 *
 *  이 모듈은 **순수**하다(서버 모듈 import 0) — 테스트가 그대로 부른다. 바이트 치환은 lib/xlsx-personalize.
 *  규칙의 from은 템플릿 원문 그대로(XML 해독 뒤)이고, 'exact'는 셀 전체가 그 문자열일 때만, 'substring'은
 *  셀 안의 부분 문자열을 바꾼다. 긴 규칙이 먼저 걸리도록 적용기가 from 길이 내림차순으로 정렬한다.
 */

export type LiteralRule = { from: string; to: string; mode: 'exact' | 'substring'; note: string }

export type CompanyLiteralSource = {
  company_name: string | null
  official_sender_name: string | null
  representative: string | null
  business_number: string | null
  phone: string | null
  fax: string | null
  address: string | null
  address_jibun: string | null
  management_reg_no: string | null
  /** 공문 발신 대표 직함 — 비우면 '대표이사'(company-profile.companyIssuer와 같은 규칙) */
  official_rep_title: string | null
}

const t = (s: string | null | undefined) => (s ?? '').trim()
const CORP_PREFIX = /^(주식회사|㈜|\(주\))\s*/

/** 상호 두 꼴 — 정식(법인격 포함)·약식(㈜ 접두). 법인이 아니면 둘 다 회사명 그대로 */
export function companyNames(p: CompanyLiteralSource): { formal: string; short: string } {
  const official = t(p.official_sender_name)
  const name = t(p.company_name)
  const bare = name.replace(CORP_PREFIX, '') || official.replace(CORP_PREFIX, '')
  const isCorp = CORP_PREFIX.test(official) || CORP_PREFIX.test(name)
  return {
    formal: official || name,
    short: isCorp && bare ? `㈜${bare}` : (name || official),
  }
}

/** 지번 주소에서 도로명 주소와 겹치는 머리(시·도 / 시·군·구 / 읍·면·동 앞)를 떼어 괄호 꼴을 만든다.
 *  「경기도 양평군 양평읍 덕평리 98-1」 vs 「경기도 양평군 양평읍 잿말길10번길 50-1」 → 「덕평리 98-1」 */
export function jibunTail(road: string, jibun: string): string {
  const a = road.split(/\s+/).filter(Boolean)
  const b = jibun.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return b.slice(i).join(' ')
}

/** 대표자 이름을 한 글자씩 띄운다 — 서명란 관행(「김 흥 준」). sep은 템플릿 칸의 간격을 따른다 */
export const spacedName = (s: string, sep = ' ') => [...s.replace(/\s+/g, '')].join(sep)

/** 대상물2!A23 서명란 원문 — 칸 정렬용 공백이 앞·중간·뒤에 많다. **글자 하나 고치지 말 것**(exact 규칙의 from).
 *  2026-10-02 템플릿 실측(F:/AI/_wip/c5-2-2026-10-02/template-literals-dump.txt si475) */
const SIGN_BLOCK =
  ' '.repeat(36) + '소방시설관리업체(등록번호):  승진소방 ENG  (제 경기양평-2020-01호)\n\n' +
  ' '.repeat(54) + '대 표 자:          김  흥  준             (인)        '

/** 갑지(report-workbook-full.xlsx) 규칙 — 원문은 2026-10-02 템플릿 실측값 */
export function reportWorkbookRules(p: CompanyLiteralSource): LiteralRule[] {
  const { formal, short } = companyNames(p)
  const road = t(p.address), jibun = t(p.address_jibun)
  const tail = road && jibun ? jibunTail(road, jibun) : ''
  const rep = t(p.representative), phone = t(p.phone), reg = t(p.management_reg_no)
  const fax = t(p.fax), title = t(p.official_rep_title) || '대표이사'
  const roadFull = tail ? `${road} (${tail})` : road
  return [
    { mode: 'exact', from: '주식회사 승진소방 ENG', to: formal, note: '공문 레터헤드 상호(si426) — 정식' },
    { mode: 'exact', from: '㈜승진소방 ENG', to: short, note: '공문 발신(si440) — 약식' },
    { mode: 'exact', from: '㈜승진소방ENG', to: short, note: '완료보고서!B12 — 약식' },
    { mode: 'exact', from: '㈜승진소방이엔지', to: formal, note: '계약서 계약 당사자(si77) — 정식(법인격)' },
    { mode: 'substring', from: '㈜승진소방ENG(이하', to: `${formal}(이하`, note: '계약서 본문 「…과 ㈜승진소방ENG(이하 "계약대상자"…」(si598) — 정식(법인격)' },
    { mode: 'exact', from: '경기도 양평군 양평읍 잿말길10번길 50-1 (덕평리 98-1)', to: roadFull, note: '완료보고서!B16 도로명+(지번)' },
    { mode: 'exact', from: '경기도 양평군 양평읍 잿말길10번길50-1 (덕평리98-1)', to: roadFull, note: '띄어쓰기 없는 변형(si423) — 같은 꼴로 통일' },
    { mode: 'exact', from: '경기도 양평군 양평읍 잿말길10번길 50-1', to: road, note: '계약서 도로명(si633)' },
    {
      mode: 'exact',
      from: '경기도 양평군 양평읍 잿말길10번길 50-1 / Tel) 031-772-3019 / Fax) 031-772-2419',
      to: [road, phone && `Tel) ${phone}`, fax && `Fax) ${fax}`].filter(Boolean).join(' / '),
      note: '공문 레터헤드 연락처 줄(si427) — 비는 항목은 줄에서 뺀다',
    },
    { mode: 'exact', from: '대표이사 김흥준(직인생략)', to: rep ? `${title} ${rep}(직인생략)` : '', note: '공문 하단 명의(si452) — companyIssuer와 같은 직함 규칙' },
    {
      mode: 'exact',
      from: SIGN_BLOCK,
      to: SIGN_BLOCK
        .replace('승진소방 ENG  (제 경기양평-2020-01호)', `${short}${reg ? `  (${reg})` : ''}`)
        .replace('김  흥  준', rep ? spacedName(rep, '  ') : ''),
      note: '대상물2!A23 서명란(si475) — 약식 상호·회사정보 형식 등록번호·띄운 대표자, 정렬 공백 유지',
    },
    { mode: 'exact', from: ', 전화번호:   031-772-3019   )', to: `, 전화번호:   ${phone}   )`, note: '보고서 괄호 꼬리(si78) — 공백 3칸 유지' },
    { mode: 'exact', from: '김흥준', to: rep, note: '보고서·대상물2·완료보고서 대표자(si1·C14)' },
    { mode: 'exact', from: '031-772-3019', to: phone, note: '완료보고서!F14·계약서 전화(si636)' },
    { mode: 'exact', from: '031-772-2419', to: fax, note: '팩스(si640)' },
    { mode: 'exact', from: '586-86-00740', to: t(p.business_number), note: '완료보고서!I12 사업자번호' },
  ]
}

/** 소방계획서(fire-plan-workbook.xlsx) 규칙 — 원문은 2026-10-02 템플릿 실측값.
 *  ⚠ 「김흥준」은 이 템플릿에서 **표본 소방안전관리자** 이름이라 빌드가 이미 지운다(fire-plan-scrub) — 규칙 없음. */
export function firePlanWorkbookRules(p: CompanyLiteralSource): LiteralRule[] {
  const { short } = companyNames(p)
  const phone = t(p.phone)
  return [
    { mode: 'exact', from: '㈜승진소방이엔지', to: short, note: '1.8 업무대행 업체명' },
    { mode: 'exact', from: '경기도 양평군 양평읍 덕평리 98-1', to: t(p.address_jibun) || t(p.address), note: '1.8 업체주소(지번 — 없으면 도로명)' },
    { mode: 'exact', from: '경기양평 제2020-01호', to: t(p.management_reg_no), note: '1.8 등록번호' },
    { mode: 'exact', from: '031-772-3019', to: phone, note: '1.8 연락처·1.15 연락처' },
    { mode: 'exact', from: '승진소방', to: short, note: '1.15 피해복구 업체' },
    { mode: 'substring', from: '승진소방이엔지 031-772-3019', to: [short, phone].filter(Boolean).join(' '), note: '2.4 개별임무카드 비상연락처 5장' },
    { mode: 'substring', from: '승진소방이엔지 교육자료', to: `${short} 교육자료`, note: '1.11.2 교보재 예문(입력이 없으면 템플릿 예문이 그대로 주입된다)' },
  ]
}

/** 문자열 하나에 규칙 적용 — exact는 전체 일치일 때만, substring은 모든 출현. 긴 from 우선 */
export function applyLiteralRules(text: string, rules: LiteralRule[]): string {
  const exact = rules.find(r => r.mode === 'exact' && r.from === text)
  if (exact) return exact.to
  let out = text
  for (const r of [...rules].filter(r => r.mode === 'substring').sort((a, b) => b.from.length - a.from.length)) {
    if (out.includes(r.from)) out = out.split(r.from).join(r.to)
  }
  return out
}
