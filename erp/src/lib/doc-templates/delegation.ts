/** 점검결과 보고서 제출용 위임장 — 신규 ANNEX 타입 'delegation' (소방계획서_22 S8)
 *
 *  서식 원천: 승진소방 실무 엑셀 '보고서 갑지.xls'의 [위임장] 탭 실측(2026-08-15 추출) —
 *  법정 별지 서식이 아니라 사내 실무 서식이므로 §0 기준 재량 영역, Q-7 원칙(샘플 근접)으로 재현.
 *  샘플의 띄어쓰기 오탈자("본인은소방시설"·"및관리")는 교정하되 문구·구성은 축자 유지.
 *
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 lib/annex-cover-official.assembleDelegation.
 *  생년월일 등 시스템에 없는 값은 annex_inputs(annex_no 'delegation')의 수동 입력이 원천이며,
 *  Q-4 철학대로 값이 없어도 서식은 온전히 찍고 칸만 비운다. */

import { renderDocument, esc } from './base'

export type DelegationData = {
  /** 점검종류 라벨 — '작동점검' | '최초점검' | '종합점검' (체크박스 √ 위치 결정) */
  typeLabel: string
  /** 특정소방대상물 관계인(본인) */
  owner: { name: string; position: string; phone: string; birth: string }
  /** 소방시설관리업체(대리인) */
  agent: { name: string; position: string; phone: string; birth: string }
  /** 점검일자 — '2026.12.20 부터 ~ 2026.12.20 까지' */
  periodLabel: string
  /** 점검 일수 — '1일' (산출 불가 시 공란) */
  daysLabel: string
  /** 위임 일자 표기 — '2026년 7월 16일' */
  submitDate: string
  /** 관할 소방서 — '양평' (뒤에 고정 문구 "소방서(본부) 귀하"가 붙는다) */
  station: string
}

const CSS = `
  .dg-titlebox { display: flex; justify-content: center; align-items: center; gap: 4mm; margin: 6mm 0 8mm; }
  .dg-titlebox .t { font-size: 16pt; font-weight: bold; letter-spacing: .08em; }
  table.dg-ck { border-collapse: collapse; font-size: 9pt; }
  table.dg-ck td { border: .6pt solid #000; padding: .4mm 1.6mm; text-align: center; }
  table.dg-party { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5pt; }
  table.dg-party th, table.dg-party td { border: .6pt solid #000; padding: 2.2mm 2mm; vertical-align: middle; }
  table.dg-party th { font-weight: normal; letter-spacing: .1em; background: #f4f4f4; }
  table.dg-party th.hd { font-weight: bold; text-align: center; letter-spacing: .05em; }
  .dg-sechd { border: .6pt solid #000; border-top: none; background: #f4f4f4; text-align: center;
              font-weight: bold; letter-spacing: .3em; padding: 1.8mm 0; font-size: 10.5pt; }
  .dg-body { border: .6pt solid #000; border-top: none; padding: 5mm 6mm; font-size: 11pt; line-height: 2; }
  /* 날짜·관계인·귀하는 원본 서식('보고서 갑지.xls' [위임장] 탭)에서 셋 다 **오른쪽 끝**에 맞춰져 있다.
     종전엔 날짜·관계인이 가운데, 귀하가 왼쪽이라 원본과 어긋났다(2026-08-20 대조). */
  .dg-date { text-align: right; font-size: 11.5pt; margin: 10mm 0 6mm; }
  .dg-sign { text-align: right; font-size: 11.5pt; margin-bottom: 10mm; }
  .dg-sign .nm { display: inline-block; min-width: 30mm; text-align: center; }
  .dg-to { text-align: right; font-size: 13pt; font-weight: bold; margin: 4mm 0 10mm; }
  .dg-to .st { display: inline-block; min-width: 24mm; text-align: center; border-bottom: .6pt solid #000; }
  table.dg-note { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5pt; }
  table.dg-note th, table.dg-note td { border: .6pt solid #000; padding: 2mm; vertical-align: middle; }
  table.dg-note th { width: 22mm; font-weight: normal; letter-spacing: .1em; background: #f4f4f4; text-align: center; }
  .dg-caution { border: .6pt solid #000; border-top: none; padding: 2mm 3mm; font-size: 9pt; line-height: 1.7; }
  .dg-caution p { margin: 0 0 1mm; }
`

/** 점검종류 체크박스 3행 — 샘플 D1:J3 재현. typeLabel과 일치하는 행에 √ */
function typeChecks(typeLabel: string): string {
  const rows = [['작동', '작동점검'], ['최초', '최초점검'], ['종합', '종합점검']]
  return `<table class="dg-ck">${rows.map(([label, full]) =>
    `<tr><td>[${typeLabel === full ? '√' : '&nbsp;&nbsp;'}]</td><td>${label}</td></tr>`).join('')}</table>`
}

export function renderDelegation(d: DelegationData): string {
  const partyRow = (k: string, a: string, b: string) =>
    `<tr><th>${k}</th><td>${esc(a)}</td><th>${k}</th><td>${esc(b)}</td></tr>`
  return renderDocument({
    title: `${d.typeLabel} 결과보고서 제출용 위임장`,
    css: CSS,
    pages: [`
<div class="dg-titlebox">
  <span class="t">소방시설등</span>
  ${typeChecks(d.typeLabel)}
  <span class="t">점검결과 보고서 제출용 위임장</span>
</div>
<table class="dg-party">
  <colgroup><col style="width:20mm"><col><col style="width:20mm"><col></colgroup>
  <tr><th class="hd" colspan="2">특정소방대상물 관계인(본인)</th><th class="hd" colspan="2">소방시설관리업체(대리인)</th></tr>
  ${partyRow('성　명', d.owner.name, d.agent.name)}
  ${partyRow('직　위', d.owner.position, d.agent.position)}
  ${partyRow('연락처', d.owner.phone, d.agent.phone)}
  ${partyRow('생년월일', d.owner.birth, d.agent.birth)}
  <tr><th>점검일자</th><td colspan="3">${esc(d.periodLabel)}${d.daysLabel ? ` （${esc(d.daysLabel)}）` : ''}</td></tr>
</table>
<div class="dg-sechd">위 임 내 용</div>
<div class="dg-body">
  상기 본인은 「소방시설 설치 및 관리에 관한 법률」 제22조 제1항에 따라 실시한 소방시설등의 자체점검과
  관련하여 대리인이 실시한 자체점검 내용 일체를 확인하였으며, 같은 법 시행규칙 제23조에 따른
  점검결과보고서의 제출을 대리인에게 위임합니다.
</div>
<div class="dg-date">${esc(d.submitDate)}</div>
<div class="dg-sign">관계인　<span class="nm">${esc(d.owner.name)}</span>　(서명 또는 인)</div>
<div class="dg-to"><span class="st">${esc(d.station)}</span> 소방서(본부) 귀하</div>
<table class="dg-note">
  <tr><th>붙임서류</th><td>소방시설등 점검결과 보고서 제출을 위임한 관계인 신분증명서 사본 1부</td></tr>
</table>
<div class="dg-sechd" style="border-top:none">유 의 사 항</div>
<div class="dg-caution">
  <p>1. 다른 사람의 인장 도용 등 허위로 위임장을 작성하여 신청할 경우에는 「형법」 제231조와 제232조에 따라
     사문서 위조ㆍ변조죄로 5년 이하의 징역 또는 1천만원 이하의 벌금에 처하게 됩니다.</p>
  <p>2. 자체점검 결과보고서를 보고기한 내에 제출하지 않으면, 이를 대리인에게 위임한 경우라도
     「질서위반행위규제법」 제11조 제1항에 따라 제출의무가 있는 관계인이 100만원 이하의 과태료를 부과받게 됩니다.</p>
</div>
<div class="footnote">210mm×297mm[백상지 80g/㎡(재활용품)]</div>`],
  })
}
