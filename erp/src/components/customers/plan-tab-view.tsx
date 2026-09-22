'use client'

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, Info, FileText } from 'lucide-react'
import { importLegacyFormAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { autoApplyLedgerEmptyAction } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { applyPlanTextDefaultsAction } from '@/app/(dashboard)/customers/plan-text-library-actions'
import { DateInput } from '@/components/ui/date-input'
import { TableWrap } from '@/components/ui/fields'
import { collectPlanSaveHandlers, useUnsavedNavGuard } from '@/components/ui/unsaved-nav'
import { useCustomerTabs } from '@/components/customers/customer-tabs'
import { FIRE_PLAN_CHIP_TARGET, FIRE_PLAN_CHIP_LABEL } from '@/lib/fire-plan-chip-target'
import { PLAN_TREE_FORMS, PLAN_TREE_FORM_KEYS, formOfCard, tabOfForm, sectionsOfForm, type FirePlanFormKey } from '@/lib/fire-plan-sections'
import { FirePlanXlsxButton } from '@/components/customers/fire-plan-xlsx-button'
import { firePlanPdfUrl } from '@/lib/fire-plan-doc-urls'
import { parseFirePlanNotice } from '@/lib/fire-plan-notice'
import { focusDetailPanel, focusTreeNode, treeKeyAction } from '@/components/customers/tree-keyboard'
import { PlanBlankReport } from '@/components/customers/plan-blank-report'
import type { FormBlankSummary } from '@/lib/fire-plan-blanks'
import { RevisionHistory } from '@/components/customers/revision-history'
import { FontScaleSettingsClient } from '@/components/settings/font-scale-settings-client'
import type { RevisionYearGroup } from '@/app/(dashboard)/customers/fire-plan-revision-actions'

/** 소방계획서 탭 (§1 개정 구조 — P6: 좌측 목차 트리 + 서식 화면, 소방계획서_4.md §1·§1-1·§2·§9-8)
 *  진입 = 1.1 일반현황 입력폼(2026-08-06 사용자 확정 — ⚡ 빠른 입력 요약 페이지 폐기).
 *  좌측 목차 트리 + 서식 화면, form= 딥링크. 일반관리도 동일 (소방계획서_6 W-14). */

// 개정이력은 마이그레이션 120 fire_plan_revisions로 승격됐다 — 구 RevisionRow(fire_plans 파생)는 폐기

/** 11-5: 누락 칩 → 입력처 딥링크 (필수 완성도 라벨 기준)
 *
 *  ⚠ **지금 실제로 뜨는 칩은 form11 계열뿐이다.** 칩은 readiness.missing으로만 만들어지는데
 *  (아래 렌더 지점) computeFirePlanReadiness가 내보내는 라벨은 1.1 일반현황 10개가 전부다 —
 *  수신기위치·구조·지붕·선임일·급수·화재보험·운영시간·인원·자위소방대·선임 형태.
 *  따라서 아래 info(주소·사용승인일)·buildings(높이·세대수 등) 항목과 gotoMissing의 해당
 *  분기는 **도달하지 않는다**. 이 표를 도입한 커밋(0c8e095, 2026-07-23) 시점에도 readiness는
 *  같은 9개뿐이었으니 나중에 유실된 게 아니라 처음부터 그랬다.
 *
 *  그래도 지우지 않는다: 준비율에 주소·건물 항목을 편입하면(1.1 완성도 분모와 탭 경고가 함께
 *  바뀌는 제품 결정이다) 이 매핑이 즉시 필요해지고, 없으면 칩이 form11로 떨어져 엉뚱한 탭을
 *  연다. 대신 '지금은 안 뜬다'는 사실은 test-cd-ui가 단언으로 붙들고 있다 —
 *  그게 없어서 낡은 E2E가 오래 빨간 채로 방치됐다(2026-08-19 정리).
 */
/* 🚨 표는 `lib/fire-plan-chip-target`로 **이사했다**(2026-09-22) — 점검달력에도
   [소방계획서 엑셀]이 생기면서 같은 표가 필요해졌다. 여기 복제해 두면 한쪽만 고쳐져
   「주소」 칩이 화면마다 다른 데로 간다. 라벨 표도 함께 옮겼다. */
const CHIP_TARGET = FIRE_PLAN_CHIP_TARGET
const CHIP_TARGET_LABEL = FIRE_PLAN_CHIP_LABEL
const CHIP_FIELD_ID: Record<string, string> = {
  '주소': 'cf-address', '사용승인일': 'cf-approval',
  '건물 용도': 'bf-purpose', '연면적': 'bf-total-area', '층수': 'bf-floors-above',
  '건축허가일': 'bf-permit-date', '건축면적': 'bf-building-area', '높이': 'bf-height',
  '세대수': 'bf-households', '건물동수': 'bf-building-count', '승강기': 'bf-elevator',
  '주차장': 'bf-parking',
}

/** 1장 서식 목차 (소방계획서_4.md §3 순서) — **`lib/fire-plan-sections`가 정본**이다.
 *
 *  목차가 종전엔 여기(`CH1_FORMS`)·바로 아래(`VALID_SEL`)·`[id]/page.tsx`(`formStatus` 키)
 *  **세 곳**에 각자 있었다. 셋이 갈라지면 딥링크가 조용히 엉뚱한 화면을 연다.
 *  ⚠ 여기 손목록을 되살리지 않는다 — 이제 50시트 대장과 1:1이 적재 시점에 검증된다.
 *  PLAN_TREE_*는 이사 노드(1.1·1.4 → 최상위 [공통] 탭, 2026-09-20 3분리)를 뺀 **화면 트리** 축이다 —
 *  구 딥링크 ?form=1.1·1.4는 page.tsx가 서버에서 그 탭으로 해석하므로 여기 올 일이 없다. */
const CH1_FORMS = PLAN_TREE_FORMS.filter(f => f.group === '본문 1장')
/** 랜딩 노드 — 1.1이 공통 탭으로 이사해 1장의 첫 노드(1.2)가 랜딩이다. 손글자 금지(트리 파생) */
const LANDING = CH1_FORMS[0]?.key ?? 'ch2'

/** 목차 완성도 — true=입력 있음(✓), false=비어 있음(○), {done,total}=게이지형(1.1) */
export type FormStatusMap = Record<string, boolean | { done: number; total: number }>

export function PlanTabView({
  customerId, canManage, readiness, revisionYears, importCandidate, initialSection, initialForm, formStatus,
  blankSummary, archive,
  form12, form13, form15, form16, form17, form18, form110, form111, form1215, ch2, ch3, formCover,
  ledgerAutoNeeded, textDefaultsNeeded,
}: {
  customerId: string
  canManage: boolean
  ledgerAutoNeeded?: boolean   // 진입 시 자동 대장 조회 대상: bcode 있고 아직 미동기화(ledger_synced_at null)
  textDefaultsNeeded?: boolean // 진입 시 공통 서술 기본항목 자동주입 대상: 기본항목 있고 스탬프 없는 섹션 존재 (소방계획서_15_별도라이브러리 §4-0)
  // purpose는 생성 버튼(프리셋 추천) 전용이었고 보관함으로 이관했다 (소방계획서_21 R2-11)
  readiness: { done: number; total: number; missing: string[] }
  revisionYears: RevisionYearGroup[]   // 개정이력 연도별 히스토리 (120 — 소방계획서_17)
  importCandidate?: boolean
  initialSection?: string
  initialForm?: string          // §1-3 딥링크 ?tab=plan&form=1.1 (sub=보다 우선)
  formStatus?: FormStatusMap    // §1-1·1-4 목차 완성도
  /** 노드별 엑셀 빈칸 정적 요약 — 고객 축이 없어 서버가 미리 센다(lib/fire-plan-blanks) */
  blankSummary?: Record<string, FormBlankSummary>
  archive: ReactNode
  // form11·form14 prop 폐지 — 1.1·1.4는 최상위 [공통] 탭으로 승격됐다(2026-09-20 사용자 확정 3분리).
  // annex prop 폐지(아래)와 같은 이유로 여기 남겨두면 두 곳 마운트 = 조회 왕복 이중.
  // 진입점은 customers/[id]/page.tsx의 facilitiesTab 한 곳.
  form12: ReactNode
  form13: ReactNode
  form15: ReactNode
  form16: ReactNode
  form17: ReactNode
  form18: ReactNode
  form110: ReactNode
  form111: ReactNode
  form1215: ReactNode
  ch2: ReactNode
  ch3: ReactNode
  formCover: ReactNode            // 보고서 커버 — 생성 문서 마지막 페이지 업체명·연도 (2026-08-10, 본문 그룹 마지막 노드)
  // annex prop 폐지 — 별지 서식은 고객 상세의 최상위 탭으로 승격됐다 (소방계획서_34 S3).
  // 여기 남겨두면 두 곳에서 마운트돼 회차 조회 왕복이 이중으로 뜬다. 진입점은 customers/[id]/page.tsx의 annexTab 한 곳.
}) {
  const router = useRouter()
  const tabsShell = useCustomerTabs()   // 탭 셸 안에서만 non-null
  // 딥링크: form=(§1-3, 우선) 또는 sub=(구 형식 호환)
  // 랜딩 = 1장 첫 트리 노드(LANDING=1.2) — 종전 랜딩 1.1은 [공통] 탭으로 이사했다(2026-09-20 3분리)
  const VALID_SEL = new Set<string>(PLAN_TREE_FORM_KEYS)
  // 2026-08-08: 지도·사진 노드를 폐지하고 슬롯 UI를 1.3 안으로 옮겼다 — 옛 딥링크(?form=assets)는 1.3으로 보낸다
  const norm = (key: string | undefined) => (key === 'assets' ? '1.3' : key)
  const initialSel = norm(initialForm) && VALID_SEL.has(norm(initialForm)!) ? norm(initialForm)!
    : initialSection === 'ch1' ? LANDING
    : norm(initialSection) && VALID_SEL.has(norm(initialSection)!) ? norm(initialSection)!
    : LANDING
  const [sel, setSelState] = useState<string>(initialSel)
  const treeRef = useRef<HTMLElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  // form= 딥링크가 마운트 후 서버 재렌더로 바뀐 경우(다른 탭의 ?tab=plan&form=x Link) 동기화 — state는 1회만 초기화되므로
  const prevFormRef = useRef(initialForm)
  if (prevFormRef.current !== initialForm) {
    prevFormRef.current = initialForm
    const next = norm(initialForm)
    if (next && VALID_SEL.has(next) && next !== sel) {
      setSelState(next)
    }
  }
  // §1-2 미저장 이동 확인 — 입력 캡처 휴리스틱(입력 발생=dirty, '저장' 버튼 클릭=해제)
  const dirtyRef = useRef(false)
  // 1.4처럼 클릭 토글형 서식은 input 이벤트가 없어 미저장 상태를 이벤트로 공유 (2026-08-05 최종 저장 전환)
  useEffect(() => {
    const onDirty = (e: Event) => { dirtyRef.current = !!(e as CustomEvent).detail }
    window.addEventListener('erp:plan-dirty', onDirty)
    return () => window.removeEventListener('erp:plan-dirty', onDirty)
  }, [])
  // 미저장 이동 확인 — [저장하고 이동]은 지금 떠 있는 서식이 등록한 save()를 await 한다 (ui/unsaved-nav)
  const nav = useUnsavedNavGuard<string>({
    onProceed: applySelect,
    message: '지금 이동하면 이 서식에 입력한 내용이 저장되지 않습니다.',
  })
  function select(key: string) {
    if (key === sel) return
    // 월 그리드 토글·스테퍼 ±·프리셋 버튼처럼 input 이벤트가 없는 변경은 캡처 휴리스틱이 못 잡는다 —
    // 미저장 서식이 등록한 save 핸들러(usePlanSaveHandler, dirty일 때만 등록)를 정확한 신호로 함께 본다
    if (dirtyRef.current || collectPlanSaveHandlers().length > 0) { nav.request(key); return }
    applySelect(key)
  }
  function applySelect(key: string) {
    dirtyRef.current = false
    setSelState(key)
    // §1-3 URL 딥링크 동기화 (서버 왕복 없이)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'plan')
    url.searchParams.set('form', key)
    url.searchParams.delete('sub')
    window.history.replaceState(window.history.state, '', url.toString())
    // 포커스를 **이동이 실제로 일어난 여기서만** 옮긴다 — 키 핸들러에서 옮기면 미저장 확인창이 떠서
    // 이동이 보류된 경우에도 포커스가 앞서 나간다(2026-09-21 실측). tab-form-tree와 같은 규약.
    focusTreeNode(treeRef.current, key)
  }
  // 서식 안에서 다른 노드로 보내는 요청 수신 (소방계획서_11 D-5 — 3장 → 1.3 [지도·사진] 단일 원천 안내 링크).
  // select()가 미저장 확인·URL 동기화를 그대로 태우도록 이벤트로 위임한다.
  // deps 배열을 두지 않는 것은 의도 — select가 sel을 클로저로 잡으므로 매 렌더 최신 핸들러로 갱신한다.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const key = norm((e as CustomEvent).detail)
      if (typeof key === 'string' && VALID_SEL.has(key)) select(key)
    }
    window.addEventListener('erp:plan-select', onSelect)
    return () => window.removeEventListener('erp:plan-select', onSelect)
  })
  // 이사한 카드의 옛 딥링크 구제 — 앵커 id는 그대로 두고 서식만 바로잡는다.
  // 그냥 두면 ?form=1.10#c-1.10.3이 1.10을 열고 아무것도 못 찾아 조용히 아무 일도 안 일어난다.
  // 1회만 — 그 뒤 사용자가 서식을 바꾸면 그 선택이 이긴다.
  // 노드째 최상위 탭으로 이사한 카드(c-1.10.3 → 1.4 → [소방시설] 탭)는 트리 이동이 아니라
  // **탭 이동**으로 구제한다 — 해시는 서버에 안 오므로 이 구제는 클라이언트에 남아야 한다.
  const movedAnchorRan = useRef(false)
  useEffect(() => {
    if (movedAnchorRan.current) return
    movedAnchorRan.current = true
    const id = decodeURIComponent(window.location.hash.slice(1))
    const to = formOfCard(id)
    if (!to) return
    const movedTab = tabOfForm(to)
    if (movedTab) {
      // 이사 탭은 트리 구조(TabFormTree)라 **노드까지** 열어야 카드가 보인다 — goTab만으로는
      // 기본 노드가 열려 카드가 hidden에 갇힌다. ?form=은 서버 재렌더가 있어야 트리에 닿으므로
      // 전체 이동(<a> 규약과 동일, D-4). 해시는 그대로 실어 도착 후 브라우저 앵커 스크롤에 맡긴다.
      window.location.assign(`/customers/${customerId}?tab=${movedTab}&form=${encodeURIComponent(to)}${window.location.hash}`)
      return
    }
    if (VALID_SEL.has(to) && to !== sel) applySelect(to)
  }, [])
  // §1-2·1-3 카드 앵커 딥링크 — ?form=…#c-카드 진입/서식 전환 시 해당 카드로 스크롤
  useEffect(() => {
    const h = window.location.hash
    if (!h.startsWith('#c-')) return
    const t = setTimeout(() => document.getElementById(decodeURIComponent(h.slice(1)))?.scrollIntoView({ block: 'start' }), 200)
    return () => clearTimeout(t)
  }, [sel])
  // 생성 연도 = 올해 자동 (2026-08-10 사용자 확정 — 생성 바의 연도 입력칸 폐지.
  // 커버·표지의 연도 표기는 '보고서 커버' 서식이 담당하고, 보관함 연도 축·개정 차수 규약은 불변)
  const currentYear = new Date().getFullYear()
  // 종전 useTransition은 생성 버튼 전용이었다 — 보관함 이관으로 제거 (R2-11).
  // 대장 자동조회·임포트는 각자의 transition을 따로 쓴다(아래)
  const [msg, setMsg] = useState('')
  // 대장 수동 미리보기·확정 저장(구 [건축물대장 불러오기])은 빠른 입력 페이지와 함께 폐기(2026-08-06).
  // 대체 경로: 진입 시 자동 반영(아래) + 1.1 [건축물대장에서 다시 가져오기] + 건물·시설 탭 수기 입력.
  const [, startLedgerTransition] = useTransition()

  // 진입 시 자동 대장 반영 — 주소(bcode) 있고 아직 미동기화면 '빈 칸만' 조용히 채움(버튼 클릭 불필요, 수동값 미덮어씀).
  const autoLedgerRan = useRef(false)
  useEffect(() => {
    if (!canManage || !ledgerAutoNeeded || autoLedgerRan.current) return
    autoLedgerRan.current = true
    startLedgerTransition(async () => {
      try {
        const res = await autoApplyLedgerEmptyAction(customerId)
        if (res.filled && res.filled > 0) {
          setMsg(`✅ 건축물대장 값 ${res.filled}개를 자동으로 채웠습니다 (빈 칸만) — 필수 완성도에 반영됩니다.`)
          router.refresh()
        }
      } catch { /* best-effort */ }
    })
  }, [canManage, ledgerAutoNeeded, customerId])

  // 진입 시 공통 서술 기본항목 자동주입 — 스탬프 없는 섹션의 '빈 칸만' 서버에서 채움·저장 (§4-0).
  // 대장 자동반영과 같은 규약(1회 가드·조용한 best-effort). DB에 저장해야 생성 문서(3.6 등)에 실린다.
  const autoTextRan = useRef(false)
  useEffect(() => {
    if (!canManage || !textDefaultsNeeded || autoTextRan.current) return
    autoTextRan.current = true
    startLedgerTransition(async () => {
      try {
        const res = await applyPlanTextDefaultsAction(customerId)
        if (res.filled && res.filled.length > 0) {
          setMsg(`✅ 공통 기본 서술 ${res.filled.length}개 서식을 채웠습니다 (빈 칸만) — ${res.filled.map(f => f.title).join(' · ')} — 각 서식에서 확인·수정하세요.`)
          router.refresh()
        }
      } catch { /* best-effort */ }
    })
  }, [canManage, textDefaultsNeeded, customerId])

  // 11-5: 누락 칩 클릭 → 해당 입력처로 이동 + 필드 단위 포커스(스크롤·포커스·앰버 펄스)
  // 탭 이동은 탭 셸 컨텍스트 goTab 우선(미저장 confirm 존중) — 셸 밖 단독 렌더 시 router.push 폴백
  function focusField(id: string, delay = 300) {
    // 대상 패널이 이제 막 마운트되는 경우가 있어 폴링 (최대 8회 × 300ms)
    let tries = 0
    const tick = () => {
      const el = document.getElementById(id)
      if (!el) {
        if (++tries < 8) setTimeout(tick, 300)
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const input = el.matches('input,select,textarea') ? (el as HTMLElement) : el.querySelector<HTMLElement>('input,select,textarea')
      if (input && !(input as HTMLInputElement).disabled) input.focus({ preventScroll: true })
      el.classList.add('ring-2', 'ring-amber-400', 'rounded-lg')
      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'rounded-lg'), 2500)
    }
    setTimeout(tick, delay)
  }
  /** 1.1이 [공통] 탭으로 이사(2026-09-20 3분리)한 뒤의 칩 목적지 — 탭 전환 + focus-missing 위임.
   *  공통 패널은 lazy 마운트라 goTab 직후엔 리스너가 없을 수 있다 — 재시도 간격은 종전 그대로. */
  function gotoForm11(label?: string) {
    if (tabsShell) tabsShell.goTab('facilities')
    else router.push(`/customers/${customerId}?tab=facilities&form=1.1`)
    if (label) {
      for (const ms of [300, 800, 1500]) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('erp:focus-missing', { detail: { label } })), ms)
      }
    }
  }
  /** 엑셀 고지 칩 → 그 서식으로 (2026-09-21).
   *  ⚠ 이사 노드(1.1·1.4)는 이 트리에 **없다** — 최상위 탭으로 보내야 한다. 그 경우 `&form=`을
   *    반드시 붙인다(TabFormTree가 딥링크로만 그 노드를 연다). 탭 전환은 `goTab`이 아니라
   *    **전체 이동**이 정본이다(goTab 라우터 큐 고착 이력). 같은 탭 노드는 select()가 미저장
   *    확인까지 태운다. */
  function gotoNoticeForm(form: FirePlanFormKey) {
    const tab = tabOfForm(form)
    if (tab) { router.push(`/customers/${customerId}?tab=${tab}&form=${form}`); return }
    select(form)
  }
  function gotoMissing(label: string) {
    const t = CHIP_TARGET[label]
    const fieldId = CHIP_FIELD_ID[label]
    if (!t) { gotoForm11(label); return }
    if (t === 'buildings' || t === 'info') {
      if (tabsShell) tabsShell.goTab(t)
      else router.push(`/customers/${customerId}?tab=${t}`)
      if (fieldId) {
        // 요약 모드→편집 전환·수정 폼 열기가 필요해 각 컴포넌트에 위임 (erp:focus-missing)
        // 기본정보 = cf-*(edit-customer-info-client), 건물 = bf-*(building-inline-panel, 소방계획서_9 B안)
        setTimeout(() => window.dispatchEvent(new CustomEvent('erp:focus-missing', { detail: { id: fieldId } })), 350)
      } else if (t === 'buildings') {
        focusField('buildings-panel')
      }
      return
    }
    // 송달 동의는 1.1 하단(④ 섹션) — 1.1과 함께 공통 탭으로 갔다
    if (t === 'consent') {
      gotoForm11()
      setTimeout(() => document.getElementById('consent-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 600)
      return
    }
    if (t === 'ch2') { select('ch2'); focusField('c-2.2'); return }
    // 1.1 칩 — 요약→편집 전환이 필요하므로 fire-plan-info-panel의 focusMissing에 위임 (마운트 대기 재시도)
    gotoForm11(label)
  }

  // §7-3b: 구 웹 생성분(.form.json) → 서식 저장소 최초 1회 가져오기
  const [importHidden, setImportHidden] = useState(false)
  const [isImportPending, startImportTransition] = useTransition()
  function importLegacy() {
    setMsg('')
    startImportTransition(async () => {
      const res = await importLegacyFormAction(customerId)
      if (res.error) { setMsg(`❌ ${res.error}`); setImportHidden(true); return }
      setMsg(`✅ 이전 생성 데이터에서 가져왔습니다 (${(res.imported ?? []).length}개 섹션) — 서식 전체 모드에서 확인해주세요.`)
      setImportHidden(true)
      router.refresh()
    })
  }

  // 🚨 **「생성 바」에 생성이 없었다** (2026-09-21 사용자 요청으로 되돌림).
  //   종전 주석: 「생성 버튼은 보관함으로 이관했다(소방계획서_21 R2-11) — 생성물이 쌓이는 곳에서
  //   생성해야 결과가 그 자리에 바로 보인다」. 그런데 **그 보관함이 2026-09-02에 폐지됐다** —
  //   옮겨 둔 목적지가 사라졌는데 버튼은 돌아오지 않았고, 그 사이 받는 자리는 [조회·이력] 노드
  //   안쪽과 [회차] 탭으로 흩어졌다. 입력은 이 탭에서 하는데 받으려면 노드를 파고들거나 탭을
  //   건너야 했다는 뜻이다.
  //   이 줄은 **모든 서식에서 상단 고정**이라, 1.2를 입력하든 3장을 입력하든 받기가 늘 한 번 클릭
  //   거리에 있다 — 그게 이 자리를 고른 이유다(게이지·누락 칩이 여기 남은 이유와 같다).
  // ⚠ 종전 라벨 '계획서 생성 (HWP+PDF)'로 되돌리지 말 것: 소방계획서_7 H-13이 한글 SDK를 걷어낸
  //   뒤 hwp_path에 null을 넣으므로 HWP는 생성되지 않는다. 지금 나가는 것은 엑셀과 PDF뿐이다.
  const [xlsxNotice, setXlsxNotice] = useState('')
  const [xlsxError, setXlsxError] = useState('')

  const pct = readiness.total > 0 ? Math.round((readiness.done / readiness.total) * 100) : 0
  // 일반관리도 소방계획서 대상 (소방계획서_6 W-14·D-6) — 유형 안내 배너 특례 제거

  return (
    // data-plan-root — 서식 화면의 경계. 가독성 검사(소방계획서_35 S2-7)가 크기 히스토그램을
    //   걷는 **모집단**이 이 안이다. 종전엔 `body *` 전수라 사이드바 알림 뱃지·헤더가 섞였고,
    //   그 뱃지 값이 실행 사이에 8→9로 바뀌며 항등 축을 무작위로 빨갛게 만들었다(판정 DEF-B 모집단 축).
    //   코드모드가 만진 16파일의 출력과 모집단을 일치시키기 위한 표식이다 — 스타일 없음.
    <div data-plan-root
      className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      {/* 생성 바 — 모든 서브탭 상단 고정 (소방계획서_4.md §2) */}
      <div className="flex items-center gap-3 flex-wrap pb-4 border-b border-brand-line-soft mb-4">
        <div className="flex items-center gap-2 min-w-40">
          <span className="text-form-base font-semibold text-ink">소방계획서</span>
          <div className="h-1.5 w-20 rounded-full bg-brand-tint overflow-hidden">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-form-xs text-ink-sub">{readiness.done}/{readiness.total}</span>
        </div>
        {/* 누락 칩 — 빠른 입력 폐기(2026-08-06)로 완성도 카드가 사라져, 입력처 이동은 이 줄이 담당 */}
        {readiness.missing.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap min-w-0">
            <span className="text-form-xs text-amber-600 shrink-0">누락:</span>
            {readiness.missing.map(m2 => (
              <button key={m2} onClick={() => gotoMissing(m2)}
                title={`클릭 → ${CHIP_TARGET_LABEL[CHIP_TARGET[m2] ?? 'form11']}에서 입력`}
                className="inline-flex items-center h-5 px-1.5 rounded bg-amber-50 text-amber-700 text-form-2xs border border-amber-200 hover:bg-amber-100 hover:border-amber-300 transition-colors">
                {m2} ↗
              </button>
            ))}
          </span>
        )}
        {/* 받기 — 엑셀이 **주**, PDF가 보조다(소방계획서_42 D-1: 받은 뒤 엑셀에서 직접 고쳐 최종본을
            만드는 것이 실사용 흐름). 누락 칩이 여러 줄로 늘어나도 자리가 흔들리지 않게 ml-auto 묶음에
            둔다 — 칩은 왼쪽에서 자라고 받기는 오른쪽 끝에 고정된다.
            ⚠ 엑셀은 `FirePlanXlsxButton` **한 벌**을 쓴다(목록 행·여기가 같은 로직). 여기서 fetch를
              다시 짜면 `X-FirePlan-Missing` 고지 처리가 두 벌이 된다.
            ⚠ PDF는 `window.open`이 규약이다(고지 헤더가 없다) — 엑셀처럼 Blob으로 바꾸지 말 것. */}
        <span className="ml-auto shrink-0 flex items-center gap-2">
          <FirePlanXlsxButton customerId={customerId} onNotice={setXlsxNotice} onError={setXlsxError} />
          <button onClick={() => window.open(firePlanPdfUrl(customerId), '_blank')}
            data-testid="plan-bar-pdf"
            title="현재 입력값으로 즉석 생성한 PDF를 새 탭에서 엽니다 — 뷰어에서 그대로 인쇄·저장할 수 있습니다"
            className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-ink-sub hover:bg-brand-tint hover:text-brand transition-colors">
            <FileText className="size-3.5" /> PDF
          </button>
          {/* 글자 크기 (소방계획서_35 S5-3) — 배율 효과가 **가장 크게 보이는 화면**이라 여기 둔다.
              전역 헤더에 두면 배율이 안 걸리는 화면에서도 눌리는 버튼이 된다.
              ⚠ 종전 주석의 '유일한 화면'은 소방계획서_38이 점검표 입력까지 넓히며 거짓이 됐다. */}
          <FontScaleSettingsClient variant="compact" />
        </span>
      </div>
      {msg && <p className="text-form-sm text-ink-sub mb-3">{msg}</p>}
      {/* 엑셀 고지·오류 — `window.open`이었다면 사라졌을 정보다(자가치유·구역 넘침·미입력).
          생성 바 **아래**에 그린다: 바 안에 넣으면 고지가 길 때 게이지·칩 줄이 통째로 밀린다. */}
      {xlsxError && <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{xlsxError}</p>}
      {xlsxNotice && (
        // ⭐ 고지를 **클릭할 수 있는 조각**으로 쪼갠다 (2026-09-21). 종전엔 한 덩어리 `<p>`라,
        //   「1.7.1이 비었다」를 읽고도 그 서식을 사용자가 직접 찾아가야 했다 — 바로 위 누락 칩은
        //   눌러서 가는데 정작 엑셀이 지적한 자리는 못 갔다. 이제 고리가 닫힌다:
        //   입력 → 엑셀 → 지적 → 클릭 → 그 칸 → 다시 엑셀.
        // ⚠ 갈 곳을 못 찾은 조각은 **글자 그대로** 남는다(종전과 같은 모습) — 지어낸 목적지로
        //   보내느니 안 보내는 게 낫다. 규칙·표는 lib/fire-plan-notice가 정본이다.
        <div data-testid="plan-bar-xlsx-notice"
          className="text-form-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3 space-y-1">
          <span className="font-medium">엑셀 고지 — 아래 칸이 비었거나 양식에 다 담기지 않았습니다</span>
          <ul className="space-y-0.5">
            {parseFirePlanNotice(xlsxNotice).map((part, i) => {
              // 갈 곳을 찾는 길은 **둘**이고, 실제로 자주 걸리는 쪽은 아래(b)다.
              //  (a) 시트 번호가 박힌 고지 — 넘침·자가치유(「선임현황(1.7.1) 2명 미표기」).
              //      데이터가 많거나 좌표가 밀렸을 때만 나온다.
              //  (b) **미입력 라벨** — 빈 고객의 고지는 16조각이 전부 이 꼴이다(실측).
              //      그 라벨들은 바로 위 「누락 칩」이 이미 아는 것과 **같은 어휘**라
              //      CHIP_TARGET/gotoMissing을 그대로 태운다(배선 두 벌 금지).
              //      🚨 (b)가 없으면 흔한 경우에 칩이 **하나도** 안 생긴다 — 프로브가 잡았다.
              const missTarget = !part.form && CHIP_TARGET[part.text] ? part.text : null
              return (
                <li key={i} className="flex items-start gap-1.5 break-words">
                  {part.form ? (
                    <button onClick={() => gotoNoticeForm(part.form!)}
                      data-testid="xlsx-notice-chip"
                      title={`클릭 → ${part.no} 서식으로 이동해 입력합니다`}
                      className="inline-flex items-center h-5 px-1.5 shrink-0 rounded bg-amber-100 text-amber-800 text-form-2xs font-medium border border-amber-300 hover:bg-amber-200 transition-colors">
                      {part.no} ↗
                    </button>
                  ) : missTarget ? (
                    <button onClick={() => gotoMissing(missTarget)}
                      data-testid="xlsx-notice-chip"
                      title={`클릭 → ${CHIP_TARGET_LABEL[CHIP_TARGET[missTarget] ?? 'form11']}에서 입력`}
                      className="inline-flex items-center h-5 px-1.5 shrink-0 rounded bg-amber-100 text-amber-800 text-form-2xs font-medium border border-amber-300 hover:bg-amber-200 transition-colors">
                      {part.text} ↗
                    </button>
                  ) : (
                    <span className="shrink-0 text-amber-500">·</span>
                  )}
                  {/* 라벨 칩은 글자가 칩 안에 이미 있다 — 옆에 또 적으면 같은 말이 두 번이다 */}
                  {!missTarget && <span className="whitespace-pre-wrap">{part.text}</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* ══ 서식 전체 트리(기본) — ⚡ 빠른 입력을 최상단 노드로 통합. 토글 제거 (2026-08-05) ══ */}
      {(() => {
        // 빠른 입력 페이지 폐기(2026-08-06 사용자 확정) — 온보딩 배너·필요문서 칩·필수완성도 카드·
        // 지도사진 링크·보관함 요약은 제거하고, 유일한 입력처였던 송달 동의와 1회성 임포트 배너만 1.1로 이관.
        // §7-3b 임포트 배너 — 종전엔 1.1 아래(oneOneExtras)였는데 1.1이 공통 탭으로 이사해(2026-09-20)
        // 트리 위 상단 배너로 승격한다. 어느 노드에서든 보인다 — 최초 1회성 안내라 노드 귀속이 아니다.
        const importBanner = importCandidate && canManage && !importHidden && (
          <div className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-tint px-4 py-2.5 mb-4">
            <Info className="size-4 text-brand shrink-0" />
            <span className="text-form-sm text-ink-sub">
              이전에 생성한 소방계획서의 수기 편집값(구역·취약장소·피난계획·개정이력)을 서식 입력으로 가져올 수 있습니다. (최초 1회)
            </span>
            <button onClick={importLegacy} disabled={isImportPending}
              className="ml-auto inline-flex items-center gap-1 h-form-7 px-3 rounded-lg bg-brand hover:bg-brand-strong text-white text-form-xs font-medium shrink-0 disabled:opacity-50">
              {isImportPending ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} 가져오기
            </button>
            <button onClick={() => setImportHidden(true)} className="h-form-7 px-2 rounded-lg text-form-xs text-ink-meta hover:text-ink-sub shrink-0">닫기</button>
          </div>
        )
        // ── 서식 전체 트리 — §1 개정 구조: 좌측 목차 트리 + 서식 화면 (P6) ──
        // 목차 완성도 표시 (1-1·1-4): ✓=입력 있음 / ○=비어 있음 / n/m=게이지형(1.1)
        const fs = formStatus ?? {}
        const dot = (key: string) => {
          const v = fs[key]
          if (v === undefined) return null
          if (typeof v === 'object') {
            const full = v.done >= v.total
            return <span className={`ml-auto text-form-2xs shrink-0 ${full ? 'text-green-600' : 'text-amber-600'}`}>{full ? '✓' : `${v.done}/${v.total}`}</span>
          }
          return <span className={`ml-auto text-form-2xs shrink-0 ${v ? 'text-green-600' : 'text-ink-meta'}`}>{v ? '✓' : '○'}</span>
        }
        // data-plan-node/aria-current: 어느 노드가 실제로 선택됐는지 보이는 구조적 표식.
        // 없을 때는 딥링크 검사가 URL 문자열(?form=annex)밖에 볼 수 없어, 링크의 form 값을
        // 엉뚱하게 바꿔도 초록으로 남았다(소방계획서_32 F-1 변이 검사로 실증).
        // roving tabindex — 선택된 노드만 Tab 대상. 전부 0이면 트리를 빠져나오는 데 Tab을
        // 노드 수만큼 눌러야 한다(2026-09-21 실측: 이 트리에서 13번). 트리 안 이동은 화살표가 맡는다.
        const navBtn = (key: string, label: string, indent = false) => (
          <button key={key} onClick={() => select(key)}
            data-plan-node={key} aria-current={sel === key ? 'true' : undefined}
            tabIndex={sel === key ? 0 : -1}
            className={`w-full flex items-center gap-1.5 h-form-7 rounded-lg text-form-xs text-left transition-colors ${indent ? 'pl-5 pr-2' : 'px-2 font-medium'} ${
              sel === key ? 'bg-brand text-white [&>span]:!text-white' : 'text-ink-sub hover:bg-brand-tint'
            }`}>
            <span className="truncate">{label}</span>
            {dot(key)}
          </button>
        )
        // 키보드 트리 왕복 (2026-09-21 사용자 요청) — 규칙은 tree-keyboard가 정본(공통·보고서 트리와 공용).
        // 순서는 PLAN_TREE_FORM_KEYS(대장 파생) — 트리 렌더 순서(1장 → 2·3장 → 커버 → 조회)와 같다.
        // 포커스가 트리 안에 있을 때만 듣는다(전역이면 입력칸 커서·페이지 스크롤과 충돌).
        const onTreeKeyDown = (e: KeyboardEvent<HTMLElement>) => {
          const act = treeKeyAction(PLAN_TREE_FORM_KEYS, sel, e.key)
          if (!act) return
          e.preventDefault()
          if (act.kind === 'enter') { focusDetailPanel(detailRef.current, sel); return }
          select(act.to)   // 미저장이면 확인창으로 — 포커스는 applySelect가 옮긴다
        }
        // 상세 → 트리 복귀 (ESC). defaultPrevented면 안쪽이 이미 쓴 ESC다(콤보박스 닫기 등) — 뺏지 않는다.
        const onDetailKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key !== 'Escape' || e.defaultPrevented) return
          e.preventDefault()
          focusTreeNode(treeRef.current, sel)
        }
        const ch1Filled = CH1_FORMS.filter(f => {
          const v = fs[f.key]
          return typeof v === 'object' ? v.done >= v.total : v === true
        }).length
        {/* 소방계획서_8 D-12 3그룹 재편 → 14.md #16(2026-08-11) → **소방계획서_34(2026-08-29)로 2그룹**:
            📘 본문(1~3장) / 🗂 조회·개정이력(구 보관함 — 2026-09-02 파일 저장 폐지). 📑 별지 서식은 최상위 탭으로 나갔다. */}
        // 모바일 드롭다운 — 대장의 그룹으로 접두를 만든다(라벨을 두 번 적지 않는다)
        // ⚠ 접두 모양은 종전 그대로 둔다(1장만 ' > ', 나머지는 붙여쓰기) — 이 단계는 목차의
        //   **원천**을 옮기는 것이지 보이는 글자를 바꾸는 것이 아니다. 둘을 한 커밋에 섞으면
        //   화면이 달라진 이유를 나중에 못 가린다.
        const NAV_ALL = PLAN_TREE_FORMS.map(f => ({
          key: f.key,
          label: f.group === '조회' ? f.label
            : f.group === '본문 1장' ? `본문 1장 > ${f.label}`
            : `본문 ${f.label}`,
        }))
        return (
        <>
        {importBanner}
        <div className="flex gap-4 items-start">
          {nav.dialog}
          {/* 좌측 목차 트리 (데스크톱, 1-1) — 모바일은 아래 드롭다운 폴백(7-6) */}
          <aside ref={treeRef} onKeyDown={onTreeKeyDown}
            className="hidden md:block w-48 shrink-0 rounded-xl border border-brand-line-soft bg-brand-tint p-2 space-y-0.5 sticky top-2">
            {/* 1.1·1.4 노드는 [공통] 탭으로 이사(2026-09-20 3분리) — 랜딩은 1장 첫 노드(1.2) */}
            <div>
              <p className="px-2 py-1 text-form-2xs font-bold text-ink-soft flex items-center">📘 소방계획서 본문
                <span className={`ml-auto ${ch1Filled >= CH1_FORMS.length ? 'text-green-600' : 'text-ink-meta'}`}>{ch1Filled}/{CH1_FORMS.length}</span>
              </p>
              {CH1_FORMS.map(f => navBtn(f.key, f.label, true))}
              {navBtn('ch2', '2장 자위소방대', true)}
              {navBtn('ch3', '3장 피난계획', true)}
              {/* 보고서 커버 — 생성 문서 마지막 페이지라 본문 그룹 마지막 노드 (2026-08-10) */}
              {navBtn('cover', '보고서 커버', true)}
            </div>
            {/* 🖼 지도·사진 노드 폐지(2026-08-08 사용자 확정) — 표지·위치도·피난안내도 슬롯은 1.3 안으로 이관 */}
            {/* 📑 별지 서식 그룹 폐지(2026-08-29 사용자 확정, 소방계획서_34 D34-2) — 최상위 [별지서식] 탭으로 승격.
                안내 문구도 남기지 않는다. 구 딥링크 ?tab=plan&form=annex는 page.tsx가 서버에서 새 탭으로 해석한다. */}
            {/* 보관함 폐지(2026-09-02 사용자 확정) — 파일 저장 없이 즉석 조회·인쇄 + 개정이력(수동 기록) */}
            <div className="pt-2 mt-1.5 border-t border-brand-tint">
              <p className="px-2 py-1 text-form-2xs font-bold text-ink-soft">🗂 조회·이력</p>
              {navBtn('archive', '조회·개정이력')}
            </div>
          </aside>

          {/* 콘텐츠 — 입력 캡처로 미저장 감지(1-2 휴리스틱: 입력=dirty, '저장' 클릭=해제) */}
          <div ref={detailRef} onKeyDown={onDetailKeyDown} className="flex-1 min-w-0"
            onInputCapture={e => {
              // 모바일 목차 드롭다운 자체의 input 이벤트는 편집이 아니다 — dirty로 오인하면 매 이동마다 확인창이 뜬다
              if ((e.target as HTMLElement).closest('[data-plan-nav]')) return
              dirtyRef.current = true
            }}
            onClickCapture={e => {
              const el = e.target as HTMLElement
              if (el.closest('[data-unsaved-dialog]')) return   // 이동 확인창의 [저장하고 …]은 서식 저장이 아니다
              const btn = el.closest('button')
              if (btn?.textContent?.includes('저장')) dirtyRef.current = false
            }}>
            {/* 모바일 목차 드롭다운 (7-6) */}
            <select value={sel} data-plan-nav onChange={e => select(e.target.value)}
              className="md:hidden mb-3 h-form-8 w-full rounded-lg border border-brand-line bg-surface px-2 text-form-sm outline-none">
              {NAV_ALL.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>

            {/* data-detail-panel: 트리에서 Enter로 들어올 착지점(tree-keyboard.focusDetailPanel).
                이 트리는 tab-form-tree와 달리 선택된 서식 **하나만** 렌더하므로 감싸개도 하나면 된다 —
                노드마다 감싸개를 두면 hidden 패널까지 후보가 돼 엉뚱한 서식에 포커스가 간다. */}
            <div data-detail-panel={sel}>

      {/* ── ⚡ 빠른 입력 (트리 최상단 노드, 한 페이지에 필수·송달동의) ── */}

      {/* ── 개정이력·보관 ── */}
      {sel === 'archive' && (
        <div className="space-y-4">
          <RevisionHistory customerId={customerId} canManage={canManage}
            initialYears={revisionYears} currentYear={currentYear} />
          {archive}
        </div>
      )}

      {/* ── 1장 서식 화면 (목차에서 직접 선택 — 1-2 섹션 카드는 각 서식 내부) ── */}
      {/* 1.1·1.4 렌더는 최상위 [공통] 탭으로 이관 (2026-09-20 3분리) — sel에 올 수 없다(PLAN_TREE_FORM_KEYS) */}
      {sel === '1.2' && form12}
      {sel === '1.3' && form13}
      {sel === '1.5' && form15}
      {sel === '1.6' && form16}
      {sel === '1.7' && form17}
      {sel === '1.8' && form18}
      {sel === '1.10' && form110}
      {sel === '1.11' && form111}
      {sel === '1.12' && form1215}

      {/* ── 2장 자위소방대 운영계획 ── */}
      {sel === 'ch2' && ch2}

      {/* ── 3장 피난계획 ── */}
      {sel === 'ch3' && ch3}

      {/* ── 보고서 커버 (생성 문서 마지막 페이지 — 업체명·연도) ── */}
      {sel === 'cover' && formCover}

      {/* 별지 서식 렌더는 최상위 [별지서식] 탭으로 이관 (소방계획서_34 S3-5) */}

      {/* ── 엑셀 빈칸 보고 ──
          지금 보는 절이 담당하는 워크북 시트에서 **무엇이 빌지**를 받기 전에 알린다.
          ⭐ 여기 **한 곳**에만 단다 — 서식 컴포넌트 14개에 각각 붙이면 같은 것을 열네 번
            배선하는 셈이고, 한 곳이 빠지면 그 절만 조용히 보고가 없다. 담당 시트는 대장이 답한다. */}
      {blankSummary?.[sel] && (
        <PlanBlankReport
          customerId={customerId}
          sheetNames={sectionsOfForm(sel as FirePlanFormKey).map(d => d.sheet)}
          summary={blankSummary[sel]}
          canManage={canManage}
        />
      )}
            </div>
          </div>
        </div>
        </>
        )
      })()}
    </div>
  )
}
