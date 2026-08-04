import 'server-only'

/** 소방계획서 서버 동기 생성 (소방계획서_7 H-12·H-13)
 *
 *  기존 워커(scripts/fireplan-worker.py process — SDK HWP 병합)의 데이터 조립을 TS로 완결 이식:
 *  고객·건물·시설·관계인·자위소방대·fire_plan_forms.sections·프리셋(_presets, fail-soft)을 모아
 *  buildFirePlanHtml(웹 템플릿 v2) → Gotenberg PDF → fire-plans 버킷 업로드 → fire_plans 등록.
 *  §6: hwp_path는 신규 기록하지 않고 pdf_status는 즉시 'ready' (2단계 변환 없음). */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildFirePlanHtml, applyPresetPairs, FACILITY_FORM,
  type FirePlanGenData, type FirePlanFormSections, type PlanPhoto,
} from '@/lib/fire-plan-template'
import { toStandardCodes } from '@/lib/facility-codes'
import { convertHtmlToPdf } from '@/lib/pdf'
import { listCustomerAssets, ASSET_BUCKET } from '@/lib/customer-assets'
import { PRESET_FILE_KEYS, type PresetType } from '@/lib/fire-plan-presets'

type Admin = ReturnType<typeof createAdminClient>

const BUCKET = ASSET_BUCKET // 'fire-plans'

const IMG_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
}

export type FirePlanAsset = { name: string; data: Uint8Array; mime: string }
export type FirePlanImageRef = { file: string; kind: string; caption: string }

export type AssembledFirePlan = {
  data: FirePlanGenData
  images: FirePlanImageRef[]
  assets: FirePlanAsset[]
  missing: string[]
  presetPairs: Array<{ find: string; value: string }>
}

/** 프리셋 JSON(_presets/{유형}.json) → find/value 쌍 — 없거나 손상 시 [] (양식 기본값 유지, fail-soft) */
async function loadPresetPairs(admin: Admin, presetType: string): Promise<Array<{ find: string; value: string }>> {
  const key = PRESET_FILE_KEYS[presetType as PresetType]
  if (!key) return []
  try {
    const { data } = await admin.storage.from(BUCKET).download(`_presets/${key}.json`)
    if (!data) return []
    const parsed = JSON.parse(await data.text()) as { entries?: Array<{ find?: string; value?: string }> }
    return (parsed.entries ?? [])
      .map(e => ({ find: e.find ?? '', value: e.value ?? '' }))
      .filter(p => p.find && p.value && p.find !== p.value)
  } catch {
    return []
  }
}

/** 스토리지 이미지 수집 — 경로 중복 제거, 실패 항목은 건너뜀(fail-soft) */
async function collectImages(
  admin: Admin,
  refs: Array<{ path: string; kind: string; caption: string }>,
): Promise<{ images: FirePlanImageRef[]; assets: FirePlanAsset[] }> {
  const images: FirePlanImageRef[] = []
  const assets: FirePlanAsset[] = []
  const seen = new Set<string>()
  let i = 0
  for (const r of refs) {
    const path = r.path?.trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    const ext = (path.split('.').pop() ?? '').toLowerCase()
    const mime = IMG_MIME[ext]
    if (!mime) continue
    try {
      const { data } = await admin.storage.from(BUCKET).download(path)
      if (!data) continue
      const file = `img_${i++}.${ext}`
      assets.push({ name: file, data: new Uint8Array(await data.arrayBuffer()), mime })
      images.push({ file, kind: r.kind, caption: r.caption })
    } catch {
      /* 이미지 1장 실패로 생성을 막지 않음 */
    }
  }
  return { images, assets }
}

/** 소방계획서 생성 데이터 조립 — 서버에서 완결 (워커 process()의 DB 조회 + getFirePlanGenDefaultsAction 매핑 통합) */
export async function assembleFirePlan(
  admin: Admin,
  customerId: string,
  year: number,
  presetType?: string,
): Promise<AssembledFirePlan> {
  const [custRes, contactRes, bldRes, companyRes, formRes, brigadeRes, plansRes] = await Promise.all([
    admin.from('customers')
      .select('customer_name, address, use_approval_date, fire_station, inspection_type, plan_anchor_date, contract_date, '
        + 'building_grade, manager_selected_at, insurance_joined, insurance_company, insurance_period, '
        + 'insurance_amount_person, insurance_amount_property, op_hours_weekday, op_hours_holiday, '
        + 'headcount_worker, headcount_resident, headcount_max')
      .eq('id', customerId).single(),
    admin.from('customer_contacts').select('role, name, phone').eq('customer_id', customerId),
    admin.from('buildings')
      .select('id, purpose, total_area, building_area, floors_above, floors_below, height, receiver_location, main_structure, roof_structure')
      .eq('customer_id', customerId).eq('is_active', true)
      .order('created_at', { ascending: true }),
    admin.from('company_profile').select('company_name, address, phone').limit(1).maybeSingle(),
    admin.from('fire_plan_forms').select('sections').eq('customer_id', customerId).maybeSingle(),
    admin.from('fire_brigade_members').select('team, name, duty, phone').eq('customer_id', customerId).order('sort_order'),
    admin.from('fire_plans').select('year, revision, note, created_at').eq('customer_id', customerId).order('created_at', { ascending: true }),
  ])
  const cust = custRes.data as {
    customer_name: string; address: string | null; use_approval_date: string | null
    fire_station: string | null; inspection_type: string; plan_anchor_date: string | null; contract_date: string | null
    building_grade: string | null; manager_selected_at: string | null
    insurance_joined: boolean | null; insurance_company: string | null; insurance_period: string | null
    insurance_amount_person: string | null; insurance_amount_property: string | null
    op_hours_weekday: string | null; op_hours_holiday: string | null
    headcount_worker: number | null; headcount_resident: number | null; headcount_max: number | null
  } | null
  if (!cust) throw new Error('고객을 찾을 수 없습니다')

  const contacts = (contactRes.data ?? []) as Array<{ role: string; name: string; phone: string | null }>
  const owner = contacts.find(c => c.role === '대표') ?? contacts[0]
  const buildings = (bldRes.data ?? []) as Array<{
    id: string; purpose: string | null; total_area: number | null; building_area: number | null
    floors_above: number | null; floors_below: number | null
    height: number | string | null; receiver_location: string | null; main_structure: string | null; roof_structure: string | null
  }>
  const b = buildings[0]
  const company = companyRes.data as { company_name: string; address: string | null; phone: string | null } | null

  const rawSections = ((formRes.data as { sections?: Record<string, unknown> } | null)?.sections) ?? {}
  const sections = rawSections as FirePlanFormSections & {
    revision?: { revisionDate?: string; revisionNote?: string }
    zones?: Array<{ zone: string; name: string; area: string; workersWeekday: string; workersHoliday: string; company: string; phone: string }>
    hazards?: Array<{ place: string; loc: string; risks: string[] }>
    photos?: Array<{ path: string | null; kind: string; caption: string }>
  }
  const revision = sections.revision ?? null
  const revisions = ((plansRes.data ?? []) as Array<{ year: number; revision: number; note: string | null; created_at: string }>)
    .map(p => ({
      date: p.created_at.slice(0, 10),
      note: p.note ?? `${p.year}년 소방계획서${p.revision > 1 ? ` (개정${p.revision})` : ' 작성'}`,
      author: '',
    }))
  const brigadeRows = (brigadeRes.data ?? []) as Array<{ team: string; name: string; duty: string | null; phone: string | null }>

  // 설치 시설 → 서식 1.4 항목 — 표준 코드(100) 정확 일치, 레거시 잔존분은 toStandardCodes로 정규화
  let facilities: string[] = []
  let facCodes: string[] = []
  if (buildings.length > 0) {
    const { data: facRaw } = await admin.from('fire_facilities')
      .select('facility_code, installed')
      .in('building_id', buildings.map(x => x.id))
      .eq('installed', true)
    facCodes = ((facRaw ?? []) as Array<{ facility_code: string }>).map(fc => fc.facility_code)
    const codes = toStandardCodes(facCodes)
    const allItems = new Set(FACILITY_FORM.flatMap(g => g.items))
    facilities = codes.filter(c => allItems.has(c))
  }

  // 자체점검 시기 — 점검계획일 기준: 종합 고객은 종합=기준월·작동=+6개월, 작동 고객은 작동=기준월
  const anchorMonth = cust.plan_anchor_date ? new Date(cust.plan_anchor_date).getMonth() + 1 : null
  const plus6 = anchorMonth ? ((anchorMonth - 1 + 6) % 12) + 1 : null
  const isComprehensive = cust.inspection_type === '종합'
  const operationMonth = anchorMonth ? `${year}년 ${isComprehensive ? plus6 : anchorMonth}월` : ''
  const comprehensiveMonth = isComprehensive && anchorMonth ? `${year}년 ${anchorMonth}월` : ''

  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const floors = b ? `지하 ${b.floors_below ?? 0}층 / 지상 ${b.floors_above ?? 0}층` : ''
  const n = (x: number | null | undefined) => x != null ? String(x) : ''

  const photos = (sections.photos ?? []).filter((p): p is { path: string; kind: string; caption: string } => !!p.path)

  const data: FirePlanGenData = {
    year,
    revisionDate: revision?.revisionDate || kstToday,
    revisionNote: revision?.revisionNote || `${year}년 소방계획서 작성`,
    buildingName: cust.customer_name,
    address: cust.address ?? '',
    grade: cust.building_grade ?? '',
    purpose: b?.purpose ?? '',
    useApprovalDate: cust.use_approval_date ?? '',
    totalArea: b?.total_area != null ? String(b.total_area) : '',
    buildingArea: b?.building_area != null ? String(b.building_area) : '',
    floors,
    height: b?.height != null && String(b.height).trim() !== '' ? String(b.height) : '',
    structure: b?.main_structure ?? '',
    roof: b?.roof_structure ?? '',
    receiverLocation: b?.receiver_location ?? '',
    ownerName: owner?.name ?? '',
    ownerPhone: owner?.phone ?? '',
    managerName: owner?.name ?? '',
    managerPhone: owner?.phone ?? '',
    managerSelectedAt: cust.manager_selected_at ?? '',
    fireStation: cust.fire_station ?? '',
    stationDistance: '',
    stationEta: '',
    facilities,
    companyName: company?.company_name ?? '',
    companyAddress: company?.address ?? '',
    companyPhone: company?.phone ?? '',
    contractStart: cust.contract_date ?? '',
    inspectionCycle: '매월 1회',
    operationMonth,
    comprehensiveMonth,
    trainingMonth: sections.training?.drillMonths?.[0] ?? sections.training?.eduMonths?.[0] ?? 11,
    brigade: brigadeRows.length > 0
      ? brigadeRows.map(m => ({ team: m.team, name: m.name, duty: m.duty ?? '', phone: m.phone ?? '' }))
      : [
        { team: '자위소방대장', name: '', duty: '관리구역 상황통제', phone: '' },
        { team: '부대장', name: '', duty: '대장 부재시 수행', phone: '' },
        { team: '비상연락', name: '', duty: '119신고 및 상황전파', phone: '' },
        { team: '초기소화', name: '', duty: '소화기 이용 초기소화', phone: '' },
        { team: '피난유도', name: '', duty: '피난층 또는 옥상으로 피난유도', phone: '' },
      ],
    // 3.4 — 고객 입력 > (양식 기본값 = 프리셋 앵커, applyPresetPairs로 유형별 치환)
    evacRoutes: (sections.evacPlan?.routes?.length ?? 0) > 0
      ? sections.evacPlan!.routes!
      : [{ floor: '전층', route: '각 세대 출입구 앞 직통계단 이용', guide: '', equip: '' }],
    assembly: sections.evacPlan?.assembly || '1층 주차장',
    evacNote: sections.evacPlan?.procedure || '피난유도자 지시에 따라 최단 경로로 피난 실시, 피난 늦은 인원은 옥상 대피',
    zones: (sections.zones?.length ?? 0) > 0
      ? sections.zones!.map(z => ({
        zone: z.zone, name: z.name, area: z.area,
        weekday: z.workersWeekday, holiday: z.workersHoliday, managerCo: z.company, contact: z.phone,
      }))
      : [{
        zone: '전층', name: b?.purpose ?? '', area: b?.total_area != null ? String(b.total_area) : '',
        weekday: '', holiday: '', managerCo: '', contact: owner?.phone ?? '',
      }],
    hazards: (sections.hazards?.length ?? 0) > 0
      ? sections.hazards!.map(h => ({ place: h.place, location: h.loc, factors: h.risks }))
      : [
        { place: '보일러실', location: '', factors: ['전기적 요인', '가스누출(폭발)'] },
        { place: '주방', location: '', factors: ['부주의', '가스누출(폭발)'] },
        { place: '전기실', location: '', factors: ['전기적 요인'] },
      ],
    revisions,
    photos: photos as PlanPhoto[],
    ops: {
      insuranceJoined: cust.insurance_joined,
      insuranceCompany: cust.insurance_company ?? '',
      insurancePeriod: cust.insurance_period ?? '',
      insuranceAmountPerson: cust.insurance_amount_person ?? '',
      insuranceAmountProperty: cust.insurance_amount_property ?? '',
      opHoursWeekday: cust.op_hours_weekday ?? '',
      opHoursHoliday: cust.op_hours_holiday ?? '',
      headcountWorker: n(cust.headcount_worker),
      headcountResident: n(cust.headcount_resident),
      headcountMax: n(cust.headcount_max),
    },
    forms: sections,
  }

  // ── 이미지 수집 (§5) — 슬롯 자산(cover/map_location/evac_*) + 서식 입력 이미지(plan-assets)·사진(photos) ──
  const slotAssets = await listCustomerAssets(customerId).catch(() => [])
  const refs: Array<{ path: string; kind: string; caption: string }> = []
  for (const a of slotAssets) {
    const kind = a.slot === 'cover' ? 'cover' : a.slot === 'map_location' ? 'map' : 'evacuation'
    refs.push({ path: a.path, kind, caption: '' })
  }
  const fSec = sections
  if (fSec.location?.mapImage) refs.push({ path: fSec.location.mapImage, kind: 'map', caption: '위치도' })
  if (fSec.fireAccess?.routeImage) refs.push({ path: fSec.fireAccess.routeImage, kind: 'route', caption: '소방차 진입경로' })
  for (const m of fSec.evacMaps ?? []) {
    if (m.image) refs.push({ path: m.image, kind: 'evacmap', caption: [m.floor, m.desc].filter(Boolean).join(' — ') })
  }
  if (fSec.evacPlan?.mapImage) refs.push({ path: fSec.evacPlan.mapImage, kind: 'evacuation', caption: '피난경로도' })
  for (const p of photos) refs.push({ path: p.path, kind: p.kind, caption: p.caption })
  const { images, assets } = await collectImages(admin, refs)

  // ── 누락 안내 — 워커 process() missing과 동일 어휘(fire-plan-readiness 계열) ──
  const missing = ([
    ['주소', !!cust.address],
    ['사용승인일', !!cust.use_approval_date],
    ['계약일', !!cust.contract_date],
    ['관계인', !!owner],
    ['건물 용도', !!b?.purpose],
    ['연면적', b?.total_area != null],
    ['층수', b?.floors_above != null || b?.floors_below != null],
    ['시설현황', facCodes.length > 0],
    ['수신기위치', !!b?.receiver_location],
    ['구조', !!b?.main_structure],
    ['지붕', !!b?.roof_structure],
    ['선임일', !!cust.manager_selected_at],
    ['급수', !!cust.building_grade],
    ['화재보험', cust.insurance_joined != null],
    ['운영시간', !!cust.op_hours_weekday],
    ['인원', cust.headcount_worker != null || cust.headcount_resident != null || cust.headcount_max != null],
    ['자위소방대', brigadeRows.length > 0],
  ] as Array<[string, boolean]>).filter(([, has]) => !has).map(([label]) => label)

  const presetPairs = presetType ? await loadPresetPairs(admin, presetType) : []
  return { data, images, assets, missing, presetPairs }
}

export type FirePlanGenResult = { planId?: string; missing?: string[]; error?: string }

/** 소방계획서 1건 서버 동기 생성 — HTML 렌더 → Gotenberg PDF → 업로드 → fire_plans 등록 (H-13)
 *  §6: hwp 신규 기록 없음, pdf_status 즉시 'ready'. 잡 행 기록은 호출자(액션)가 담당. */
export async function generateFirePlanNow(
  admin: Admin,
  opts: { customerId: string; year: number; presetType?: string; requestedBy?: string | null },
): Promise<FirePlanGenResult> {
  const { customerId, year } = opts
  try {
    const { data, images, assets, missing, presetPairs } = await assembleFirePlan(admin, customerId, year, opts.presetType)
    let html = buildFirePlanHtml(data, images)
    if (presetPairs.length > 0) html = applyPresetPairs(html, presetPairs)

    // P-3 생성 품질 게이트(워커 verify_merge 계열) — 값이 있는데 생성물에 없으면 병합 확인 실패
    const text = html.replace(/<[^>]+>/g, ' ')
    for (const [label, value] of [['고객명', data.buildingName], ['주소', data.address]] as Array<[string, string]>) {
      if (value.trim() && !text.includes(value.trim())) missing.push(`병합 확인 실패: ${label}`)
    }

    const pdf = await convertHtmlToPdf(html, assets, { marginMode: 'none', timeoutMs: 120_000 })

    const stamp = Date.now()
    const base = `${customerId}/${year}/generated_web_${stamp}`
    const upHtml = await admin.storage.from(BUCKET)
      .upload(`${base}.html`, new TextEncoder().encode(html), { contentType: 'text/html; charset=utf-8' })
    if (upHtml.error) return { error: `HTML 업로드 실패: ${upHtml.error.message}` }
    const upPdf = await admin.storage.from(BUCKET)
      .upload(`${base}.pdf`, pdf, { contentType: 'application/pdf' })
    if (upPdf.error) {
      await admin.storage.from(BUCKET).remove([`${base}.html`])
      return { error: `PDF 업로드 실패: ${upPdf.error.message}` }
    }

    // 보관함 등록 — 개정 차수 = 같은 연도 기존 행 수 + 1 (워커와 동일 규약)
    const { data: existing } = await admin.from('fire_plans')
      .select('id').eq('customer_id', customerId).eq('year', year)
    const preset = opts.presetType ?? ''
    const { data: inserted, error: insErr } = await admin.from('fire_plans').insert({
      customer_id: customerId,
      year,
      title: `${year}년 소방계획서`,
      pdf_name: `${year}년 소방계획서.pdf`,
      pdf_path: `${base}.pdf`,
      pdf_status: 'ready',
      html_path: `${base}.html`,
      hwp_name: null,
      hwp_path: null,
      revision: (existing?.length ?? 0) + 1,
      note: `자동 생성 (표준양식 웹 템플릿${preset ? `, ${preset} 프리셋` : ''})`,
      uploaded_by: opts.requestedBy ?? null,
    } as Record<string, unknown>).select('id').single()
    if (insErr) {
      await admin.storage.from(BUCKET).remove([`${base}.pdf`, `${base}.html`])
      return { error: `보관함 등록 실패: ${insErr.message}` }
    }
    return { planId: (inserted as { id: string }).id, missing }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
