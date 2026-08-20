/** 표지·공문 데이터 조립 (소방계획서_22 S5·S7) — 렌더(doc-templates/cover·official)는 순수 함수,
 *  조회는 전부 여기서 한다. report9-actions의 assemble 계열과 같은 역할이되, 동시 편집 중인
 *  거대 파일(report9-actions.ts)의 수정 표면을 줄이려고 별도 lib로 분리했다(2026-08-14).
 *
 *  이미지 규약(S5-7, P-9 정정 — 신규 아니라 이식): PDF는 스토리지 바이트를 내려받아
 *  assets 멀티파트 + <img src="상대명"> / 미리보기는 서명 URL을 src에 직접(iframe이 브라우저에서 fetch).
 *  서명 URL을 PDF HTML에 박지 않는다 — Gotenberg 컨테이너의 외부 네트워크 의존·TTL 만료 위험. */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { getCompanyProfile } from '@/lib/company-profile'
import { formatTel } from '@/lib/format-contact'
import { listCustomerAssetEntries, ASSET_BUCKET, ASSET_URL_TTL } from '@/lib/customer-assets'
import type { DocAsset } from '@/lib/doc-templates/base'
import type { CoverData } from '@/lib/doc-templates/cover'
import type { OfficialData } from '@/lib/doc-templates/official'
import type { DelegationData } from '@/lib/doc-templates/delegation'
import { resolveFireSafetyManager, type ContactLite } from '@/lib/fire-safety-manager'
import type { ManagerRow } from '@/components/customers/plan-form17'

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
    .select('id, customer_id, year, inspection_type, is_initial, inspection_start_date, inspection_end_date, assigned_employee_id, customer:customers(customer_name)')
    .eq('id', inspectionId).single()
  return data as unknown as {
    id: string; customer_id: string; year: number
    inspection_type: string | null; is_initial: boolean | null
    inspection_start_date: string | null; inspection_end_date: string | null
    assigned_employee_id: string | null
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
      // 표기는 조립 지점에서 통일한다(별지 9호 report9-actions와 같은 축) — 템플릿은 받은 문자열을 그대로 찍는다
      phone: formatTel(company?.phone),
      fax: formatTel(company?.fax),
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
  // ⚠ `.limit(1000)`은 상한이 아니다 — PostgREST가 요청당 1000행에서 자르므로 같은 값이고,
  // 공문 발급이 1000건을 넘으면 뒤쪽이 조용히 빠져 **이미 쓴 일련번호를 다시 제안**하게 된다.
  // 끝까지 받는다(정렬은 페이지가 겹치지 않게 id로 고정).
  const { rows } = await fetchAllRows<{ fields: Record<string, unknown> | null }>(
    (from, to) => admin.from('annex_inputs').select('fields')
      .eq('annex_no', 'official').order('id').range(from, to))
  let max = 0
  const re = new RegExp(`${yymm}-(\\d+)\\s*$`)
  for (const row of rows) {
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
      phone: formatTel(company?.phone),
      fax: formatTel(company?.fax),
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

// ── 위임장 (S8) ──────────────────────────────────────────────────────────────

function ymdDots(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${y}.${m}.${d}` : ''
}

/** 점검결과 보고서 제출용 위임장 조립 — 서식 원천은 '보고서 갑지.xls' [위임장] 탭(사내 실무 서식, 재량 영역).
 *  자동 기본값: 관계인 = 서식 1.7 선임 소방안전관리자(폴백: 대표 연락처), 대리인 = 주된 점검인력(폴백: 담당 직원),
 *  관할 소방서 = customers.fire_station. 생년월일은 시스템 미보유 — annex_inputs('delegation') 수동 입력만.
 *  소방안전관리자 해석은 별지 9호·10·11호·외관과 **같은 lib/fire-safety-manager**를 탄다 — 145 지목이 있으면
 *  그 관계인의 전화가 그대로 온다(종전엔 1.7에 전화 열이 없어 선임자≠대표면 항상 공란이었다). */
export async function assembleDelegation(
  admin: Admin, _customerId: string, inspectionId: string,
): Promise<{ data: DelegationData; missing: string[] }> {
  const insp = await loadInspection(admin, inspectionId)
  if (!insp) throw new Error('점검을 찾을 수 없습니다.')
  const missing: string[] = []

  const [inputRes, custRes, formRes, contactsRes, partsRes, r9Res] = await Promise.all([
    admin.from('annex_inputs').select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'delegation').maybeSingle(),
    admin.from('customers').select('fire_station, manager_contact_id').eq('id', insp.customer_id).single(),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', insp.customer_id).limit(1).maybeSingle(),
    // birth_date까지 뽑는다 — 고객 상세 관계인 카드가 이미 받아 두는 값인데(“직위·생년월일은
    // 보고서 공문·위임장에 사용됩니다”) 종전엔 위임장이 읽지 않아 매번 손으로 다시 넣었다(2026-08-20)
    admin.from('customer_contacts').select('id, role, name, phone, position, birth_date').eq('customer_id', insp.customer_id),
    admin.from('inspection_participants').select('employee_id, role, sort_order').eq('inspection_id', inspectionId),
    // 위임 일자는 별지 9호 보고일과 같은 축을 쓴다(아래 submitDate 주석) — 그 보고일의 수기 지정분
    admin.from('annex_inputs').select('fields').eq('inspection_id', inspectionId).eq('annex_no', 'report9').maybeSingle(),
  ])
  const f = ((inputRes.data as { fields: Record<string, unknown> | null } | null)?.fields ?? {}) as Record<string, unknown>
  const fstr = (k: string) => String(f[k] ?? '').trim()

  // 관계인(본인) — 소방안전관리자 우선, 없으면 대표 연락처
  const contacts = (contactsRes.data ?? []) as Array<ContactLite & { birth_date?: string | null }>
  const rep = contacts.find(c => c.role === '대표') ?? contacts[0] ?? null
  const cust = custRes.data as { fire_station: string | null; manager_contact_id: string | null } | null
  const mgr = resolveFireSafetyManager({
    contacts, managerContactId: cust?.manager_contact_id,
    managers: ((formRes.data?.sections as Record<string, unknown> | null)?.['managers'] ?? null) as ManagerRow[] | null,
  })
  // 대표 폴백(source==='owner')은 '소방안전관리자'가 아니다 — 직위를 그렇게 단정하지 않는다
  const isMgr = mgr.source === 'contact' || mgr.source === 'form17'
  // 위임장에 실릴 그 사람의 관계인 레코드 — 직위·생년월일의 원천.
  // 이름으로 맞춘다: 지목(source='contact')·대표 폴백은 물론, 1.7 선임자가 관계인으로도 등록돼 있으면 걸린다.
  const ownerContact = contacts.find(c => c.name?.trim() && c.name.trim() === mgr.name.trim()) ?? null
  const owner = {
    name: fstr('ownerName') || mgr.name,
    // 저장된 직위 우선(2026-08-20 사용자 확정) — 없을 때만 선임 여부로 추정한다.
    // mgr.title은 쓰지 않는다: 1.7에서 오면 그건 직위가 아니라 선임 구분('관리자'/'보조자')이다.
    position: fstr('ownerPosition') || ownerContact?.position?.trim() || (isMgr ? '소방안전관리자' : rep ? '대표' : ''),
    phone: formatTel(fstr('ownerPhone') || mgr.phone),
    birth: fstr('ownerBirth') || ymdDots(ownerContact?.birth_date ?? null),
  }
  if (!owner.name) missing.push('관계인 성명 없음 — 관계인 탭 [소방안전관리] 지정 또는 [입력]에서 기재')
  if (!owner.birth) missing.push('관계인 생년월일 미입력 — 공란 인쇄 (고객 상세 관계인 카드 또는 [입력]에서 기재)')

  // 대리인(관리업체) — 주된 점검인력(참여자 '주된' → 담당 직원 폴백, report9와 동일 축)
  const parts = (partsRes.data ?? []) as Array<{ employee_id: string; role: string; sort_order: number }>
  const mainId = parts.filter(p => p.role === '주된').sort((a, b) => a.sort_order - b.sort_order)[0]?.employee_id
    ?? insp.assigned_employee_id ?? null
  // 146 — 직위·연락처·생년월일까지 직원 정보에서 가져온다. 종전엔 성명만 자동이고 나머지 3칸은
  // 점검 건마다 annex_inputs에 손으로 다시 넣어야 했다(같은 직원이 매 회차 같은 값을 반복 입력).
  type AgentProfile = { name: string | null; position: string | null; phone: string | null; birth_date: string | null }
  let prof: AgentProfile | null = null
  if (mainId) {
    const { data } = await admin.from('profiles')
      .select('name, position, phone, birth_date').eq('id', mainId).maybeSingle()
    prof = (data ?? null) as AgentProfile | null
  }
  const agent = {
    name: fstr('agentName') || (prof?.name ?? ''),
    position: fstr('agentPosition') || (prof?.position?.trim() ?? ''),
    phone: formatTel(fstr('agentPhone') || (prof?.phone ?? '')),
    birth: fstr('agentBirth') || ymdDots(prof?.birth_date ?? null),
  }
  if (!agent.name) missing.push('대리인(주된 점검인력) 없음 — 점검 참여자 지정 또는 [입력]에서 기재')
  if (!agent.birth) missing.push('대리인 생년월일 미입력 — 공란 인쇄 (관리자 > 직원 관리 또는 [입력]에서 기재)')

  // 점검일자 — 시작~종료(같으면 1일). 표기는 샘플 축('YYYY.MM.DD 부터 ~ 까지 (N일)')
  const s = insp.inspection_start_date, e = insp.inspection_end_date ?? insp.inspection_start_date
  const periodLabel = s ? `${ymdDots(s)} 부터 ~ ${ymdDots(e)} 까지` : ''
  let daysLabel = ''
  if (s && e) {
    const days = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86_400_000) + 1
    if (days > 0) daysLabel = `${days}일`
  }
  if (!periodLabel) missing.push('점검일자 없음 — 점검 시작·종료일 미입력')

  // 관할 소방서 — customers.fire_station('양평소방서' → '양평', 뒤에 고정 문구가 붙는다)
  const rawStation = ((custRes.data as { fire_station: string | null } | null)?.fire_station ?? '').trim()
  const station = fstr('station') || rawStation.replace(/소방서\s*$/, '').trim()
  if (!station) missing.push('관할 소방서 없음 — 고객 정보(1.3) 또는 [입력]에서 지정')

  // 위임 일자 — **별지 9호 보고일과 같은 축**(2026-08-20 사용자 확정). 위임장은 보고서 제출용 첨부라
  // 같은 인쇄 번들에 별지 9호와 나란히 들어가는데, 종전엔 위임장만 점검일 축(종료일 → 시작일)이라
  // 두 문서의 날짜가 서로 달랐다. 게다가 inspection_end_date는 실측 2/188만 채워져 있어(2026-08-20)
  // 사실상 '점검 시작일'이 찍히고 있었다 — 의도(종료일)와도 어긋났다.
  // 폴백: [입력] 수기 → 별지 9호 보고일(annex_inputs.report9.reportDate) → 오늘(KST).
  // 마지막 단은 report9-actions의 기본 보고일과 같은 식이라 둘이 자동으로 같은 날짜가 된다.
  const r9f = ((r9Res.data as { fields: Record<string, unknown> | null } | null)?.fields ?? {}) as Record<string, unknown>
  const r9Date = String(r9f['reportDate'] ?? '').trim()
  const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().split('T')[0]
  const [sy, sm, sdd] = (/^\d{4}-\d{2}-\d{2}$/.test(r9Date) ? r9Date : kstToday).split('-').map(Number)
  const data: DelegationData = {
    typeLabel: inspectionTypeLabel(insp.inspection_type, !!insp.is_initial),
    owner, agent, periodLabel, daysLabel,
    submitDate: fstr('submitDate') || `${sy}년 ${sm}월 ${sdd}일`,
    station,
  }
  return { data, missing }
}
