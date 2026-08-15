/** 점검 결과보고서 표지 — 신규 ANNEX 타입 'cover' (소방계획서_22 S5, image-65 근접 재현 — Q-7)
 *
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 lib/annex-cover-official.assembleCover.
 *  제목은 점검종류 가변(S5-10) — "작동점검" 하드코딩 금지: 종합 건에 작동 표지가 나가면 납품 사고다.
 *  사진·로고는 상대경로 참조(<img src="cover.jpg">) + assets 멀티파트 첨부가 PDF 경로,
 *  미리보기는 서명 URL을 그대로 src로 받는다(assembleCover가 분기) — fire-plan-template imgBlock 이식(P-9 정정). */

import { renderDocument, esc } from './base'

export type CoverData = {
  year: number
  /** 점검종류 라벨 — '작동점검' | '종합점검' | '최초점검' (assemble이 ckOp/ckInitial 축에서 파생) */
  typeLabel: string
  buildingName: string
  /** 건물 사진 src — PDF: 자산 파일명(cover.jpg) / 미리보기: 서명 URL / null: 자리표시 */
  photoSrc: string | null
  /** 발행 연월 — '2025년 11월' */
  issueLabel: string
  company: {
    name: string
    address: string
    phone: string
    fax: string
    /** 로고 src — 규약은 photoSrc와 동일. null이면 로고 칸 생략 */
    logoSrc: string | null
  }
}

const CSS = `
  .cover-frame { border: 4.5pt double #1f3864; height: 250mm; padding: 12mm 10mm;
                 display: flex; flex-direction: column; align-items: center; text-align: center; }
  .cover-year { border: .8pt solid #000; display: inline-block; padding: 1.5px 14px; font-size: 11pt; letter-spacing: .2em; }
  .cover-title { font-size: 17pt; font-weight: bold; letter-spacing: .12em; margin: 7mm 0 0; }
  .cover-bldg { border: .8pt solid #000; display: inline-block; padding: 3px 18px; font-size: 13pt;
                font-weight: bold; letter-spacing: .15em; margin-top: 9mm; }
  .cover-photo { margin-top: 10mm; width: 150mm; height: 100mm; display: flex; align-items: center; justify-content: center;
                 border: .6pt solid #999; overflow: hidden; }
  .cover-photo img { width: 100%; height: 100%; object-fit: cover; }
  .cover-photo .ph { color: #999; font-size: 9pt; }
  .cover-issue { font-size: 12pt; letter-spacing: .1em; margin-top: 10mm; }
  .cover-firm { margin-top: auto; border: 1.2pt solid #1f3864; width: 150mm; padding: 4mm 6mm;
                display: flex; align-items: center; gap: 6mm; text-align: left; }
  .cover-firm img { width: 18mm; height: 18mm; object-fit: contain; }
  .cover-firm .nm { font-size: 14pt; font-weight: bold; letter-spacing: .3em; }
  .cover-firm .ct { font-size: 8.5pt; margin-top: 2px; }
`

/** 표지 1쪽 — image-65 구성: 연도 박스 → 제목 → [건물명] → 사진 → 발행 연월 → 레터헤드 */
export function renderCover(d: CoverData): string {
  const photo = d.photoSrc
    ? `<img src="${esc(d.photoSrc)}" alt="">`
    : '<span class="ph">건물 사진 미등록 — 고객 상세 [지도·사진]의 표지 사진 슬롯에 등록하면 실립니다</span>'
  const contact = [
    d.company.phone ? `TEL) ${esc(d.company.phone)}` : '',
    d.company.fax ? `Fax) ${esc(d.company.fax)}` : '',
  ].filter(Boolean).join(' / ')
  return renderDocument({
    title: `${d.buildingName} ${d.year}년 소방시설 ${d.typeLabel} 결과보고서 표지`,
    css: CSS,
    pages: [`
<div class="cover-frame">
  <div><span class="cover-year">${d.year} 년도</span></div>
  <div class="cover-title">소방시설 ${esc(d.typeLabel)} 결과보고서</div>
  <div><span class="cover-bldg">[ ${esc(d.buildingName)} ]</span></div>
  <div class="cover-photo">${photo}</div>
  <div class="cover-issue">${esc(d.issueLabel)}</div>
  <div class="cover-firm">
    ${d.company.logoSrc ? `<img src="${esc(d.company.logoSrc)}" alt="">` : ''}
    <div>
      <div class="nm">${esc(d.company.name)}</div>
      <div class="ct">${contact}</div>
      ${d.company.address ? `<div class="ct">${esc(d.company.address)}</div>` : ''}
    </div>
  </div>
</div>`],
  })
}
