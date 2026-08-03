/** 문서 템플릿 공통 기반 (소방계획서_7 H-1) — 별지 서식·소방계획서 HTML 템플릿의 단일 골격.
 *
 *  원칙(§3-2): 렌더는 순수 함수(데이터 in → HTML out, 조회 없음 — 단위 테스트 대상),
 *  같은 HTML이 화면 미리보기(H-4)와 Gotenberg PDF(convertHtmlToPdf, marginMode 'none')에 그대로 쓰인다.
 *  폰트: Gotenberg 컨테이너 내장 Noto Serif/Sans CJK KR (2026-08-03 확인 — 별도 설치 불필요, Q-3 해소).
 *  브라우저 미리보기는 시스템 명조/고딕 폴백. */

export type DocAsset = { name: string; data: Uint8Array; mime: string }

/** 관공서 서식 공통 print CSS — A4, 괘선 표, 체크박스 표기 */
export const BASE_CSS = `
  @page { size: A4; margin: 15mm 13mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Noto Serif CJK KR", "KoPub Batang", "Nanum Myeongjo", "Batang", serif;
    font-size: 10pt; line-height: 1.45; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .doc-ref { font-size: 8.5pt; }                 /* ■ 서식 출처 표기 */
  .page-no { text-align: right; font-size: 8.5pt; } /* (n쪽 중 제m쪽) */
  h1.doc-title { font-size: 15pt; text-align: center; letter-spacing: .2em; margin: 8px 0 10px; }
  table.form { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.form th, table.form td { border: .6pt solid #000; padding: 3px 5px; vertical-align: middle; word-break: break-all; }
  table.form th { font-weight: normal; background: #f2f2f2; text-align: center; }
  .center { text-align: center; }
  .right { text-align: right; }
  .small { font-size: 8.5pt; }
  .muted { color: #444; }
  .nowrap { white-space: nowrap; }
  .footnote { font-size: 8pt; text-align: center; margin-top: 4px; } /* 210mm×297mm 규격 표기 */
  .missing { background: #fff7cc; }              /* 미입력 하이라이트 — 미리보기 확인용(§4-A-2c ③) */
  img.slot { max-width: 100%; }
`

/** HTML 이스케이프 — 모든 값 주입은 반드시 이걸 거친다 */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 값 또는 공란 — 미입력이면 미리보기 하이라이트(.missing)로 표시. PDF에도 노란 배경이 남지 않도록
 *  highlight=false(기본)면 공란만. 미리보기 렌더에서 highlight=true 전달(§4-A-2c) */
export function val(v: unknown, opts?: { highlight?: boolean }): string {
  const s = String(v ?? '').trim()
  if (s) return esc(s)
  return opts?.highlight ? '<span class="missing">&nbsp;&nbsp;&nbsp;&nbsp;</span>' : ''
}

/** 서식 체크박스 표기 — [ ] / [√] */
export function ck(checked: boolean): string {
  return checked ? '[√]' : '[&nbsp;&nbsp;]'
}

/** 점검결과 표기 — 양호○ / 불량× / 해당없음 / (별지 4호·9호 3쪽 공용) */
export function resultMark(r: 'O' | 'X' | 'N' | null | undefined): string {
  return r === 'O' ? '○' : r === 'X' ? '×' : r === 'N' ? '/' : ''
}

/** 문서 골격 — pages: 쪽 단위 HTML 조각(각각 .page로 감싸 페이지 나눔) */
export function renderDocument(opts: { title: string; css?: string; pages: string[] }): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${opts.css ?? ''}</style>
</head>
<body>
${opts.pages.map(p => `<div class="page">\n${p}\n</div>`).join('\n')}
</body>
</html>`
}

/** 쪽 머리 공통 — 서식 출처(■ …) + (n쪽 중 제m쪽) */
export function pageHeader(docRef: string | null, pageLabel: string): string {
  return `${docRef ? `<div class="doc-ref">■ ${esc(docRef)}</div>` : ''}<div class="page-no">${esc(pageLabel)}</div>`
}

/** 쪽 꼬리 공통 — 용지 규격 표기 */
export function pageFooter(): string {
  return '<div class="footnote">210mm×297mm[백상지(80g/㎡) 또는 중질지(80g/㎡)]</div>'
}
