/** 설비 QR 태그 — 코드 발급 규칙 · 수기 조회 정규화 · 라벨 HTML (통합계획 C3 3단계 = 설비 QR 절 1단계, 2026-10-03)
 *
 *  규격(비교진단 「설비 QR 해결방안」 절):
 *   · 페이로드 = URL `{기준 URL}/t/{tag_code}`. 코드는 불투명(고객·건물 정보 없음) — SaaS로 가도 회사와 무관.
 *   · tag_code는 qty=1 행에만(172 CHECK equipment_assets_tag_single). 재발급하지 않는다 — 이력 연속성이 코드에 묶인다.
 *   · 라벨에는 사람이 읽는 앞 6자를 함께 찍는다 — 라벨이 떨어지거나 스캔이 안 되면 그 6자로 같은 카드에 간다.
 *  코드 알파벳은 Crockford base32(0·1과 헷갈리는 I·L·O, 그리고 U 제외) 대문자 8자. 32^8 ≈ 1.1조. */
import QRCode from 'qrcode'
import { CATEGORY_LABEL, type EquipmentCategory } from '@/lib/equipment-lifespan'

export const TAG_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const TAG_LEN = 8
export const MANUAL_PREFIX_LEN = 6
export const LABELS_PER_REQUEST = 240   // A4 10매 — 동기 변환(Gotenberg) 상한

export function newTagCode(rand: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rand(TAG_LEN)
  let s = ''
  for (let i = 0; i < TAG_LEN; i++) s += TAG_ALPHABET[b[i] % 32]
  return s
}

/** 사람이 친 코드 → 정규형. 소문자·공백·하이픈 허용, 헷갈리는 글자는 Crockford 규칙대로 바꾼다(O→0, I·L→1). 알파벳 밖이면 null */
export function normalizeTagInput(v: string | null | undefined): string | null {
  const s = (v ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!s || s.length > TAG_LEN) return null
  for (const ch of s) if (!TAG_ALPHABET.includes(ch)) return null
  return s
}

/** 라벨에 찍는 사람용 표기 — 앞 6자 굵게 + 뒤 2자 */
export const tagHuman = (code: string) => `${code.slice(0, MANUAL_PREFIX_LEN)}-${code.slice(MANUAL_PREFIX_LEN)}`

/** category는 개체 라벨, kindLabel은 지점(178) 라벨의 머리글 — 지점은 category가 없어 kindLabel(지점 이름)을 쓴다 */
export type LabelItem = { tagCode: string; category: EquipmentCategory | null; kindLabel?: string; location: string | null; subType: string | null; buildingName: string | null; manufacturedOn: string | null }

/** A4 라벨지 격자 — 3열 × 8행 = 24칸(칸 64×33.9mm). 실물 라벨지에 맞출 때는 이 상수만 고친다(인쇄 시험 후). */
export const LABEL_SHEET = { cols: 3, rows: 8, cellW: 64, cellH: 33.9, marginTop: 13, marginLeft: 7.5, gapX: 2.5, gapY: 0 } as const

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function renderLabelSheetHtml(items: ReadonlyArray<LabelItem>, baseUrl: string, opts: { title?: string } = {}): Promise<string> {
  const L = LABEL_SHEET
  const per = L.cols * L.rows
  const svgs = await Promise.all(items.map(i => QRCode.toString(`${baseUrl.replace(/\/$/, '')}/t/${i.tagCode}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })))
  const cell = (i: LabelItem, k: number) => `
<div class="cell" data-tag="${i.tagCode}">
  <div class="qr">${svgs[k]}</div>
  <div class="txt">
    <div class="cat">${esc(i.kindLabel ?? (i.category ? CATEGORY_LABEL[i.category] : ''))}${i.subType ? ` <span class="sub">${esc(i.subType)}</span>` : ''}</div>
    <div class="loc">${esc([i.buildingName, i.location].filter(Boolean).join(' · ') || '위치 미기재')}</div>
    ${i.manufacturedOn ? `<div class="mfg">제조 ${esc(i.manufacturedOn.slice(0, 7))}</div>` : ''}
    <div class="code"><b>${esc(i.tagCode.slice(0, MANUAL_PREFIX_LEN))}</b>-${esc(i.tagCode.slice(MANUAL_PREFIX_LEN))}</div>
  </div>
</div>`
  const pages: string[] = []
  for (let p = 0; p < items.length; p += per) {
    pages.push(`<section class="sheet">${items.slice(p, p + per).map((it, j) => cell(it, p + j)).join('')}</section>`)
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(opts.title ?? '설비 QR 라벨')}</title>
<style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: 'Noto Sans CJK KR', 'Noto Sans KR', 'Malgun Gothic', sans-serif }
.sheet { width: 210mm; height: 297mm; padding: ${L.marginTop}mm 0 0 ${L.marginLeft}mm; display: grid;
  grid-template-columns: repeat(${L.cols}, ${L.cellW}mm); grid-auto-rows: ${L.cellH}mm; column-gap: ${L.gapX}mm; row-gap: ${L.gapY}mm;
  page-break-after: always; break-after: page }
.sheet:last-child { page-break-after: auto; break-after: auto }
.cell { display: flex; align-items: center; gap: 2mm; padding: 2mm; overflow: hidden }
.qr { width: 26mm; height: 26mm; flex: none } .qr svg { width: 100%; height: 100% }
.txt { min-width: 0; font-size: 7.5pt; line-height: 1.25 }
.cat { font-weight: 700; font-size: 8pt } .sub { font-weight: 400 }
.loc, .mfg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.code { margin-top: 1mm; font-family: 'DejaVu Sans Mono', 'Consolas', monospace; font-size: 10pt; letter-spacing: .05em }
</style></head><body>${pages.join('')}</body></html>`
}
