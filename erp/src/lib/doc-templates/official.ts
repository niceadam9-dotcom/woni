/** 결과보고서 제출 공문 — 신규 ANNEX 타입 'official' (소방계획서_22 S7, image-66 근접 재현 — Q-7)
 *
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 lib/annex-cover-official.assembleOfficial.
 *  문서번호는 수동+자동 제안(Q-14) — annex_inputs(kind 'official')의 docNo가 있으면 그 값,
 *  없으면 '승 진 {YYMM}-{동월 최대 일련+1}' 제안값을 쓰고 missing[]으로 알린다.
 *  결재란(선결·지시·접수·결재·공람·처리과·담당자)은 빈 칸 정적 렌더(§3-9). */

import { renderDocument, esc } from './base'

export type OfficialData = {
  company: { name: string; address: string; phone: string; fax: string }
  /** 문서번호 — '승 진 2511-977' */
  docNo: string
  /** 발신일자 — '2025년 11월' */
  sendDate: string
  /** 수신 — 건물명(고객명) */
  recipient: string
  /** 참조 — 기본 '소방안전관리자 및 관계인' */
  reference: string
  /** 발신 — '㈜승진소방 ENG' (상단 메타의 '발 신 :' 칸) */
  sender: string
  /** 하단 발신 명의 (147) — 사내 서식 재현. 상단 레터헤드와 **다른 값일 수 있다**:
   *  레터헤드는 약식 상호, 명의는 법인 정식 상호(주식회사 …). 회사정보에서 따로 관리한다. */
  senderSign: { name: string; title: string; rep: string }
  year: number
  /** 점검종류 라벨 — 제목·붙임 문구 가변(S7-1, S5-10과 동일 원리) */
  typeLabel: string
}

const CSS = `
  .of-head { text-align: center; }
  .of-head .nm { font-size: 16pt; font-weight: bold; letter-spacing: .1em; }
  .of-head .ct { font-size: 8.5pt; margin-top: 2px; }
  .of-rule { border-bottom: 2.2pt solid #000; margin: 2mm 0 0; }
  .of-rule2 { border-bottom: .6pt solid #000; margin: .8mm 0 8mm; }
  .of-meta { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; }
  table.of-fields { border-collapse: collapse; font-size: 10.5pt; }
  table.of-fields td { padding: 1.8mm 0; vertical-align: top; }
  table.of-fields td.k { width: 24mm; letter-spacing: .1em; }
  table.of-appr { border-collapse: collapse; font-size: 8.5pt; }
  table.of-appr th, table.of-appr td { border: .6pt solid #000; text-align: center; vertical-align: middle; padding: 0 2px; }
  table.of-appr th { font-weight: normal; background: #fff; }
  .of-subject { font-size: 12pt; font-weight: bold; margin: 8mm 0 2mm; letter-spacing: .05em;
                border-top: .6pt solid #000; border-bottom: .6pt solid #000; padding: 2.5mm 2mm; }
  .of-body { font-size: 11pt; line-height: 2.1; margin-top: 6mm; }
  .of-body p { margin: 0 0 3mm; text-indent: 2em; }
  .of-attach { font-size: 11pt; margin-top: 12mm; }
  .of-end { text-align: center; margin-top: 4mm; letter-spacing: 1em; font-size: 11pt; }
  /* 발신 명의 — 사내 서식(갑지 공문)은 본문보다 크고 굵게, 가운데. '끝.' 아래로 충분히 띄운다 */
  .of-sign { text-align: center; margin-top: 26mm; font-size: 14pt; font-weight: bold; line-height: 1.7; }
`

/** 결재란 — image-66: 선결/지시 상단, 접수(일자·시간/번호)+결재, 처리과/담당자+공람. 전부 빈 칸 */
function approvalBox(): string {
  return `<table class="of-appr">
  <colgroup><col style="width:9mm"><col style="width:11mm"><col style="width:17mm"><col style="width:9mm"><col style="width:15mm"><col style="width:15mm"></colgroup>
  <tr><th style="height:10mm">선결</th><td colspan="2"></td><th>지시</th><td></td><td></td></tr>
  <tr><th rowspan="2" style="height:16mm">접수</th><th>일자<br>시간</th><td></td><th rowspan="2">결재</th><td rowspan="2" colspan="2"></td></tr>
  <tr><th>번호</th><td style="height:8mm"></td></tr>
  <tr><th colspan="2">처 리 과</th><td></td><th rowspan="2">공람</th><td rowspan="2" colspan="2"></td></tr>
  <tr><th colspan="2">담 당 자</th><td style="height:7mm"></td></tr>
</table>`
}

/** 하단 발신 명의 — '주식회사 승진소방ENG / 대표이사 김흥준(직인생략)' 2줄.
 *  상호가 아예 없으면(회사정보 미등록) 블록을 만들지 않는다 — 이름 없는 명의를 찍는 것보다 낫다.
 *  (직인생략)은 고정 문구다: 직인 이미지 기능이 없어 실제로 생략하고 있고, 생기면 그때 갈린다. */
function signBlock(s: OfficialData['senderSign']): string {
  if (!s.name.trim()) return ''
  // 둘째 줄은 **대표자 이름이 있을 때만**. 직함만 남으면 '대표이사(직인생략)'처럼
  // 사람 없는 명의가 찍힌다 — 상호 한 줄로 끝내는 편이 낫다(조립부가 missing으로 알린다).
  const rep = s.rep.trim()
  const line2 = rep ? `${[s.title.trim(), rep].filter(Boolean).join(' ')}(직인생략)` : ''
  return `<div class="of-sign">${esc(s.name)}${line2 ? `<br>${esc(line2)}` : ''}</div>`
}

export function renderOfficial(d: OfficialData): string {
  const contact = [
    d.company.address ? esc(d.company.address) : '',
    d.company.phone ? `Tel) ${esc(d.company.phone)}` : '',
    d.company.fax ? `Fax) ${esc(d.company.fax)}` : '',
  ].filter(Boolean).join(' / ')
  return renderDocument({
    title: `${d.recipient} ${d.year}년 소방시설 ${d.typeLabel} 결과보고서 제출 공문`,
    css: CSS,
    pages: [`
<div class="of-head">
  <div class="nm">${esc(d.company.name)}</div>
  <div class="ct">${contact}</div>
</div>
<div class="of-rule"></div>
<div class="of-rule2"></div>
<div class="of-meta">
  <table class="of-fields">
    <tr><td class="k">문서번호 :</td><td>${esc(d.docNo)}</td></tr>
    <tr><td class="k">발신일자 :</td><td>${esc(d.sendDate)}</td></tr>
    <tr><td class="k">수　 신 :</td><td>${esc(d.recipient)}</td></tr>
    <tr><td class="k">참 　조 :</td><td>${esc(d.reference)}</td></tr>
    <tr><td class="k">발 　신 :</td><td>${esc(d.sender)}</td></tr>
  </table>
  ${approvalBox()}
</div>
<div class="of-subject">제　　목 :  ${d.year} 년 소방시설 ${esc(d.typeLabel)} 결과보고서 제출</div>
<div class="of-body">
  <p>1. 귀 대상물의 무궁한 발전을 기원합니다.</p>
  <p>2. 귀 대상물의 소방시설점검에 대한 결과보고서를 아래의 붙임과 같이 제출하는 바입니다.</p>
</div>
<div class="of-attach">붙 임 : 1. 소방시설 ${esc(d.typeLabel)} 결과보고서 1부</div>
<div class="of-end">끝.</div>
${signBlock(d.senderSign)}`],
  })
}
