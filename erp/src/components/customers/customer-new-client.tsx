'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Phone, Mail, MapPin, Search, X, Plus, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { createCustomerAction, generateCustomerCodeAction, checkAddressAction, checkCustomerNameAction, fetchBuildingLedgerAction, previewNewCustomerScheduleAction, type ContactInput, type BuildingLedgerInfo, type AddressDuplicateCustomer, type AddressDuplicateBuilding, type NameDuplicateCustomer, type NewSchedulePreview } from '@/app/(dashboard)/customers/actions'
import { NewSchedulePreviewBox } from '@/components/customers/new-schedule-preview'
import { AddressDuplicateDialog } from '@/components/customers/address-duplicate-dialog'
import { NameDuplicateDialog } from '@/components/customers/name-duplicate-dialog'
import { useDaumPostcode } from '@/hooks/use-daum-postcode'
import { DateInput, isCompleteDate } from '@/components/ui/date-input'
import { ComboInput } from '@/components/ui/combo-input'
import { formatPhoneKR } from '@/components/ui/fields'
import { isPastAnchor } from '@/lib/plan-anchor'
import { todayKst } from '@/lib/kst-date'
import type { InspectionType } from '@/types'

function extractBuildingName(fullAddress: string): string {
  const match = fullAddress.match(/\(([^)]+)\)$/)
  return match ? match[1].trim() : ''
}

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'
const labelCls = 'text-xs font-medium text-ink-sub'
const cardCls = 'bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px]'
const stepBadgeCls = 'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-white text-form-2xs font-semibold'
// 세그먼트 버튼(점검유형·등급) — 같은 모양 한 벌
const segCls = 'inline-flex items-center gap-1 h-9 px-3 text-sm cursor-pointer select-none transition-colors border-r border-line last:border-r-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40'
const segOnCls = 'bg-brand text-white'
const segOffCls = 'bg-surface text-ink-sub hover:bg-brand-tint'

/** 번호 붙은 카드 — ① 건물 · ② 점검 일정 · ③ 관계인 (④는 접이라 따로 그린다) */
function Section({ n, title, sub, right, children }: {
  n: number; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className={`${cardCls} px-5 sm:px-6 py-5 space-y-4`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={stepBadgeCls}>{n}</span>
        <h2 className="text-sm font-semibold text-ink shrink-0">{title}</h2>
        {sub && <span className="text-xs text-ink-meta truncate">{sub}</span>}
        {right && <div className="ml-auto shrink-0">{right}</div>}
      </div>
      {children}
    </section>
  )
}

/** 카드 안의 한 줄 — **라벨 왼쪽 고정폭 + 입력 오른쪽** 한 모양으로 통일한다(좁은 화면에선 위아래).
 *  종전엔 1·2·3·4열 격자와 위-라벨이 섞여 줄이 안 맞았다(2026-09-23 「산만하다」). */
function Row({ label, required, htmlFor, children }: {
  label: string; required?: boolean; htmlFor?: string; children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[8em_minmax(0,1fr)] gap-x-4 gap-y-1.5 items-start">
      <label htmlFor={htmlFor} className={`${labelCls} sm:pt-3`}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="min-w-0 space-y-1.5">{children}</div>
    </div>
  )
}

type Employee = { id: string; name: string; position: string | null }
type ContactForm = { name: string; phone: string; email: string }
const emptyContact = (): ContactForm => ({ name: '', phone: '', email: '' })

export function CustomerNewClient({ employees, defaultRegionSi = '', purposes = [], initialAnchorDate = '', returnHref = '' }: {
  employees: Employee[]
  defaultRegionSi?: string
  /** 049 building_purposes — 관리자 > 건물 용도 관리 목록. datalist 제안(대장 자동값·신규 용도도 허용) */
  purposes?: string[]
  /** 점검달력에서 날짜를 짚어 열었을 때의 점검일자 프리필 (2026-09-22).
   *  아래 `useState` **lazy 초기값에만** 쓴다 — effect로 덮으면 미리보기가 두 번 돌고 수정값을 밀어낸다. */
  initialAnchorDate?: string
  /** 등록을 마치고 **돌아갈 자리** — URL `?from=`이 원천이다 (2026-09-22 사용자 요청:
   *  「입력 다 하고 다시 사이드바 화면으로 복귀 — 만약 사이드바에서 왔다면」).
   *  ⚠ 비어 있으면 종전대로 `/customers/{id}?created=1&onboarding=1`로 간다. 「사이드바에서
   *    왔는가」를 여기서 판정하지 않는다 — 보낸 쪽이 주소에 적어 줬거나 안 적어 줬거나 둘 뿐이다.
   *  ⚠ 값 검증(내부 경로인가)은 **페이지가** 한다 — 여기로 오는 건 이미 걸러진 값이다. */
  returnHref?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const openPostcode = useDaumPostcode()
  const customerNameRef = useRef<HTMLInputElement>(null)
  // ADD-2: 주소 중복 등록 감지 팝업 (+저장 시점 재검증)
  const [dupInfo, setDupInfo] = useState<{ customer?: AddressDuplicateCustomer; building?: AddressDuplicateBuilding } | null>(null)
  const dupAckRef = useRef('')            // '계속 등록'으로 확인 완료된 주소
  const pendingSubmitRef = useRef(false)  // 저장 시점 중복 확인 후 이어서 제출할지
  // 고객명 중복 — 주소와 달리 **차단**이라 확인(ack) 개념이 없다. 입력 중 경고 + 저장 시 팝업.
  const [nameDup, setNameDup] = useState<NameDuplicateCustomer | null>(null)
  const [nameWarn, setNameWarn] = useState<NameDuplicateCustomer | null>(null)
  const nameCheckSeq = useRef(0)          // 늦게 도착한 옛 응답이 최신 경고를 덮지 않게 한다
  // 건축물대장 소방안전 자료 (높이/주구조/승강기/세대수) — buildings 저장용
  const ledgerRef = useRef<BuildingLedgerInfo | null>(null)
  const bcodeRef = useRef<{ bcode: string; jibun: string } | null>(null)  // 092: 건물에 저장 → 대장 재조회 원클릭화
  const [ledgerNote, setLedgerNote] = useState('')
  // ADD-3: 관계인 — 대표만 기본, [추가] 버튼으로 직원1/직원2 노출
  const [visibleContactRoles, setVisibleContactRoles] = useState<Array<'대표' | '직원1' | '직원2'>>(['대표'])
  // §10(T9) 선택 항목(④ 추가 정보) — **기본 접힘**(2026-09-23). 두 칸 시절엔 오른쪽을 따로 써서 펼쳐 뒀지만,
  // 한 줄기로 세운 지금 펼쳐 두면 선택 칸이 필수(①~③)보다 길어져 다시 산만해진다.
  // 필수만으로 등록할 수 있고 전부 등록 후 상세에서도 고친다. 대장 자동값은 접힌 머리에 개수로 알린다.
  const [showOptional, setShowOptional] = useState(false)

  // ── 법정 일정 미리보기 (2026-09-14) ─────────────────────────────────────
  // 등록 폼은 점검일자를 필수로 받지만, 사용승인일도 필수라 신규 고객은 manual=false로 태어나
  // **항상 사용승인일이 이긴다** — 입력값이 안 쓰이는데 화면이 그 사실을 말하지 않았다.
  // 계산은 **서버의 실행 경로와 같은 함수**로 한다(달 산식·영업일 보정·기산점 해석 전부).
  const [schedPreview, setSchedPreview] = useState<NewSchedulePreview | null>(null)
  const [schedLoading, setSchedLoading] = useState(false)
  /** 법정 축을 벗어나 「입력한 점검일자」를 쓰겠다는 예외 — 전 직원 허용(2026-09-14 사용자 결정) */
  const [anchorManual, setAnchorManual] = useState(false)

  // 기본 지역 pre-fill: 시/군/구 ← 회사 기본, 읍/면 ← 최근 사용값(localStorage, 클라이언트에서만) — effect 대신 lazy 초기값
  const [form, setForm] = useState(() => ({
    customer_code: '',
    customer_name: '',
    contract_date: '',
    use_approval_date: '',
    /* 점검달력에서 날짜를 짚어 들어오면 그 날짜로 시작한다(2026-09-22).
       ⚠ **lazy 초기값에만** 꽂는다. `useEffect`로 나중에 덮으면 ①법정 일정 미리보기가 두 번 돌고
         ②사용자가 이미 고친 값을 덮는다. 프리필은 시작점이지 강제가 아니다 — 폼에서 바꿀 수 있다. */
    plan_anchor_date: initialAnchorDate,
    inspection_type: '종합' as InspectionType,
    // 일반관리 자체점검 종류 (소방계획서_6 W-1) — 일반관리도 종합/작동 선택, 다수 기본값 '작동'(D-2)
    general_sub_type: '작동' as '종합' | '작동',
    zipcode: '',
    address: '',
    region_si: defaultRegionSi,
    region_myeon: typeof window !== 'undefined' ? (localStorage.getItem('lastUsedMyeon') ?? '') : '',
    region_ri: '',
    notes: '',
    assigned_employee_id: '',
    // 건물 기본정보 (V9-3)
    building_purpose: '',
    building_floors_above: '',
    building_floors_below: '',
    building_total_area: '',
    building_year_built: '',
    // 소방안전관리등급 = customers.building_grade (별표4 대상물 급수) — 선택 입력
    building_grade: '',
  }))
  const [addrJibun, setAddrJibun] = useState('')

  const [contacts, setContacts] = useState({
    대표: emptyContact(),
    직원1: emptyContact(),
    직원2: emptyContact(),
  })

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function setContact(role: keyof typeof contacts, key: keyof ContactForm, value: string) {
    setContacts(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: value },
    }))
  }

  // 고객코드 자동 생성 — 서버 액션 호출(외부 시스템), setState는 응답 콜백에서만
  useEffect(() => {
    generateCustomerCodeAction('C').then(result => {
      if (result.code) setForm(prev => ({ ...prev, customer_code: result.code! }))
    }).catch(() => null)
  }, [])

  // 법정 일정 미리보기 — 두 날짜·종류·예외 스위치가 바뀔 때마다 다시 묻는다.
  // ⚠ 늦게 도착한 옛 응답이 최신 미리보기를 덮지 않게 세대(seq)로 막는다(고객명 중복 검사와 같은 규약).
  const schedSeq = useRef(0)
  const ua = form.use_approval_date, pa = form.plan_anchor_date
  const subForPreview: '종합' | '작동' =
    form.inspection_type === '일반관리' ? form.general_sub_type
    : form.inspection_type === '종합' ? '종합' : '작동'
  useEffect(() => {
    const uaOk = isCompleteDate(ua), paOk = isCompleteDate(pa)
    if (!uaOk && !paOk) { setSchedPreview(null); setSchedLoading(false); return }
    const my = ++schedSeq.current
    setSchedLoading(true)
    previewNewCustomerScheduleAction({
      use_approval_date: uaOk ? ua : null,
      plan_anchor_date: paOk ? pa : null,
      plan_anchor_manual: anchorManual,
      inspection_sub_type: subForPreview,
    }).then(res => {
      if (my !== schedSeq.current) return          // 낡은 응답 버림
      setSchedPreview(res.preview ?? null)
      setSchedLoading(false)
    }).catch(() => {
      if (my !== schedSeq.current) return
      setSchedPreview(null); setSchedLoading(false)  // 미리보기 실패가 등록을 막지는 않는다
    })
  }, [ua, pa, subForPreview, anchorManual])

  function handleAddressSearch() {
    openPostcode(data => {
      setAddrJibun(data.jibunAddress)
      // ADD-1: 지역 필드는 UI에서 제거됐지만 지역배정/필터/검색이 사용하므로 백그라운드 자동 저장 유지
      setForm(prev => ({
        ...prev,
        zipcode: data.zonecode,
        address: data.roadAddress,
        region_si: data.sigungu,
        region_myeon: data.bname1 || data.bname,
        region_ri: data.bname2 || '',
      }))

      // 주소 끝 괄호 안 건물명 자동추출 — **고객명이 비어 있을 때만** 채운다(2026-09-23).
      // 고객명이 첫 칸·첫 커서가 되면서 「이름부터 치고 주소 검색」이 정상 동선이 됐다. 종전처럼 무조건
      // 덮으면 사용자가 친 이름이 건물명으로 바뀐다. 판정은 **지금 칸에 보이는 값**(ref)으로 한다 —
      // 이 콜백은 팝업이 닫힐 때 불리므로 렌더 당시의 `form`은 낡았을 수 있다.
      const typedName = (customerNameRef.current?.value ?? '').trim()
      const building = typedName ? '' : extractBuildingName(data.roadAddress)
      if (typedName) {
        // 이미 친 이름은 손대지 않는다 — 포커스도 옮기지 않는다(사용자가 탭으로 이어 간다)
      } else if (building) {
        setForm(prev => ({ ...prev, customer_name: prev.customer_name.trim() ? prev.customer_name : building }))
        // 자동입력된 이름도 중복일 수 있다 — 손으로 안 쳤으니 blur가 안 나서 여기서 직접 검사한다
        checkNameNow(building)
        setTimeout(() => {
          customerNameRef.current?.select()  // 전체 선택 → 바로 덮어쓰기 가능
        }, 50)
      } else {
        setTimeout(() => {
          customerNameRef.current?.focus()   // 빈 칸 자동 포커스 → 바로 타이핑
        }, 50)
      }

      // ADD-2/ADD-4: 중복 고객·건물 확인 + 기존 건물정보 자동 로드
      checkAddressAction(data.roadAddress).then(res => {
        if (res.duplicate || res.duplicateBuilding) {
          setDupInfo({ customer: res.duplicate, building: res.duplicateBuilding })
        }
        if (res.building) {
          const b = res.building
          setForm(prev => ({
            ...prev,
            building_purpose:      prev.building_purpose      || (b.purpose ?? ''),
            building_total_area:   prev.building_total_area   || (b.total_area != null ? String(b.total_area) : ''),
            building_floors_above: prev.building_floors_above || (b.floors_above != null ? String(b.floors_above) : ''),
            building_floors_below: prev.building_floors_below || (b.floors_below != null ? String(b.floors_below) : ''),
            building_year_built:   prev.building_year_built   || (b.year_built != null ? String(b.year_built) : ''),
          }))
        }
      }).catch(() => null)

      // 건축물대장 API: 신규 주소도 소방안전 관련 건물정보 자동 조회 (키 미설정 시 조용히 건너뜀)
      setLedgerNote('')
      bcodeRef.current = data.bcode ? { bcode: data.bcode, jibun: data.jibunAddress } : null
      if (data.bcode) {
        fetchBuildingLedgerAction(data.bcode, data.jibunAddress).then(res => {
          if (res.unavailable || res.error || !res.info) {
            if (res.error) setLedgerNote(`건축물대장: ${res.error}`)
            return
          }
          const L = res.info
          ledgerRef.current = L
          // 건물 물리정보(용도/연면적/층수/준공연도) + 사용승인일 자동 채움.
          // 사용승인일 자동 적용: 계획 기산점이 점검계획일(필수 수동 입력)로 바뀌어 자동 입력해도 안전 (2026-07-13).
          // 이미 입력된 값은 덮어쓰지 않고, 채워진 뒤에도 자유롭게 편집·삭제 가능.
          setForm(prev => ({
            ...prev,
            use_approval_date:     prev.use_approval_date     || (L.use_approval_date ?? ''),
            building_purpose:      prev.building_purpose      || (L.purpose ?? ''),
            building_total_area:   prev.building_total_area   || (L.total_area != null ? String(L.total_area) : ''),
            building_floors_above: prev.building_floors_above || (L.floors_above != null ? String(L.floors_above) : ''),
            building_floors_below: prev.building_floors_below || (L.floors_below != null ? String(L.floors_below) : ''),
            building_year_built:   prev.building_year_built   || (L.use_approval_date ? L.use_approval_date.slice(0, 4) : ''),
          }))
          const extras = [
            L.use_approval_date && `사용승인일 ${L.use_approval_date} 자동 적용`,
            L.height != null && `높이 ${L.height}m`,
            L.main_structure && `구조 ${L.main_structure}`,
            L.elevator_count != null && `승강기 ${L.elevator_count}대`,
            L.emergency_elevator_count != null && `비상용 ${L.emergency_elevator_count}대`,
            L.households != null && `세대 ${L.households}`,
            L.seismic_design && `내진설계 ${L.seismic_design === '1' || L.seismic_design === 'Y' ? '적용' : '미적용'}`,
          ].filter(Boolean).join(' · ')
          setLedgerNote(`건축물대장 자동 조회 완료${extras ? ` — ${extras}` : ''}`)
        }).catch(() => null)
      }
    })
  }

  function handleSubmit() {
    setError('')
    if (!form.customer_code.trim()) { setError('고객코드 생성 중입니다. 잠시 후 다시 시도해주세요.'); return }
    if (!form.customer_name.trim()) { setError('고객명을 입력해주세요.'); return }
    if (!form.plan_anchor_date) { setError('점검일자를 입력해주세요.'); return }
    for (const [label, v] of [['계약일', form.contract_date], ['점검일자', form.plan_anchor_date], ['사용승인일', form.use_approval_date]] as const) {
      if (v && !isCompleteDate(v)) { setError(`${label}을(를) YYYY-MM-DD 형식으로 입력해주세요.`); return }
    }
    if (!contacts['대표'].name.trim()) { setError('대표 관계인 이름을 입력해주세요. (대표 1명 필수)'); return }

    // 고객명 중복은 **차단**이라 주소(경고)보다 먼저 본다 — 어차피 막힐 건이면 주소 경고 팝업을
    // 거쳐 두 번 묻게 할 이유가 없다. 여기서 통과해도 서버가 같은 검사를 다시 하므로 안전망은 남는다
    // (조회가 실패하면 통과시킨다 — 인프라 오류로 등록 자체를 막지는 않는다).
    startTransition(async () => {
      const res = await checkCustomerNameAction(form.customer_name.trim())
        .catch(() => ({} as { duplicate?: NameDuplicateCustomer }))
      if (res.duplicate) { setNameDup(res.duplicate); return }
      await submitAfterAddressCheck()
    })
  }

  /** 주소 중복 재검증(경고) 뒤 제출 — 이미 [계속 등록]으로 확인한 주소는 그대로 통과.
   *  주소 검색을 안 쓰고 손으로 친 주소는 여기서 처음 걸린다. */
  async function submitAfterAddressCheck() {
    const addr = form.address.trim()
    if (addr && dupAckRef.current !== addr) {
      const res = await checkAddressAction(addr).catch(() => ({} as Awaited<ReturnType<typeof checkAddressAction>>))
      if (res.duplicate || res.duplicateBuilding) {
        pendingSubmitRef.current = true
        setDupInfo({ customer: res.duplicate, building: res.duplicateBuilding })
        return
      }
      dupAckRef.current = addr
    }
    doSubmit()
  }

  /** 고객명 입력을 마쳤을 때의 사전 경고 — 저장까지 가지 않고 그 자리에서 알려 준다.
   *  응답이 순서를 바꿔 도착하면 옛 결과가 최신 경고를 덮으므로 시퀀스로 막는다. */
  function checkNameNow(value: string) {
    const name = value.trim()
    if (!name) { setNameWarn(null); return }
    const seq = ++nameCheckSeq.current
    checkCustomerNameAction(name)
      .then(res => { if (seq === nameCheckSeq.current) setNameWarn(res.duplicate ?? null) })
      .catch(() => null)
  }

  function doSubmit() {
    const contactInputs: ContactInput[] = (
      Object.entries(contacts) as [keyof typeof contacts, ContactForm][]
    )
      .filter(([, c]) => c.name.trim())
      .map(([role, c]) => ({
        role,
        name: c.name.trim(),
        phone: c.phone.trim() || undefined,
        email: c.email.trim() || undefined,
      }))

    startTransition(async () => {
      const result = await createCustomerAction({
        customer_code: form.customer_code.trim(),
        customer_name: form.customer_name.trim(),
        contract_date: form.contract_date || undefined,
        use_approval_date: form.use_approval_date || undefined,
        plan_anchor_manual: anchorManual,
        plan_anchor_date: form.plan_anchor_date,
        inspection_type: form.inspection_type,
        inspection_sub_type: form.inspection_type === '일반관리' ? form.general_sub_type : undefined,
        zipcode: form.zipcode.trim() || undefined,
        address: form.address.trim() || undefined,
        region_si: form.region_si.trim() || undefined,
        region_myeon: form.region_myeon.trim() || undefined,
        region_ri: form.region_ri.trim() || undefined,
        notes: form.notes.trim() || undefined,
        assigned_employee_id: form.assigned_employee_id || undefined,
        contacts: contactInputs,
        building_purpose:      form.building_purpose.trim() || undefined,
        building_floors_above: form.building_floors_above ? parseInt(form.building_floors_above) : undefined,
        building_floors_below: form.building_floors_below ? parseInt(form.building_floors_below) : undefined,
        building_total_area:   form.building_total_area   ? parseFloat(form.building_total_area)  : undefined,
        building_year_built:   form.building_year_built   ? parseInt(form.building_year_built)    : undefined,
        // 소방안전관리등급(별표4 대상물 급수) — 미선택이면 보내지 않는다(선택 입력)
        building_grade:        form.building_grade || undefined,
        // 건축물대장 소방안전 자료 (migration 037/038)
        building_bcode:           bcodeRef.current?.bcode ?? undefined,
        building_address_jibun:   bcodeRef.current?.jibun ?? undefined,
        building_height:          ledgerRef.current?.height ?? undefined,
        building_main_structure:  ledgerRef.current?.main_structure ?? undefined,
        building_elevator_count:  ledgerRef.current?.elevator_count ?? undefined,
        building_households:      ledgerRef.current?.households ?? undefined,
        building_emergency_elevator_count: ledgerRef.current?.emergency_elevator_count ?? undefined,
        building_roof_structure:  ledgerRef.current?.roof_structure ?? undefined,
        building_etc_purpose:     ledgerRef.current?.etc_purpose ?? undefined,
        building_ho_count:        ledgerRef.current?.ho_count ?? undefined,
        building_attached_count:  ledgerRef.current?.attached_building_count ?? undefined,
        building_seismic_design:  ledgerRef.current?.seismic_design ?? undefined,
        // 098 확장 — 대장이 줬는데 버려지던 4종(건축허가일·건축면적·건물동수·주차장)
        building_permit_date:     ledgerRef.current?.permit_date ?? undefined,
        building_area:            ledgerRef.current?.building_area ?? undefined,
        building_count:           ledgerRef.current?.building_count ?? undefined,
        building_parking_summary: ledgerRef.current?.parking_summary ?? undefined,
      })
      if (result.error) { setError(result.error); return }
      // 다음 등록을 위한 최근 읍/면 기억
      if (form.region_myeon.trim()) localStorage.setItem('lastUsedMyeon', form.region_myeon.trim())
      // §10-3: 등록 직후 상세(탭)로 — created=1 보완 안내 + 온보딩 진행 띠
      // 🚨 **`tab=plan`을 붙이지 않는다** (2026-09-15 사용자 확정). 종전엔 여기서 소방계획서로
      //    직행시켜 건물·시설과 관계인을 통째로 건너뛰었다 — 그래서 용도가 비었다.
      //    어느 탭을 열지는 **저장된 값을 아는 서버**가 정한다(첫 미완 탭 — lib/onboarding-steps).
      //    폼 state로 여기서 고르면 대장 자동값·부분 실패와 어긋난다(화면과 데이터가 갈린다).
      // ⚠ router.refresh()를 뒤에 붙이지 않는다 — push가 이미 새 경로의 RSC를 받아오는데
      // refresh가 같은 페이지를 한 번 더 받아 **상세 화면 로딩이 두 번** 일어났다.
      // 목록 캐시는 액션의 revalidatePath('/customers')가 이미 무효화한다.
      /* 달력에서 왔으면 **보낸 자리로 돌려보낸다**(2026-09-22 사용자 요청). 데이 패널이 열린 채
         떠났으면 그 주소에 `day=`가 실려 있어 **그 사이드바가 다시 열린다**.
         ⚠ 방금 만든 고객의 계획·단계 칩은 그 목록에 이미 들어 있다 — 서버가 새로 그리기 때문이다.
         ⚠ 여기서 `refresh()`를 덧붙이지 않는다(위 주석과 같은 이유 — push가 이미 RSC를 받는다). */
      if (returnHref) { router.push(returnHref); return }
      router.push(`/customers/${result.customerId}?created=1&onboarding=1`)
    })
  }

  // 일반관리 = 소방안전관리와 동일 자체점검(종합/작동), 정기점검만 없음 (소방계획서_6 D-1)
  const INSPECTION_ANNUAL: Record<InspectionType, string> = {
    '종합':     '연 12회 자동 생성 (종합 2회 + 정기 10회)',
    '작동':     '연 12회 자동 생성 (작동 1회 + 정기 11회)',
    '일반관리': form.general_sub_type === '종합'
      ? '연 2회 자동 생성 (종합 2회 — 정기 없음)'
      : '연 1회 자동 생성 (작동 1회 — 정기 없음)',
  }

  // §10-2(T9): 필수 충족 체크 — 하단 바 칩·[등록] 활성화.
  // 순서 = **화면 순서**(① 고객명·주소 → ② 사용승인일·점검일자·점검유형 → ③ 대표) — 칩이 위→아래로 읽힌다.
  const requiredChecks: Array<[string, boolean]> = [
    ['고객명', !!form.customer_name.trim()],
    ['주소', !!form.address.trim()],
    // 사용승인일은 법정 점검 시기의 기산점이다 — 종합점검은 사용승인일이 속하는 달,
    // 작동점검은 그로부터 6개월(시행규칙 [별표 3]). 비어 있으면 그 달을 계산할 수 없고
    // 최초점검(사용승인일+60일) 판정도 불가능해 별지 9호 3분기를 정할 수 없다.
    // 대부분 건축물대장 자동 조회로 저절로 채워진다(칸 옆 [적용] 버튼).
    ['사용승인일', isCompleteDate(form.use_approval_date)],
    ['점검일자', isCompleteDate(form.plan_anchor_date)],
    ['점검유형', !!form.inspection_type],
    ['대표 관계인', !!contacts['대표'].name.trim()],
  ]
  const allFieldsOk = requiredChecks.every(c => c[1])
  const requiredOk = allFieldsOk && !!form.customer_code.trim()  // 고객코드 자동 생성 완료까지 등록 보류
  // typeLabel·assignedName은 '등록 요약' 패널 전용이었다 — 패널을 없애면서 함께 제거.
  // 두 값 모두 입력칸에 그대로 보이므로 파생 표시가 필요 없다.

  /* 건축물대장·기존 건물이 채워 준 건물정보 칸 수 — 접힌 ④ 머리에 「열어 볼 이유」로 보인다 */
  const autoBuildingCount = [form.building_purpose, form.building_total_area, form.building_floors_above,
    form.building_floors_below, form.building_year_built].filter(v => v.trim()).length

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleSubmit() }}>
    {/* 한 줄기 네 카드 (2026-09-23 사용자 요청 — 「너무 산만하게 분산되어 있다」).
        종전은 좌 필수 | 우 선택 두 칸이었는데 ①필수인 사용승인일이 오른쪽(선택)에 있어 눈이 좌우를 오갔고
        ②선택인 등급이 필수 칸 사이에 끼었고 ③오른쪽이 기본 펼침이라 필수보다 길었고 ④1·2·3·4열 격자가
        섞여 줄이 안 맞았다. 이제 **위→아래가 입력 순서이자 탭 순서**다: ① 건물 → ② 점검 일정 → ③ 관계인
        → ④ 추가 정보(선택·기본 접힘). 필수는 ①~③에만, 선택은 ④에만 둔다.
        ⚠ 카드 안은 모두 `Row`(라벨 왼쪽 고정폭 + 입력 오른쪽) 한 모양이다 — 줄이 자로 잰 듯 맞는다.
        ⚠ 「한 화면에 다 보이게」는 이제 하단 바가 대신한다(sticky — 스크롤해도 필수 칩·[등록]이 보인다). */}
    <div className="max-w-3xl space-y-4">
      {/* ① 건물 — 고객명이 **첫 칸이자 첫 커서**(2026-09-23 사용자 요청). 주소 검색이 건물명을 채워 주던
          「주소 먼저」 흐름은 그대로 쓸 수 있다 — 고객명이 비어 있을 때만 채우므로(handleAddressSearch)
          이름부터 쳐도 지워지지 않는다. */}
      <Section n={1} title="건물" sub="주소 검색 한 번이면 사용승인일·건물정보가 자동으로 채워집니다">
        <Row label="고객명 (건물명)" required htmlFor="new-customer-name">
          <div className="relative">
            <input
              id="new-customer-name"
              ref={customerNameRef}
              autoFocus
              value={form.customer_name}
              // 타이핑 중에는 경고를 지운다 — 고치는 중에 옛 경고가 남아 있으면 이미 해결한 걸로 착각한다
              onChange={e => { setField('customer_name', e.target.value); setNameWarn(null) }}
              onBlur={e => checkNameNow(e.target.value)}
              placeholder="주소 검색 시 자동입력 또는 직접 입력"
              className={`${inputCls} ${nameWarn ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''}`}
            />
            {form.customer_name && (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => { setField('customer_name', ''); setNameWarn(null); customerNameRef.current?.focus() }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-meta hover:text-ink-sub"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {nameWarn && (
            <p className="text-form-xs text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5">
              「{nameWarn.customer_name}」(고객코드 {nameWarn.customer_code})으로 이미 등록돼 있습니다 — 이 이름으로는 등록할 수 없습니다.{' '}
              <Link href={`/customers/${nameWarn.id}`} className="underline font-medium">기존 고객 보기</Link>
            </p>
          )}
        </Row>

        {/* 도로명주소 — requiredChecks의 '주소'가 이 값이다(비면 [등록] 비활성). 검색 버튼을 칸 옆에 붙였다. */}
        <Row label="주소" required htmlFor="new-address">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
              <input
                id="new-address"
                value={form.address}
                onChange={e => setField('address', e.target.value)}
                placeholder="주소 검색 후 동/호수 등 추가 입력"
                className={`${inputCls} pl-8`}
              />
            </div>
            <button
              type="button"
              onClick={handleAddressSearch}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-xs font-medium transition-colors shrink-0"
            >
              <Search className="size-3.5" />
              주소 검색
            </button>
          </div>
          {/* 우편번호·지번은 **읽기 전용 입력칸**이던 것을 글자 한 줄로 — 탭이 거기 걸리지 않는다.
              ADD-1: 지역(region_si/myeon/ri)은 UI 없이 주소 검색 시 백그라운드 저장(지역배정·필터·검색) */}
          {(form.zipcode || addrJibun) && (
            <p data-testid="new-address-meta" className="text-form-xs text-ink-meta">
              {form.zipcode && <>우편번호 {form.zipcode}</>}
              {form.zipcode && addrJibun && ' · '}
              {addrJibun && <>지번 {addrJibun}</>}
            </p>
          )}
          {ledgerNote && (
            <p className={`text-form-xs ${ledgerNote.startsWith('건축물대장 자동') ? 'text-green-600' : 'text-amber-500'}`}>
              {ledgerNote}
            </p>
          )}
        </Row>
      </Section>

      {/* ② 점검 일정 — 사용승인일을 **점검일자 바로 위**로 옮겼다(종전엔 오른쪽 선택 칸 안).
          사용승인일이 있으면 그게 법정 기산점이라 점검일자의 뜻을 정한다 — 둘이 붙어 있어야
          「어느 날짜가 쓰이는가」가 한눈에 읽힌다. */}
      <Section n={2} title="점검 일정">
        <Row label="사용승인일" required htmlFor="new-use-approval">
          <div className="flex flex-wrap items-center gap-2">
            <DateInput
              id="new-use-approval"
              value={form.use_approval_date}
              onChange={e => setField('use_approval_date', e.target.value)}
              className={`${inputCls} max-w-[13rem]`}
            />
            {ledgerRef.current?.use_approval_date && !form.use_approval_date && (
              <button
                type="button"
                onClick={() => setField('use_approval_date', ledgerRef.current!.use_approval_date!)}
                className="text-form-xs text-brand hover:underline"
              >
                건축물대장 사용승인일 {ledgerRef.current.use_approval_date} 적용
              </button>
            )}
          </div>
          {/* 이 칸이 **무엇을 정하는지** 그 자리에서 말한다 (2026-09-22 사용자 요청).
              종전엔 아무 말도 없어서, 위 [점검일자]를 찍은 사용자는 자기가 고른 날짜로
              일정이 잡히는 줄 알았다 — 실측 65%가 사용승인일에 밀려 다른 날에 앉았고
              90명은 아예 달이 달랐다. 어느 칸이 이기는지를 입력 중에 보여준다.
              ⚠ 막지 않는다. 사용승인일을 **못 내는** 건물이 실재한다(군부대·쉼터 등 —
                건축물대장 조회가 실패하는 건들). 막으면 그 고객은 등록 자체가 안 된다. */}
          {isCompleteDate(form.use_approval_date) ? (
            <p data-testid="new-anchor-legal" className="text-form-2xs text-ink-meta leading-relaxed">
              이 날짜 기준으로 <b className="text-ink-sub">종합·작동·정기</b>가 잡힙니다 — 법정 기산점입니다.
            </p>
          ) : (
            <p data-testid="new-anchor-provisional" className="text-form-2xs text-amber-700 leading-relaxed">
              ⚠ 사용승인일이 없어 <b>점검일자로 잠정 배치</b>됩니다.
              일정은 <b>그대로 생성</b>되고(종합·작동·정기), 나중에 사용승인일을 넣으면 <b>법정 자리로 자동 재배치</b>됩니다.
            </p>
          )}
        </Row>

        <Row label="점검일자" required htmlFor="new-anchor-date">
          <DateInput
            id="new-anchor-date"
            value={form.plan_anchor_date}
            onChange={e => setField('plan_anchor_date', e.target.value)}
            className={`${inputCls} max-w-[13rem]`}
          />
          {/* ⚠ 종전 문구는 "이 날짜의 월·일 기준으로 일정이 확정됩니다"였는데 **거짓**이었다 —
              사용승인일도 필수라 신규 고객은 늘 사용승인일이 기산점이 된다(2026-09-14 실측 158/162).
              무엇이 실제로 쓰이는지는 아래 미리보기가 답한다. */}
          <p className="text-form-xs text-ink-meta">등록일이 아닌 연간 점검의 기산일 — 사용승인일이 있으면 <b>법정 기산점은 사용승인일</b>입니다</p>
          {/* 미래 날짜면 **지금은 단계가 안 생긴다**는 사실을 등록 전에 말한다 (2026-09-22).
              막지 않는다 — 달력에서 앞당겨 잡는 것은 정상 동선이고, 막으면 그 자리에서
              할 수 없는 일을 요구받는다(`inspection-step-links.ts:37`의 확립된 기울기).
              ⚠ 판정은 **서버와 같은 순수 함수**(`isPastAnchor`)로 한다 — 두 벌로 적으면
                「생긴다고 했는데 안 생기는」 어긋남이 곧바로 생긴다. */}
          {isCompleteDate(form.plan_anchor_date)
            && !isPastAnchor(form.plan_anchor_date, todayKst()) && (
            <p data-testid="anchor-future-note" className="text-form-2xs text-amber-700">
              이 날짜는 <b>계획</b>으로 잡힙니다 — 1~4단계는 점검 당일에 열립니다.
            </p>
          )}
        </Row>

        {/* 점검유형 — 라디오를 **세그먼트 버튼** 모양으로(라디오 자체는 남긴다: 화살표 키·name 묶음이 그대로 산다).
            자체점검 종류 — 소방안전관리·일반관리 공통 종합/작동 선택 (소방계획서_6 W-1) */}
        <Row label="점검유형" required>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="관리 구분" className="inline-flex rounded-lg border border-line overflow-hidden">
              {(['소방안전관리', '일반관리'] as const).map(cat => {
                const checked = cat === '일반관리' ? form.inspection_type === '일반관리' : form.inspection_type !== '일반관리'
                return (
                  <label key={cat} className={`${segCls} ${checked ? segOnCls : segOffCls}`}>
                    <input
                      type="radio"
                      name="inspection_category"
                      checked={checked}
                      onChange={() => setField('inspection_type', cat === '일반관리' ? '일반관리' : '종합')}
                      className="sr-only"
                    />
                    {cat}
                  </label>
                )
              })}
            </div>
            <div role="radiogroup" aria-label="자체점검 종류" className="inline-flex rounded-lg border border-line overflow-hidden">
              {(['종합', '작동'] as const).map(sub => {
                const isGeneral = form.inspection_type === '일반관리'
                const checked = isGeneral ? form.general_sub_type === sub : form.inspection_type === sub
                return (
                  <label key={sub} className={`${segCls} ${checked ? segOnCls : segOffCls}`}>
                    <input
                      type="radio"
                      name="inspection_sub_type"
                      checked={checked}
                      onChange={() => isGeneral ? setField('general_sub_type', sub) : setField('inspection_type', sub)}
                      className="sr-only"
                    />
                    {sub} <span className={`text-form-2xs ${checked ? 'text-white/80' : 'text-ink-meta'}`}>({sub === '종합' ? '연2회' : '연1회'})</span>
                  </label>
                )
              })}
            </div>
          </div>
          {form.inspection_type && (
            <p className="text-form-xs text-ink-meta">
              {form.inspection_type !== '일반관리' ? `소방안전관리 › ${form.inspection_type}` : `일반관리 › ${form.general_sub_type}`} — {INSPECTION_ANNUAL[form.inspection_type]}
            </p>
          )}
        </Row>

        {/* 법정 일정 미리보기 — 두 날짜·종류가 다 정해진 **맨 아래**에서 결과를 보여 준다 */}
        <NewSchedulePreviewBox
          preview={schedPreview}
          loading={schedLoading}
          anchorManual={anchorManual}
          onToggleManual={setAnchorManual}
          canOverride
        />
      </Section>

      {/* ③ 관계인 — 대표 1명 필수, 추가는 최대 2명(ADD-3). 추가 행도 대표와 **같은 3칸 격자**다. */}
      <Section
        n={3}
        title="관계인"
        right={visibleContactRoles.length < 3 ? (
          <button
            type="button"
            onClick={() => setVisibleContactRoles(prev =>
              prev.length === 1 ? [...prev, '직원1'] : [...prev, '직원2']
            )}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand-tint text-brand text-xs font-medium transition-colors border border-brand-line"
          >
            <Plus className="size-3" />
            관계인 추가
          </button>
        ) : undefined}
      >
        <Row label="대표" required htmlFor="contact-대표-name">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              id="contact-대표-name"
              value={contacts['대표'].name}
              onChange={e => setContact('대표', 'name', e.target.value)}
              placeholder="대표 이름 *"
              className={inputCls}
            />
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-ink-faint" />
              <input
                value={contacts['대표'].phone}
                onChange={e => setContact('대표', 'phone', formatPhoneKR(e.target.value))}
                inputMode="tel"
                aria-label="대표 연락처"
                placeholder="010-0000-0000"
                className={`${inputCls} pl-7`}
              />
            </div>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3 text-ink-faint" />
              <input
                type="email"
                value={contacts['대표'].email}
                onChange={e => setContact('대표', 'email', e.target.value)}
                aria-label="대표 이메일"
                placeholder="example@email.com"
                className={`${inputCls} pl-7`}
              />
            </div>
          </div>
        </Row>
        {visibleContactRoles.filter(r => r !== '대표').map(role => (
          <Row key={role} label="추가 관계인" htmlFor={`contact-${role}-name`}>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <input
                id={`contact-${role}-name`}
                value={contacts[role].name}
                onChange={e => setContact(role, 'name', e.target.value)}
                placeholder="이름"
                className={inputCls}
              />
              <input
                value={contacts[role].phone}
                onChange={e => setContact(role, 'phone', formatPhoneKR(e.target.value))}
                inputMode="tel"
                aria-label="추가 관계인 연락처"
                placeholder="010-0000-0000"
                className={inputCls}
              />
              <input
                type="email"
                value={contacts[role].email}
                onChange={e => setContact(role, 'email', e.target.value)}
                aria-label="추가 관계인 이메일"
                placeholder="example@email.com"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => {
                  setContact(role, 'name', ''); setContact(role, 'phone', ''); setContact(role, 'email', '')
                  setVisibleContactRoles(prev => prev.filter(r => r !== role))
                }}
                className="justify-self-start text-ink-meta hover:text-red-500 transition-colors p-1"
                title="관계인 제거"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </Row>
        ))}
      </Section>

      {/* ④ 추가 정보 — 선택 항목만. **기본 접힘**: 필수만으로 등록할 수 있고 전부 등록 후 상세에서도 고친다.
          대장·기존 건물이 채워 준 값이 있으면 머리에 개수를 달아 「열어 볼 이유」를 알린다. */}
      <section className={cardCls}>
        <button
          type="button"
          data-testid="new-optional-toggle"
          aria-expanded={showOptional}
          onClick={() => setShowOptional(v => !v)}
          className="w-full flex items-center gap-2 px-5 sm:px-6 py-4 text-left"
        >
          <span className={stepBadgeCls}>4</span>
          <span className="text-sm font-semibold text-ink">추가 정보</span>
          <span className="text-xs text-ink-meta truncate">선택 — 담당 · 계약일 · 등급 · 건물정보 · 비고 (등록 후에도 입력 가능)</span>
          {autoBuildingCount > 0 && (
            <span data-testid="new-optional-auto" className="shrink-0 text-form-2xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">
              자동 채움 {autoBuildingCount}칸
            </span>
          )}
          {showOptional ? <ChevronDown className="size-4 text-brand ml-auto shrink-0" /> : <ChevronRight className="size-4 text-brand ml-auto shrink-0" />}
        </button>

        {showOptional && (
        <div data-testid="new-optional-body" className="px-5 sm:px-6 pb-6 space-y-4">
          <Row label="담당직원" htmlFor="new-assignee">
            <select
              id="new-assignee"
              value={form.assigned_employee_id}
              onChange={e => setField('assigned_employee_id', e.target.value)}
              className={`${inputCls} max-w-xs`}
            >
              <option value="">배정 안함</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.position ? ` (${e.position})` : ''}
                </option>
              ))}
            </select>
            {form.assigned_employee_id && (
              <p className="text-form-xs text-ink-sub">배정 즉시 해당 직원에게 알림이 발송됩니다.</p>
            )}
          </Row>
          <Row label="계약일" htmlFor="new-contract-date">
            <DateInput
              id="new-contract-date"
              value={form.contract_date}
              onChange={e => setField('contract_date', e.target.value)}
              className={`${inputCls} max-w-[13rem]`}
            />
          </Row>

          {/* 소방안전관리등급 (2026-08-20) — 별지 9호 2쪽 «소방안전정보»에 실리는 대상물 급수(별표4).
              **필수로 걸지 않는다**: 별표4의 2·3급은 설비 설치 여부로 갈리는데 등록 폼엔 설비 입력이 없어
              등록 시점에 자동 산정이 사실상 불가하다. 실측상 최근 1년 등록 321건 중 315건이 미입력이었고,
              필수로 걸었다면 그 전부가 등록 자체를 못 했다(2026-08-20). 아는 사람은 여기서 바로 채운다.
              ⚠ 2026-09-23 필수 칸 사이에서 ④로 옮겼다 — 98%가 비워 두는 칸이 필수 흐름을 끊고 있었다. */}
          <Row label="소방안전관리등급">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                {(['특급', '1급', '2급', '3급'] as const).map(g => (
                  <button key={g} type="button"
                    aria-pressed={form.building_grade === g}
                    onClick={() => setField('building_grade', form.building_grade === g ? '' : g)}
                    className={`${segCls} ${form.building_grade === g ? segOnCls : segOffCls}`}>
                    {g}
                  </button>
                ))}
              </div>
              <span className="text-form-xs text-ink-meta">
                모르면 비워두세요 — 관계인 탭 [소방안전관리]에서 나중에 입력·자동 산정할 수 있습니다
              </span>
            </div>
          </Row>

          {/* 건물 기본정보 (V9-3) — 대장 자동값 확인·보정. 다섯 칸을 한 줄 격자로(용도만 두 칸 폭). */}
          <Row label="건물 기본정보">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
              <div className="col-span-2 space-y-1">
                <p className="text-form-2xs text-ink-meta">건물용도</p>
                {/* 049 building_purposes 목록 제안 — select가 아닌 콤보: 건축물대장이 목록에 없는 용도를
                    자동 입력하는 경우가 있어 강제하면 값이 잘린다 (buildings.purpose는 자유 TEXT).
                    datalist에서 ComboInput으로 교체(2026-08-19) — datalist는 타이핑 전에는 목록이
                    안 떠서 "선택하거나"가 거짓말이었다. 이제 칸을 누르면 전체가 펼쳐진다. */}
                <ComboInput
                  value={form.building_purpose}
                  onChange={v => setField('building_purpose', v)}
                  options={purposes}
                  ariaLabel="건물용도"
                  placeholder={purposes.length > 0 ? '선택하거나 직접 입력' : '예: 업무시설, 근린생활시설'}
                  className={inputCls}
                />
              </div>
              {([
                ['building_total_area',   '연면적 (㎡)', '1500.5', { min: '0', step: '0.01' }],
                ['building_floors_above', '지상층수',    '5',      { min: '0' }],
                ['building_floors_below', '지하층수',    '1',      { min: '0' }],
                ['building_year_built',   '준공연도',    '2005',   { min: '1900', max: String(new Date().getFullYear()) }],
              ] as const).map(([key, label, ph, attrs]) => (
                <div key={key} className="space-y-1 min-w-0">
                  <p className="text-form-2xs text-ink-meta">{label}</p>
                  <input
                    type="number"
                    aria-label={label}
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    placeholder={`예: ${ph}`}
                    {...attrs}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </Row>

          <Row label="비고" htmlFor="new-notes">
            <textarea
              id="new-notes"
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="특이사항 메모"
              rows={2}
              className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none"
            />
          </Row>
        </div>
        )}
      </section>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* 하단 바 — **화면 아래에 붙어 있다**(sticky). 한 줄기로 세우면서 폼이 길어졌으므로
          스크롤해도 필수 칩과 [등록]이 늘 보이게 한다. 칩은 화면 순서(① → ③)대로 읽힌다. */}
      <div
        data-testid="new-submit-bar"
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 py-3 bg-surface/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
      >
        {/* 좁은 폭에선 칩이 한 줄을 통째로 쓰고 버튼은 아래로 — 버튼 옆에 끼면 칩 글자가 한 자씩 꺾인다 */}
        <div className="flex flex-wrap gap-1 items-center min-w-0 basis-full sm:basis-0 sm:flex-1">
          <span className="text-form-2xs text-ink-meta shrink-0">필수</span>
          {requiredChecks.map(([label, ok]) => (
            <span key={label as string}
              className={`inline-flex items-center gap-0.5 whitespace-nowrap text-form-2xs px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {ok && <Check className="size-2.5" />}{label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          className="h-11 px-6 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors shrink-0"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isPending || !requiredOk}
          className="h-11 px-8 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50 shrink-0"
        >
          {isPending ? <Loader2 className="size-4 animate-spin" />
            : requiredOk ? '고객 등록'
            : allFieldsOk ? '고객코드 생성 중…'
            : '필수 항목을 채워주세요'}
        </button>
      </div>
    </div>

      {/* 고객명 중복 — 차단 팝업 ([계속 등록] 없음). 주소 축과 정책이 다르다 */}
      {nameDup && (
        <NameDuplicateDialog
          customer={nameDup}
          onClose={() => {
            setNameWarn(nameDup)      // 팝업을 닫아도 칸 아래 경고는 남긴다
            setNameDup(null)
            customerNameRef.current?.select()
          }}
        />
      )}

      {/* ADD-2: 주소 중복 등록 안내 팝업 — 확인 후 등록 진행 가능 */}
      {dupInfo && (
        <AddressDuplicateDialog
          customer={dupInfo.customer}
          building={dupInfo.building}
          address={form.address.trim()}
          onClose={() => setDupInfo(null)}
          onContinue={() => {
            dupAckRef.current = form.address.trim()
            setDupInfo(null)
            if (pendingSubmitRef.current) { pendingSubmitRef.current = false; doSubmit() }
          }}
        />
      )}
    </form>
  )
}
