/** 별지 4호(소방시설등점검표) HTML 템플릿 — 7쪽 전체 (소방계획서_7 S3A H-21)
 *
 *  서식 원문: erp_goal/_doc01/[별지 4] 소방시설등(작동점검·종합점검) 점검표.xml
 *  (소방시설 자체점검사항 등에 관한 고시 별지 제4호서식, HWPML) 추출(2026-08-03).
 *  1쪽 = 제목·√ 안내·특정소방대상물·소방시설등 점검결과(2열 요약 — 별지 9호 3쪽과 동일 데이터,
 *  facilityResultSection 공유) / 2쪽 = 다중이용업소 안전시설등·점검업체(점검인력) 현황·점검기간·
 *  관리업체·점검번호 구분·작성 유의사항 / 3~7쪽 = 소방시설등의 세부현황(spec-sections 공용 렌더 —
 *  customer_facility_specs, 별지 9호 4~7쪽과 공용 원본 §4-A-1).
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 report9-actions.assembleReport4. */

import { renderDocument, pageHeader, pageFooter, esc, val, ck, resultMark } from './base'
import { facilityResultSection, muResultSection, type Report9Person } from './report9'
import { renderSpecSections, type SpecMap } from './spec-sections'
import { PUMP_JUDGE_LABELS, PUMP_SHEET_LABELS } from '@/lib/pump-test'

/** 부속 '설비별 점검표' 1행 — 시트 전 항목 수록: ○·×·／ 세 값 + 무응답 공란(소방계획서_22 Q-1·Q-5,
 *  2026-08-14 확정 — 종전 A4-1 Q-2 '○/× 발췌 수록'을 번복. 법정 서식은 항목 행이 항상 존재한다).
 *  group/subgroup은 소방계획서_23 Q-16(3층 축) — 마이그레이션 134 이전 조립분은 undefined라 종전 렌더 그대로다. */
export type Report4SheetItem = {
  code: string; name: string
  /** 점검결과 — O 양호○ / X 불량× / N 해당없음／ / null 무응답(공란, 미점검) */
  mark: 'O' | 'X' | 'N' | null
  /** 종합점검 전용 항목(●) — 항목명 앞 불릿이 ●, 일반 항목은 ○ (22 S2, 원문 R-5) */
  comprehensive?: boolean
  /** 중분류 헤더(법정 표기 — 예: '1-A. 소화기구(소화기, 자동확산소화기, 간이소화용구)') */
  group?: string | null
  /** 대괄호 소제목(예: '주거용 주방 자동소화장치') — null = 소제목 없는 구간(혼재 중분류의 앞부분) */
  subgroup?: string | null
}
export type Report4SheetSection = { no: number; name: string; items: Report4SheetItem[] }

/** ※ 펌프성능시험 1행 — 법정 서식의 표 (소방계획서_21 R5-7 후속, inspection_pump_tests가 원천) */
export type Report4PumpRow = {
  sheetNo: number
  pumpKind: '주' | '예비'
  shutoffFlow: number | null; shutoffPress: number | null
  ratedFlow: number | null; ratedPress: number | null
  overFlow: number | null; overPress: number | null
  setStartPress: number | null; setStopPress: number | null
  /** 적정 여부 3건의 최종값(자동 판정 + 수동 보정) — 판정 규칙은 lib/pump-test.ts가 원본 */
  judges: Array<'O' | 'X' | null>
  note: string | null
}

export type Report4Data = {
  // ── 1쪽 ──
  ckOp: boolean               // 작동점검
  ckInitial: boolean          // 종합점검 — 최초점검
  ckCompEtc: boolean          // 종합점검 — 그 밖의 점검
  customerName: string        // 건물명(상호)
  purpose: string             // 대상물 구분
  address: string             // 소재지
  facilityChecks: string[]                       // 설치 설비(√) — FORM3_ITEMS 명칭
  resultMarks: Record<string, 'O' | 'X' | 'N'>   // 점검결과 ○/×// (별지 9호 3쪽과 동일 데이터)
  /** B-3(소방계획서_19): '기타' 3항목 — 31번 기타사항 롤업 (별지 9호 3쪽과 공용, facilityResultSection) */
  etcMarks?: { door?: 'O' | 'X' | 'N'; exit?: 'O' | 'X' | 'N'; flame?: 'O' | 'X' | 'N' }
  // ── 2쪽 ──
  muResults: Record<string, 'O' | 'X' | 'N'>     // MU-001~016 (다중이용업 아니면 전 칸 'N' = ／)
  main: Report9Person | null                     // 주인력
  assistants: Report9Person[]                    // 보조인력 — 서식 기본 6행, 초과 시 행 추가
  inspStart: string                              // 점검기간 시작 (예: 2026년 8월 1일)
  inspEnd: string
  inspDays: string
  companyName: string                            // 소방시설관리업체
  /** A4-2(소방계획서_15): 소방시설관리업 등록번호 — company_profile.management_reg_no(123), 없으면 종전 공란 */
  companyRegNo?: string
  /** 부속 설비별 점검표 — 설치 설비 축 시트의 전 항목(○·×·／·공란, 22 Q-1·Q-3·Q-4).
   *  목차(tocPage)와 본문(sheetItemPages)이 같은 배열을 읽어 어긋날 수 없다 */
  sheetSections?: Report4SheetSection[]
  /** ※ 펌프성능시험 실측치 — 비면 그 쪽을 미생성 (R5-7 후속) */
  pumpRows?: Report4PumpRow[]
  // ── 3~7쪽 ──
  specs: SpecMap                                 // customer_facility_specs 병합본
  ledgerCodes?: string[]                         // 1.4 설치(√) 코드 전체 — 1쪽 하위 체크칸·세부현황 파생용
  building?: Record<string, number | string | null | undefined>  // 건물 파생 필드(비상용승강기) 원천
}

export type Report4RenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .sec-title { font-size: 10.5pt; font-weight: bold; margin: 7px 0 2px; }
  .pre { white-space: pre-wrap; }
  table.form.tight th, table.form.tight td { padding: 1.5px 3px; font-size: 8.5pt; line-height: 1.4; }
  table.form .lbl { width: 22mm; }
  table.split { width: 100%; border-collapse: collapse; table-layout: fixed; height: 1px; }
  table.split > tbody > tr > td { padding: 0; vertical-align: top; width: 50%; height: 100%; }
  /* 좌·우 표 바닥 맞춤 — report9.ts CSS와 동일 규약(공용 facilityResultSection·muResultSection) */
  table.form.fill { height: 100%; }
  table.form.fill-last > tbody > tr { height: 1px; }
  table.form.fill-last > tbody > tr:last-child { height: 100%; }
  .notice th, .notice td { font-size: 8.5pt; }
  .p47 .sec-title { margin: 5px 0 2px; }
`

// ── 1쪽 — 표지·특정소방대상물·소방시설등 점검결과 ─────────────────────────
function page1(d: Report4Data, h: boolean): string {
  return `
${pageHeader('소방시설 자체점검사항 등에 관한 고시[별지 제4호서식]', '(7쪽 중 1쪽)')}
<div class="small pre"> ${ck(d.ckOp)} 작동점검, 종합점검(${ck(d.ckInitial)}최초점검, ${ck(d.ckCompEtc)}그 밖의 점검)</div>
<h1 class="doc-title">소방시설등 점검표</h1>
<div class="small">※ 소방시설, 다중이용업란의 [&nbsp;&nbsp;]란에는 해당 시설에 √ 표를 한다. 점검결과란은 양호○. 불량X. 해당없는 항목은 /표시를 한다.</div>
<div class="sec-title">□ 특정소방대상물</div>
<table class="form tight">
  <tr>
    <td class="pre" style="width:50%">건물명(상호) :  ${val(d.customerName, { highlight: h })}</td>
    <td class="pre">대상물 구분 :  ${val(d.purpose, { highlight: h })}</td>
  </tr>
  <tr><td colspan="2" class="pre">소 재 지 :  ${val(d.address, { highlight: h })}</td></tr>
</table>
<div class="sec-title">□ 소방시설등 점검결과</div>
${facilityResultSection(d)}
${pageFooter()}`
}

// ── 2쪽 — 안전시설등·점검인력·점검기간·점검번호 구분·유의사항 ─────────────
function crewRow(kind: string, p: Report9Person | null, h: boolean): string {
  return `<tr><td class="center nowrap">${kind}</td>
    <td class="center">${val(p?.name, { highlight: h })}</td>
    <td class="center">${val(p?.grade, { highlight: h })}</td>
    <td class="center">${val(p?.licenseNo, { highlight: h })}</td>
    <td class="center">${val(p?.period, { highlight: h })}</td>
    <td class="center small">(서명)</td></tr>`
}

function page2(d: Report4Data, h: boolean): string {
  // 보조인력 — 서식 기본 6행 유지, 초과분 동적 추가 (별지 9호 개선과 동일 계열)
  const assists: Array<Report9Person | null> = [...d.assistants]
  while (assists.length < 6) assists.push(null)

  const dateSlot = (v: string) => v ? esc(v) : '        년    월    일'

  return `
${pageHeader(null, '(7쪽 중 2쪽)')}
<div class="sec-title">□ 다중이용업소 안전시설등 점검결과</div>
${muResultSection(d)}
<div class="sec-title">□ 점검업체(점검인력) 현황</div>
<table class="form tight">
  <colgroup><col style="width:20mm"><col style="width:22mm"><col style="width:26mm"><col style="width:30mm"><col><col style="width:16mm"></colgroup>
  <tr><th>구분</th><th>성명</th><th>자격구분</th><th>자격번호</th><th>점검참여일(기간)</th><th>서명</th></tr>
  ${crewRow('주인력', d.main, h)}
  ${assists.map(a => crewRow('보조인력', a, h)).join('\n  ')}
</table>
<table class="form tight" style="margin-top:-0.6pt">
  <tr>
    <td class="pre">점검기간(일자): ${dateSlot(d.inspStart)}부터 ${dateSlot(d.inspEnd)} 까지 (총 점검일수: ${val(d.inspDays, { highlight: h }) || '      '} 일)<br>                             소방시설관리업체(등록번호): ${val(d.companyName, { highlight: h })}                     (${d.companyRegNo ? `제 ${esc(d.companyRegNo)} 호` : '제    -    호'})    (인)</td>
  </tr>
</table>
<div class="sec-title">□ 점검번호 구분</div>
<table class="form tight">
  <colgroup><col style="width:30mm"><col></colgroup>
  <tr>
    <td class="center">대분류<br>(설비구분)</td>
    <td class="pre"> 소화기구 및 자동소화장치를 ‘1’번으로 하여 설비별 순차적으로 번호를 부여하여<br> 다중이용업소 ‘32’번까지로 함</td>
  </tr>
  <tr>
    <td class="center">중분류<br>(단위구분)</td>
    <td class="pre"> 각 설비별 점검단위에 따라 ‘A’부터 알파벳 순서대로 부여함</td>
  </tr>
  <tr>
    <td class="center">소분류<br>(점검항목)</td>
    <td class="pre"> 각 설비별 점검단위 내의 점검항목에 따라 ‘001’부터 순서대로 부여함</td>
  </tr>
</table>
<table class="form notice" style="margin-top:4px">
  <tr>
    <th style="width:30mm">작성 및 유의사항</th>
    <td class="pre"> 1. 소방시설등 (작동, 종합)점검결과보고서의 ‘각 설비별 점검결과’에는 본 서식의 점검번호를 기재한다.<br> 2. 자체점검결과(보고서 및 점검표)를 2년간 보관하여야 한다.</td>
  </tr>
</table>
${pageFooter()}`
}

// ── 3~7쪽 — 소방시설등의 세부현황 (spec-sections 공용 렌더) ────────────────
// 원본 쪽 구성 계열(섹션 단위): 3쪽 = 1·2(소화기구·수계공통), 4쪽 = 3(수계개별),
// 5쪽 = 4·5(가스계·경보), 6쪽 = 6·7(피난구조·소화용수), 7쪽 = 8(소화활동)
function specPage(no: number, sections: string[], withHead = false): string {
  const head = withHead
    ? `<h1 class="doc-title" style="font-size:13pt; letter-spacing:.1em; margin:4px 0 6px;">소방시설등의 세부현황</h1>
<div class="small"> ※ [&nbsp;&nbsp;]에는 해당 시설에 √ 표를 하고, 수량을 기입하며, 설비현황에 대하여 기입란이 부족한 경우 서식을 추가하여 작성할 수 있습니다.</div>\n`
    : ''
  return `
${pageHeader(null, `(7쪽 중 ${no}쪽)`)}
<div class="p47">
${head}${sections.join('\n')}
</div>
${pageFooter()}`
}

/** 부속 점검표 1행 조각 — 페이지 분할(S12)을 위해 행 단위로 만든다. w = 대략적 줄 수(분할 예산용) */
type SheetRowPiece = { html: string; w: number }

/** 항목명이 표 안에서 2줄로 꺾일 만한 길이 — 이름 열 폭(약 140mm, 8.5pt) 기준 보수적 추정 */
const WRAP_THRESHOLD = 46

function sheetItemRowPieces(items: Report4SheetItem[]): SheetRowPiece[] {
  const out: SheetRowPiece[] = []
  let curGroup: string | null | undefined
  let curSub: string | null | undefined
  for (const it of items) {
    if (it.group != null && it.group !== curGroup) {
      out.push({ html: `<tr><td colspan="3" style="font-weight:bold; background:#fafafa">${esc(it.group)}</td></tr>`, w: 1 })
      curGroup = it.group
      curSub = undefined   // 중분류가 바뀌면 소제목 추적도 리셋 — 이전 중분류의 소제목이 이월되면 안 된다
    }
    if (it.subgroup !== undefined && it.subgroup !== curSub) {
      // null run(소제목 없는 앞부분)은 행을 만들지 않는다 — 원문에 없는 헤더를 지어내지 않는다(G-2 혼재)
      if (it.subgroup) out.push({ html: `<tr><td></td><td colspan="2" style="font-weight:600">[${esc(it.subgroup)}]</td></tr>`, w: 1 })
      curSub = it.subgroup
    }
    // R-5(22 S2) — 항목명 앞 불릿: 종합전용 ●, 일반 ○ (원문 축자 — 불릿은 DB 이름에 없고 comprehensive_only가 원천)
    // R-6(22 S1, Q-1·Q-5) — 결과란 4분기: ○/×/／/공란(무응답)
    out.push({
      html: `<tr><td class="center nowrap">${esc(it.code)}</td><td>${it.comprehensive ? '●' : '○'} ${esc(it.name)}</td><td class="center">${resultMark(it.mark)}</td></tr>`,
      w: it.name.length > WRAP_THRESHOLD ? 2 : 1,
    })
  }
  return out
}

/** 부속 점검표 본문 행 emit — 중분류·대괄호 소제목 행을 **값이 바뀔 때만** 삽입 (소방계획서_23 Q-16, 22 S9-4 흡수).
 *  순수 함수 분리(23 §0-b) — S12의 설비당 페이지 골격과 행 생성 규칙을 섞지 않는다.
 *  group/subgroup이 없는 조립분(134 미적용)은 헤더 행 없이 렌더된다. */
export function sheetItemBodyRows(items: Report4SheetItem[]): string {
  return sheetItemRowPieces(items).map(p => p.html).join('\n  ')
}

/** 점검표 꼬리 — '비고' 행 + ※ 각주 4줄 (22 S4, `_별지4호_현행판_추출.txt:507-512` 축자).
 *  specNoteTable()(별지 9호 4쪽 세부현황용 3줄)과는 별개 문안이므로 재사용하지 않는다(S4-3).
 *  따옴표(U+201C/201D)·구분자(위치․구조․용도 = U+2024)까지 원문 그대로 — 전역 치환 금지(위치별 축자). */
function sheetTail(): string {
  return `<table class="form tight" style="margin-top:-0.6pt">
  <colgroup><col style="width:24mm"><col></colgroup>
  <tr><td class="center">비고</td><td style="height:12mm"></td></tr>
</table>
<div class="small" style="margin-top:2px; line-height:1.55">※ 점검항목 중 “●”는 종합점검의 경우에만 해당한다.<br>※ 점검결과란은 양호 “○”, 불량 “×”, 해당없는 항목은 “/”로 표시한다.<br>※ 점검항목 내용 중 “설치기준” 및 “설치상태”에 대한 점검은 정상적인 작동 가능 여부를 포함한다.<br>※ ‘비고’란에는 특정소방대상물의 위치․구조․용도 및 소방시설의 상황 등이 이 표의 항목대로 기재하기<br>&nbsp;&nbsp;&nbsp;&nbsp;곤란하거나 이 표에서 누락된 사항을 기재한다.(이하 같다)</div>`
}

/** 점검표 전용 용지 푸터 — 원문(:513)은 '[백상지(80g/㎡)]' 단독 표기(공용 pageFooter와 문안이 다르다) */
function sheetPageFooter(): string {
  return '<div class="footnote">210mm×297mm [백상지(80g/㎡)]</div>'
}

// 페이지 분할 예산(대략 줄 수) — @page A4 15mm/13mm 여백, 8.5pt tight 행 기준 보수 추정.
// 첫 쪽은 제목 오버헤드, 꼬리(비고+각주 5줄)는 TAIL_W 예산을 마지막 쪽에 확보한다.
const SHEET_PAGE_W_FIRST = 34
const SHEET_PAGE_W_NEXT = 38
const TAIL_W = 9

// ── 부속 — 설비별 점검표 (22 S12 — 설비당 독립 문서·자체 쪽번호) ─────────────
// 법정 원문은 점검표마다 독립 쪽번호 축을 갖는다((7쪽 중 N쪽) 뒤로 (3쪽 중 1쪽)이 설비마다
// 새로 시작 — P-18). 설비당 1개 이상의 page를 만들고 각 page에 자체 (N쪽 중 M쪽) 헤더,
// 마지막 page에 꼬리(비고+각주, S4)를 붙인다. 수록 규칙은 Q-1·Q-4·Q-5 — 전 항목 수록,
// 무응답 공란, 응답 0건 설비도 서식은 온전히 찍는다(시트 선별은 조립부의 설치 설비 축).
function sheetItemPages(sections: Report4SheetSection[]): string[] {
  const pages: string[] = []
  for (const s of sections) {
    // 1) 행 조각을 예산 단위로 쪽에 배분 — 분할을 CSS 흐름에 맡기지 않아야 M/N을 계산할 수 있다
    const pieces = sheetItemRowPieces(s.items)
    const chunks: SheetRowPiece[][] = []
    let cur: SheetRowPiece[] = []
    let used = 0
    let cap = SHEET_PAGE_W_FIRST
    for (const p of pieces) {
      if (cur.length && used + p.w > cap) {
        chunks.push(cur)
        cur = []; used = 0; cap = SHEET_PAGE_W_NEXT
      }
      cur.push(p); used += p.w
    }
    if (cur.length || chunks.length === 0) chunks.push(cur)
    // 꼬리가 마지막 쪽에 안 들어가면 꼬리 전용 쪽을 하나 더 만든다
    const tailOwnPage = used + TAIL_W > cap && chunks[chunks.length - 1].length > 0
    const total = chunks.length + (tailOwnPage ? 1 : 0)

    // 2) 쪽 렌더 — 설비 제목은 첫 쪽만, 3열 머리행은 매 쪽 반복, 쪽번호는 설비별 독립 축(R-7)
    const title = `${s.no ? `${s.no}. ` : ''}${esc(s.name)} 점검표`
    const tableOf = (rows: SheetRowPiece[]) => `<table class="form tight">
  <colgroup><col style="width:24mm"><col><col style="width:16mm"></colgroup>
  <thead><tr><th>번호</th><th>점검항목</th><th>점검결과</th></tr></thead>
  <tbody>
  ${rows.map(p => p.html).join('\n  ')}
  </tbody>
</table>`
    chunks.forEach((rows, i) => {
      const head = i === 0
        ? `<h1 class="doc-title" style="font-size:13pt; letter-spacing:.05em; margin:4px 0 6px;">${title}</h1>\n`
        : ''
      const tail = !tailOwnPage && i === chunks.length - 1 ? `\n${sheetTail()}` : ''
      pages.push(`
${pageHeader(null, `(${total}쪽 중 ${i + 1}쪽)`)}
${head}${tableOf(rows)}${tail}
${sheetPageFooter()}`)
    })
    if (tailOwnPage) {
      pages.push(`
${pageHeader(null, `(${total}쪽 중 ${total}쪽)`)}
${sheetTail()}
${sheetPageFooter()}`)
    }
  }
  return pages
}

// ── 목차 (22 S3·S6 — Q-3·Q-7) ────────────────────────────────────────────────
// 표기는 시트 제목 한 줄(대분류만 — image-59와 동일, 중분류·대괄호 그룹은 올리지 않는다).
// 법정 번호 유지(1·15·21·31 — 재번호 금지). 본문과 같은 sections 배열을 받으므로 둘이 어긋날 수 없다.
// 근거: 추출본 446행 '(작성요령) 목차에는 점검을 실시하고자 하는 소방시설명만을 순서대로 기재한다'.
// 펌프성능시험은 값이 있을 때만 조건부 1줄(Q-11 — 측정 기록이라 빈 표를 만들지 않는 현행 규약 유지).
function tocPage(sections: Report4SheetSection[], hasPumpTest: boolean): string[] {
  if (!sections.length) return []
  const lines = sections.map(s => `${s.no ? `${s.no}. ` : ''}${esc(s.name)} 점검표`)
  if (hasPumpTest) lines.push('펌프성능시험')
  return [`
${pageHeader(null, '(목차)')}
<h1 class="doc-title" style="letter-spacing:.5em;">목  차</h1>
<table class="form">
  <tbody>
  ${lines.map(l => `<tr><td style="padding:7px 10px; border-left:none; border-right:none; border-top:none;">${l}</td></tr>`).join('\n  ')}
  </tbody>
</table>
${pageFooter()}`]
}

/** ※ 펌프성능시험 — 법정 별지 4호서식에 원래 있는 표 (소방계획서_21 R5-7 후속).
 *  37시트 엑셀만 담고 있던 실측치의 문서 출력처다. 값이 없으면 쪽 자체를 만들지 않는다 —
 *  빈 표를 찍으면 '측정 안 함'과 '측정했는데 공란'이 구분되지 않는다. */
function pumpTestPages(rows: Report4PumpRow[]): string[] {
  const bySheet = new Map<number, Report4PumpRow[]>()
  for (const r of rows) bySheet.set(r.sheetNo, [...(bySheet.get(r.sheetNo) ?? []), r])
  if (bySheet.size === 0) return []

  const n = (v: number | null | undefined) => (v == null ? '' : String(v))
  const tables = [...bySheet.entries()].sort((a, b) => a[0] - b[0]).map(([sheetNo, rs]) => {
    const main = rs.find(r => r.pumpKind === '주')
    const cell = (k: '주' | '예비', f: keyof Report4PumpRow) => n(rs.find(r => r.pumpKind === k)?.[f] as number | null)
    const setPress = rs.map(r =>
      `ㅇ${r.pumpKind}펌프 기동: ${n(r.setStartPress)} MPa / 정지: ${n(r.setStopPress)} MPa`).join('<br>')
    return `
<div class="sec-title">${esc(PUMP_SHEET_LABELS[sheetNo] ?? `설비 ${sheetNo}`)} — ※ 펌프성능시험 <span style="font-weight:normal">(펌프 명판 및 설계치 참조)</span></div>
<table class="form tight">
  <colgroup><col style="width:26mm"><col><col><col><col style="width:62mm"></colgroup>
  <thead><tr>
    <th>구분</th><th>체절운전</th><th>정격운전<br>(100%)</th><th>정격유량의<br>150% 운전</th><th>적정 여부</th>
  </tr></thead>
  <tbody>
    <tr>
      <td class="center">토출량<br>(ℓ/min) 주</td>
      <td class="center">${cell('주', 'shutoffFlow')}</td><td class="center">${cell('주', 'ratedFlow')}</td><td class="center">${cell('주', 'overFlow')}</td>
      <td rowspan="4" class="small">
        ${PUMP_JUDGE_LABELS.map((l, i) => `${esc(l)} ( ${main?.judges[i] ?? ''} )`).join('<br>')}
        <div style="margin-top:4px">${setPress}</div>
        ${main?.note ? `<div style="margin-top:4px">비고: ${esc(main.note)}</div>` : ''}
      </td>
    </tr>
    <tr><td class="center">예비</td>
      <td class="center">${cell('예비', 'shutoffFlow')}</td><td class="center">${cell('예비', 'ratedFlow')}</td><td class="center">${cell('예비', 'overFlow')}</td></tr>
    <tr><td class="center">토출압<br>(MPa) 주</td>
      <td class="center">${cell('주', 'shutoffPress')}</td><td class="center">${cell('주', 'ratedPress')}</td><td class="center">${cell('주', 'overPress')}</td></tr>
    <tr><td class="center">예비</td>
      <td class="center">${cell('예비', 'shutoffPress')}</td><td class="center">${cell('예비', 'ratedPress')}</td><td class="center">${cell('예비', 'overPress')}</td></tr>
  </tbody>
</table>`
  })

  return [`
${pageHeader(null, '(펌프성능시험)')}
<h1 class="doc-title" style="font-size:13pt; letter-spacing:.1em; margin:4px 0 6px;">펌프성능시험</h1>
${tables.join('\n')}
${pageFooter()}`]
}

/** 별지 4호 — 소방시설등점검표 (7쪽 + 부속 설비별 점검표 + 펌프성능시험) */
export function renderReport4(d: Report4Data, opts: Report4RenderOpts = {}): string {
  const h = !!opts.highlight
  const secs = renderSpecSections(d.specs ?? {}, {
    highlight: h, numbering: 'annex4',
    derived: { installed: d.ledgerCodes ?? [], building: d.building },
  })
  return renderDocument({
    title: `${d.customerName} 별지 4호 소방시설등점검표`,
    css: CSS,
    pages: [
      page1(d, h), page2(d, h),
      specPage(3, secs.slice(0, 2), true), specPage(4, secs.slice(2, 3)),
      specPage(5, secs.slice(3, 5)), specPage(6, secs.slice(5, 7)),
      specPage(7, secs.slice(7)),
      // 목차는 신규 저장 타입이 아니라 같은 문서의 한 쪽(22 S6-1) — 색인 대상인 부속 점검표 직전
      ...tocPage(d.sheetSections ?? [], (d.pumpRows ?? []).length > 0),
      ...sheetItemPages(d.sheetSections ?? []),
      ...pumpTestPages(d.pumpRows ?? []),
    ],
  })
}
