/** 표지·공문 데이터 조립 (소방계획서_22 S5·S7) — 렌더(doc-templates/cover·official)는 순수 함수,
 *  조회는 전부 여기서 한다. report9-actions의 assemble 계열과 같은 역할이되, 동시 편집 중인
 *  거대 파일(report9-actions.ts)의 수정 표면을 줄이려고 별도 lib로 분리했다(2026-08-14).
 *
 *  이미지 규약(S5-7, P-9 정정 — 신규 아니라 이식): PDF는 스토리지 바이트를 내려받아
 *  assets 멀티파트 + <img src="상대명"> / 미리보기는 서명 URL을 src에 직접(iframe이 브라우저에서 fetch).
 *  서명 URL을 PDF HTML에 박지 않는다 — Gotenberg 컨테이너의 외부 네트워크 의존·TTL 만료 위험. */

import { createAdminClient } from '@/lib/supabase/admin'
import { getCompanyProfile } from '@/lib/company-profile'
import { listCustomerAssetEntries, ASSET_BUCKET, ASSET_URL_TTL } from '@/lib/customer-assets'
import type { DocAsset } from '@/lib/doc-templates/base'
import type { CoverData } from '@/lib/doc-templates/cover'
import type { OfficialData } from '@/lib/doc-templates/official'

type Admin = ReturnType<typeof createAdminClient>

/** 점검종류 라벨 — 표지 제목·공문 제목 가변(S5-10·S7-1). report9-actions ckOp/ckInitial과 같은 축:
 *  '작동' → 작동점검 / '최초' 또는 (종합 && is_initial) → 최초점검 / 그 외 → 종합점검 */
export function inspectionTypeLabel(inspectionType: string | null, isInitial: boolean): string {
  const t = inspectionType ?? ''
  if (t === '작동') return '작동점검'
  if (t === '최초' || (t === '종합' && isInitial)) return '최초점검'
  return '종합점검'
}

function ymLabel(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date()
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
}

async function loadInspection(admin: Admin, inspectionId: string) {
  const { data } = await admin.from('inspections')
    .select('id, customer_id, year, inspection_type, is_initial, inspection_start_date, inspection_end_date, customer:customers(customer_name)')
    .eq('id', inspectionId).single()
  return data as unknown as {
    id: string; customer_id: string; year: number
    inspection_type: string | null; is_initial: boolean | null
    inspection_start_date: string | null; inspection_end_date: string | null
    customer: { customer_name: string } | null
  } | null
}

// ── 표지 (S5) ────────────────────────────────────────────────────────────────

export async function assembleCover(
  admin: Admin, _customerId: string, inspectionId: string,
  opts: { forPreview?: boolean } = {},
): Promise<{ data: CoverData; missing: string[]; assets: DocAsset[] }> {
  const insp = await loadInspection(admin, inspectionId)
  if (!insp) throw new Error('점검을 찾을 수 없습니다.')
  const company = await getCompanyProfile()
  const missing: string[] = []
  const assets: DocAsset[] = []

  // 건물 사진 — cover 슬롯(customer-assets 규약). 미등록이어도 생성은 막지 않는다(자리표시)
  let photoSrc: string | null = null
  const entries = await listCustomerAssetEntries(insp.customer_id)
  const cover = entries.find(e => e.slot === 'cover')
  if (cover) {
    if (opts.forPreview) {
      const { data: signed } = await admin.storage.from(ASSET_BUCKET).createSignedUrl(cover.path, ASSET_URL_TTL)
      photoSrc = signed?.signedUrl ?? null
    } else {
      try {
        const { data: blob } = await admin.storage.from(ASSET_BUCKET).download(cover.path)
        if (blob) {
          const ext = cover.name.split('.').pop() ?? 'jpg'
          const file = `cover.${ext}`
          assets.push({ name: file, data: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' })
          photoSrc = file
        }
      } catch { /* 사진 1장 실패로 생성을 막지 않음 — fire-plan-generate 동일 규약 */ }
    }
  }
  if (!photoSrc) missing.push('표지 건물 사진 미등록 — 자리표시로 인쇄 (고객 상세 [지도·사진] cover 슬롯)')

  // 회사 로고 — logo_url은 공개 URL. PDF는 바이트로 내려 상대참조, 실패해도 로고 칸만 생략
  let logoSrc: string | null = null
  if (company?.logo_url) {
    if (opts.forPreview) {
      logoSrc = company.logo_url
    } else {
      try {
        const res = await fetch(company.logo_url)
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer())
          const mime = res.headers.get('content-type') || 'image/png'
          const ext = mime.includes('svg') ? 'svg' : mime.includes('jpeg') ? 'jpg' : 'png'
          const file = `logo.${ext}`
          assets.push({ name: file, data: buf, mime })
          logoSrc = file
        }
      } catch { /* 로고 실패 무시 */ }
    }
  }

  if (!company?.fax) missing.push('회사 팩스 미등록 — 표지 연락처에서 생략 (본사 정보에서 입력)')

  const data: CoverData = {
    year: insp.year,
    typeLabel: inspectionTypeLabel(insp.inspection_type, !!insp.is_initial),
    buildingName: insp.customer?.customer_name ?? '',
    photoSrc,
    issueLabel: ymLabel(insp.inspection_end_date ?? insp.inspection_start_date),
    company: {
      name: company?.company_name ?? '',
      address: company?.address ?? '',
      phone: company?.phone ?? '',
      fax: company?.fax ?? '',
      logoSrc,
    },
  }
  if (!data.buildingName) missing.push('고객명(건물명) 없음')
  return { data, missing, assets }
}

// ── 공문 (S7) ────────────────────────────────────────────────────────────────

/** 회사 약칭 — '주식회사 승진소방 ENG'/'㈜승진소방 ENG' → '승 진' (문서번호 접두, 사내 관행 재현).
 *  법인 접두를 벗긴 뒤 첫 두 한글 음절을 전각 공백으로 벌린다. 한글이 모자라면 그대로 쓴다 */
export function companyAbbrev(name: string): string {
  const bare = name.replace(/^(주식회사|㈜|\(주\))\s*/, '')
  const syls = [...bare].filter(c => /[가-힣]/.test(c))
  return syls.length >= 2 ? `${syls[0]} ${syls[1]}` : (syls[0] ?? bare.slice(0, 2))
}

/** 문서번호 자동 제안(Q-14) — '{약칭} {YYMM}-{동월 최대 일련+1}'.
 *  기존 발급분은 annex_inputs(annex_no 'official')의 docNo에서 같은 YYMM 접미 일련을 긁는다.
 *  수동 저장분이 있으면 그 값이 항상 이긴다 — 제안은 빈 칸일 때만 */
async function suggestDocNo(admin: Admin, abbrev: string, now = new Date()): Promise<string> {
  const yymm = `${String(now.getFullYear() % 100).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`
  const { data } = await admin.from('annex_inputs').select('fields').eq('annex_no', 'official').limit(1000)
  let max = 0
  const re = new RegExp(`${yymm}-(\\d+)\\s*$`)
  for (const row of (data ?? []) as Array<{ fields: Record<string, unknown> | null }>) {
    const v = String(row.fields?.docNo ?? '')
    const m = re.exec(v)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${abbrev} ${yymm}-${max + 1}`
}

export async function assembleOfficial(
  admin: Admin, _customerId: string, inspectionId: string,
): Promise<{ data: OfficialData; missing: string[] }> {
  const insp = await loadInspection(admin, inspectionId)
  if (!insp) throw new Error('점검을 찾을 수 없습니다.')
  const company = await getCompanyProfile()
  const missing: string[] = []

  // 서식 고유 값(annex_inputs 'official') — 수동 저장분이 자동 제안보다 우선(Q-14)
  const { data: inputRow } = await admin.from('annex_inputs').select('fields')
    .eq('inspection_id', inspectionId).eq('annex_no', 'official').maybeSingle()
  const f = (inputRow?.fields ?? {}) as Record<string, unknown>
  const fstr = (k: string) => String(f[k] ?? '').trim()

  const abbrev = companyAbbrev(company?.company_name ?? '')
  let docNo = fstr('docNo')
  if (!docNo) {
    docNo = await suggestDocNo(admin, abbrev)
    missing.push(`문서번호 자동 제안(${docNo}) — [입력]에서 수정·확정 가능`)
  }

  const data: OfficialData = {
    company: {
      name: company?.company_name ?? '',
      address: company?.address ?? '',
      phone: company?.phone ?? '',
      fax: company?.fax ?? '',
    },
    docNo,
    sendDate: fstr('sendDate') || ymLabel(insp.inspection_end_date ?? null),
    recipient: fstr('recipient') || (insp.customer?.customer_name ?? ''),
    reference: fstr('reference') || '소방안전관리자 및 관계인',
    sender: company?.company_name ?? '',
    year: insp.year,
    typeLabel: inspectionTypeLabel(insp.inspection_type, !!insp.is_initial),
  }
  if (!data.recipient) missing.push('수신(고객명) 없음')
  if (!company?.fax) missing.push('회사 팩스 미등록 — 레터헤드에서 생략 (본사 정보에서 입력)')
  return { data, missing }
}
