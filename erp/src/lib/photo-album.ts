import 'server-only'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractStoragePath, signDefectPhotoMap, signedOf } from '@/lib/defect-photos'
import { getCompanyProfile } from '@/lib/company-profile'
import { formatTel } from '@/lib/format-contact'
import type { DocAsset } from '@/lib/doc-templates/base'
import type { PhotoAlbumData } from '@/lib/doc-templates/photo-album'

/** 「공사 완료 사진첩」 — 불량 1건 = 번호 붙은 제목 + 공사 전 | 공사 후 사진 두 장 (2026-10-06 사용자 요청).
 *
 *  보고서 엑셀(맨 끝 시트)·PDF(묶음 맨 뒤 문서)·한글파일(별도 받기) **세 산출물이 이 한 벌을 쓴다**.
 *  목록·제목·사진 준비를 산출물마다 따로 짜면 같은 회차의 세 문서가 서로 다른 건수를 말한다(D-7).
 *  본보기는 사용자가 준 `공사 완료 사진첩.hwp`(표지 → 「1. 1층 … 불량」 + <공사 전><공사 후>).
 *
 *  ⚠ **불량이 있으면 사진이 0장이어도 사진첩은 나간다**(사용자 지시 2026-10-06 「불량이 있으면 반드시
 *    있어야」). 종전 엑셀 「불량사진」 시트는 사진이 없으면 통째로 빠져 운영 불량 회차 4건 중 2건
 *    (승리주유소·하늘촌)에 아예 없었다. 빈 칸은 「사진 없음」으로 그려 결손이 인쇄물에서 보이게 한다.
 *
 *  목록 축: `inspection_defects`(등록 순). 등록된 불량이 0건인데 점검표 ✕가 있으면 ✕ 항목으로 대신한다
 *  — ⑤ 단계가 미등록 ✕를 막으므로 평소엔 등록 불량이 정본이고, 두 축을 합치면 코드 없는 수기 불량이
 *  ✕ 하나를 덮는 규칙(inspection-step-sync Q-9) 때문에 같은 불량이 두 번 실린다. */

export type AlbumItem = {
  no: number
  title: string
  /** 저장값(경로 또는 구형 공개 URL) — 사진이 없으면 null */
  before: string | null
  after: string | null
}

export type PreparedPhoto = { jpeg: Uint8Array; w: number; h: number }

/** Storage에서 바이트만 받으면 되므로 SupabaseClient 전체를 요구하지 않는다 — 프로브가 스텁을 넘긴다 */
export type PhotoStorage = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: unknown }>
    }
  }
}

const BUCKET = 'inspection-defects'
/** 사진 장변 상한(px)과 JPEG 품질 — 1200px q80이면 장당 대략 150~250KB */
const LONG_EDGE = 1200
const JPEG_Q = 80
/** 다운로드 동시 실행 수 — 무제한 Promise.all은 sharp 네이티브 디코드가 RSS를 튀긴다 */
const CONCURRENCY = 4
/** 사진첩이 감당하는 불량 건수 상한과 사진 총 바이트 예산 */
export const ALBUM_MAX_ITEMS = 60
const PHOTO_BUDGET = 12 * 1024 * 1024

export type AlbumDefectRow = {
  defect_code: string | null
  defect_name: string | null
  photo_url: string | null
  after_photo_url: string | null
}

/** 제목 — 불량명. 이름이 코드와 같으면(카탈로그에 없던 ✕ 자동 등록의 자리표시자) 점검표 항목명으로,
 *  그것도 없으면 코드. 본보기 사진첩은 점검번호 없이 「1층 피부관리 소화기 충압 불량」처럼 쓴다 */
export function albumTitleOf(d: Pick<AlbumDefectRow, 'defect_code' | 'defect_name'>, itemName?: string | null): string {
  const code = (d.defect_code ?? '').trim()
  const name = (d.defect_name ?? '').trim()
  if (name && name !== code) return name
  return (itemName ?? '').trim() || code || '(불량명 없음)'
}

/** 등록 불량 → 사진첩 목록(순수 함수 — 프로브가 DB 없이 돈다) */
export function albumItemsFromDefects(
  defects: AlbumDefectRow[], itemNameByCode?: Map<string, string>,
): AlbumItem[] {
  return defects.map((d, i) => ({
    no: i + 1,
    title: albumTitleOf(d, d.defect_code ? itemNameByCode?.get(d.defect_code) : null),
    before: extractStoragePath(d.photo_url) ? d.photo_url : null,
    after: extractStoragePath(d.after_photo_url) ? d.after_photo_url : null,
  }))
}

/** 회차의 사진첩 목록. 불량이 없으면 빈 배열 — 그때만 사진첩이 빠진다 */
export async function loadPhotoAlbumItems(admin: SupabaseClient, inspectionId: string): Promise<AlbumItem[]> {
  const { data, error } = await admin.from('inspection_defects')
    .select('defect_code, defect_name, photo_url, after_photo_url')
    .eq('inspection_id', inspectionId).order('created_at', { ascending: true }).order('id', { ascending: true })
  if (error) throw new Error(`불량 조회 실패: ${error.message}`)
  const defects = (data ?? []) as AlbumDefectRow[]

  // 항목명(자리표시자 치유·✕ 대체용) — 필요할 때만 카탈로그를 읽는다
  const needNames = defects.length === 0 || defects.some(d => d.defect_code && (d.defect_name ?? '').trim() === d.defect_code)
  let names = new Map<string, string>()
  const loadNames = async () => {
    const { getAllSheetItems } = await import('@/lib/sheet-catalog')
    names = new Map((await getAllSheetItems()).map(i => [i.item_code, i.item_name]))
  }

  if (defects.length > 0) {
    if (needNames) await loadNames()
    return albumItemsFromDefects(defects, names)
  }
  const { data: xs, error: xErr } = await admin.from('inspection_sheet_responses')
    .select('item_code').eq('inspection_id', inspectionId).eq('result', 'X')
  if (xErr) throw new Error(`점검표 ✕ 조회 실패: ${xErr.message}`)
  const codes = [...new Set(((xs ?? []) as Array<{ item_code: string }>).map(r => r.item_code))].sort()
  if (codes.length === 0) return []
  await loadNames()
  return albumItemsFromDefects(codes.map(c => ({ defect_code: c, defect_name: null, photo_url: null, after_photo_url: null })), names)
}

/** 다운로드 → EXIF 회전 굽기 → 축소 → JPEG 통일.
 *  ⚠ 치수는 `toBuffer({resolveWithObject:true})`의 info(= **회전 후**)에서 얻는다 — `metadata()`는
 *    회전 전이라 휴대폰 세로 사진이 가로 상자에 눌린다.
 *  ⚠ 버킷에는 JPEG만 있지 않다(작은 PNG/WebP는 원본 통과) — 엑셀 [Content_Types]·한글 BinData가
 *    확장자로 형식을 판단하므로 재인코딩은 선택이 아니라 필수다. */
async function prepPhoto(store: PhotoStorage, stored: string | null): Promise<PreparedPhoto> {
  const path = extractStoragePath(stored)
  if (!path) throw new Error('경로없음')
  const { data, error } = await store.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('다운로드실패')
  const raw = new Uint8Array(await data.arrayBuffer())
  if (raw.byteLength === 0) throw new Error('0바이트')
  try {
    const { data: jpeg, info } = await sharp(Buffer.from(raw), { failOn: 'none' })
      .rotate()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_Q })
      .toBuffer({ resolveWithObject: true })
    return { jpeg: new Uint8Array(jpeg), w: info.width, h: info.height }
  } catch {
    throw new Error('디코드실패')
  }
}

/** 청크 병렬 — 순서를 보존한다 */
async function mapChunked<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

export type PreparedAlbum = {
  items: AlbumItem[]
  /** `${no}:before` · `${no}:after` → 준비된 사진. 없거나 실패한 칸은 키가 없다(= 「사진 없음」) */
  photos: Map<string, PreparedPhoto>
  /** 조용히 버리지 않기 위한 사유 — 상한 초과·다운로드/디코드 실패·용량 초과 */
  notes: string[]
}

export const photoKey = (no: number, kind: 'before' | 'after') => `${no}:${kind}`

/** 사진 준비 — 칸 단위로 실패를 격리한다(한 장이 깨져도 나머지는 실린다) */
export async function prepareAlbumPhotos(store: PhotoStorage, all: AlbumItem[]): Promise<PreparedAlbum> {
  const notes: string[] = []
  const items = all.slice(0, ALBUM_MAX_ITEMS)
  if (all.length > items.length) notes.push(`사진첩 ${all.length - items.length}건 미표기(상한 ${ALBUM_MAX_ITEMS}건)`)

  const jobs = items.flatMap(it => ([
    { it, kind: 'before' as const, stored: it.before },
    { it, kind: 'after' as const, stored: it.after },
  ])).filter(j => j.stored)
  const prepared = await mapChunked(jobs, CONCURRENCY, async j => {
    try { return { j, img: await prepPhoto(store, j.stored), why: '' } }
    catch (e) { return { j, img: null, why: e instanceof Error ? e.message : String(e) } }
  })

  let used = 0
  const failed: string[] = []
  const photos = new Map<string, PreparedPhoto>()
  for (const p of prepared) {
    const label = `${p.j.it.no}-${p.j.kind === 'before' ? '전' : '후'}`
    if (!p.img) { failed.push(`${label}(${p.why})`); continue }
    if (used + p.img.jpeg.byteLength > PHOTO_BUDGET) { failed.push(`${label}(용량초과)`); continue }
    used += p.img.jpeg.byteLength
    photos.set(photoKey(p.j.it.no, p.j.kind), p.img)
  }
  if (failed.length) {
    notes.push(`사진첩 사진 ${failed.length}장 누락: ${failed.slice(0, 6).join(' · ')}${failed.length > 6 ? ` 외 ${failed.length - 6}장` : ''}`)
  }
  return { items, photos, notes }
}

// ── PDF 조립 ─────────────────────────────────────────────────────────────────

/** PDF 사진첩 조립 — 표지 레터헤드(상호·전화·팩스·메일·로고) + 목록.
 *  PDF는 준비된 JPEG를 자산 파일명으로(assets 멀티파트), 미리보기는 서명 URL을 src로 받는다(표지와 같은 분기) */
export async function assemblePhotoAlbum(
  admin: SupabaseClient, inspectionId: string, opts: { forPreview?: boolean } = {},
): Promise<{ data: PhotoAlbumData; missing: string[]; assets: DocAsset[] }> {
  const { data: insp, error } = await admin.from('inspections')
    .select('id, customer:customers(customer_name)').eq('id', inspectionId).maybeSingle()
  if (error) throw new Error(`점검 조회 실패: ${error.message}`)
  if (!insp) throw new Error('점검을 찾을 수 없습니다.')
  const buildingName = (insp as unknown as { customer: { customer_name: string } | null }).customer?.customer_name ?? ''
  const company = await getCompanyProfile()
  const items = await loadPhotoAlbumItems(admin, inspectionId)
  const missing: string[] = []
  const assets: DocAsset[] = []
  if (items.length === 0) missing.push('불량 없음 — 사진첩에 실을 건이 없습니다')

  let srcOf: (it: AlbumItem, kind: 'before' | 'after') => string | null
  let shown = items
  if (opts.forPreview) {
    const signed = await signDefectPhotoMap(admin, items.flatMap(it => [it.before, it.after]))
    srcOf = (it, kind) => signedOf(signed, kind === 'before' ? it.before : it.after)
  } else {
    const album = await prepareAlbumPhotos(admin, items)
    shown = album.items
    missing.push(...album.notes)
    for (const it of album.items) {
      for (const kind of ['before', 'after'] as const) {
        const img = album.photos.get(photoKey(it.no, kind))
        if (img) assets.push({ name: `album${it.no}-${kind}.jpg`, data: img.jpeg, mime: 'image/jpeg' })
      }
    }
    const names = new Set(assets.map(a => a.name))
    srcOf = (it, kind) => (names.has(`album${it.no}-${kind}.jpg`) ? `album${it.no}-${kind}.jpg` : null)
  }
  const blank = shown.reduce((n, it) => n + (it.before ? 0 : 1) + (it.after ? 0 : 1), 0)
  if (blank) missing.push(`사진 미등록 ${blank}칸 — 「사진 없음」으로 인쇄 (점검 상세 ⑤ 불량에서 공사 전·후 사진 등록)`)

  // 회사 로고 — logo_url은 공개 URL. PDF는 바이트로 내려 상대참조, 실패해도 로고 칸만 생략(표지와 같은 규약)
  let logoSrc: string | null = null
  if (company?.logo_url) {
    if (opts.forPreview) logoSrc = company.logo_url
    else {
      try {
        const res = await fetch(company.logo_url)
        if (res.ok) {
          const mime = res.headers.get('content-type') || 'image/png'
          const file = `album-logo.${mime.includes('svg') ? 'svg' : mime.includes('jpeg') ? 'jpg' : 'png'}`
          assets.push({ name: file, data: new Uint8Array(await res.arrayBuffer()), mime })
          logoSrc = file
        }
      } catch { /* 로고 실패 무시 */ }
    }
  }

  return {
    data: {
      buildingName,
      company: {
        name: company?.company_name ?? '',
        phone: formatTel(company?.phone), fax: formatTel(company?.fax), email: company?.email ?? '',
        logoSrc,
      },
      items: shown.map(it => ({ no: it.no, title: it.title, beforeSrc: srcOf(it, 'before'), afterSrc: srcOf(it, 'after') })),
    },
    missing,
    assets,
  }
}
