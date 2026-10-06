/** 공사 완료 사진첩 PDF — 신규 ANNEX 타입 'photoalbum' (2026-10-06 사용자 요청)
 *
 *  본보기: 사용자가 준 `공사 완료 사진첩.hwp` — 표지(제목 상자 → [건물명] → 로고·상호 → 연락처) 뒤에
 *  불량 1건 = 「1. 제목」 + <공사 전><공사 후> 사진 좌우. 렌더는 순수 함수(조회 없음) —
 *  목록은 lib/photo-album(엑셀·한글과 같은 한 벌), 조립은 assemblePhotoAlbum.
 *  사진 src 규약은 표지(cover.ts)와 같다: PDF = 자산 파일명(assets 멀티파트) / 미리보기 = 서명 URL / null = 「사진 없음」. */

import { renderDocument, esc } from './base'

export type PhotoAlbumData = {
  buildingName: string
  company: { name: string; phone: string; fax: string; email: string; logoSrc: string | null }
  items: Array<{ no: number; title: string; beforeSrc: string | null; afterSrc: string | null }>
}

/** A4 세로 한 장에 싣는 건수 — 엑셀 사진첩 시트와 같은 3건 */
export const ALBUM_ITEMS_PER_PAGE = 3

const CSS = `
  .al-cover { height: 262mm; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .al-title { margin-top: 28mm; border: 2.2pt double #8a7a4a; border-radius: 3mm; padding: 4mm 22mm;
              font-size: 24pt; font-weight: bold; letter-spacing: .25em; }
  .al-bldg { margin-top: 62mm; font-size: 16pt; letter-spacing: .1em; }
  .al-firm { margin-top: 58mm; display: flex; align-items: center; justify-content: center; gap: 6mm; }
  .al-firm img { height: 16mm; max-width: 30mm; object-fit: contain; }
  .al-firm .nm { font-size: 20pt; font-weight: bold; letter-spacing: .4em; color: #1d3fbf; }
  .al-contact { margin-top: auto; font-size: 10.5pt; letter-spacing: .03em; word-spacing: .6em; }
  .al-item { height: 85mm; display: flex; flex-direction: column; margin-bottom: 2mm; }
  .al-item h2 { font-size: 11pt; font-weight: bold; margin: 0 0 1.5mm; }
  .al-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 6mm; border: .6pt solid #000; }
  .al-grid > div { border: .6pt solid #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .al-grid img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .al-grid .none { color: #999; font-size: 9pt; }
  .al-grid .lb { font-size: 10pt; }
`

const photoCell = (src: string | null) =>
  `<div>${src ? `<img src="${esc(src)}" alt="">` : '<span class="none">사진 없음</span>'}</div>`

export function renderPhotoAlbum(d: PhotoAlbumData): string {
  const contact = [
    d.company.phone ? `T : ${esc(d.company.phone)}` : '',
    d.company.fax ? `F : ${esc(d.company.fax)}` : '',
    d.company.email ? `email : ${esc(d.company.email)}` : '',
  ].filter(Boolean).join('&emsp;&emsp;')
  const cover = `
<div class="al-cover">
  <div class="al-title">공사 완료 사진첩</div>
  <div class="al-bldg">[&ensp;${esc(d.buildingName)}&ensp;]</div>
  <div class="al-firm">
    ${d.company.logoSrc ? `<img src="${esc(d.company.logoSrc)}" alt="">` : ''}
    <span class="nm">${esc(d.company.name)}</span>
  </div>
  <div class="al-contact">${contact}</div>
</div>`
  const pages: string[] = [cover]
  for (let i = 0; i < d.items.length; i += ALBUM_ITEMS_PER_PAGE) {
    pages.push(d.items.slice(i, i + ALBUM_ITEMS_PER_PAGE).map(it => `
<div class="al-item">
  <h2>${it.no}. ${esc(it.title)}</h2>
  <div class="al-grid">
    ${photoCell(it.beforeSrc)}${photoCell(it.afterSrc)}
    <div class="lb">공사 전</div><div class="lb">공사 후</div>
  </div>
</div>`).join(''))
  }
  return renderDocument({ title: `${d.buildingName} 공사 완료 사진첩`, css: CSS, pages })
}
