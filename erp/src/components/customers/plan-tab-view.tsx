'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { FileOutput, Printer, Download, Loader2, History, BookOpen, Users, DoorOpen, Save, Zap, LayoutList, RefreshCw, Info } from 'lucide-react'
import {
  generateFirePlanPdfNowAction, requestFirePlanHwpFromTabAction, saveFirePlanRevisionAction, saveEmailConsentAction,
  importLegacyFormAction,
} from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { downloadFirePlanDataSheetAction } from '@/app/(dashboard)/customers/fire-plan-actions'
import { previewLedgerAction, applyLedgerValuesAction, type LedgerPreviewField } from '@/app/(dashboard)/customers/fire-plan-info-actions'
import { recommendPresetType } from '@/lib/fire-plan-presets'
import { DateInput } from '@/components/ui/date-input'

/** 소방계획서 탭 (4-1 골격 + P2 빠른 입력 모드 — 소방계획서_4.md §1·§1-1·§2·§9-8)
 *  기본 진입 = 빠른 입력(필수 공통값 체크리스트 + 대장 불러오기 + 송달 동의 + 보관함 요약).
 *  [서식 전체] 토글 = 고급 모드(장 서브탭 골격). 일반관리 고객 = 안내 배너 + 보관함만. */

export type RevisionRow = { year: number; revision: number; date: string; note: string | null; uploader: string | null }
export type DocChip = { doc: string; label: string; need: boolean; note?: string; have?: boolean }
export type QuickReadiness = { done: number; total: number; missing: string[] }

/** 11-5: 누락 칩 → 입력처 딥링크 (필수 완성도 라벨 기준) */
const CHIP_TARGET: Record<string, 'buildings' | 'info' | 'form11' | 'ch2' | 'consent'> = {
  '주소': 'info', '사용승인일': 'info',
  '건물 용도': 'buildings', '건축허가일': 'buildings', '연면적': 'buildings', '건축면적': 'buildings',
  '층수': 'buildings', '높이': 'buildings', '세대수': 'buildings', '건물동수': 'buildings',
  '승강기': 'buildings', '주차장': 'buildings',
  '수신기위치': 'form11', '구조': 'form11', '지붕': 'form11', '선임일': 'form11', '급수': 'form11',
  '화재보험': 'form11', '운영시간': 'form11', '인원': 'form11',
  '자위소방대': 'ch2', '송달 동의': 'consent',
}
const CHIP_TARGET_LABEL: Record<string, string> = {
  buildings: '건물·시설 탭', info: '기본정보 탭', form11: '1장 > 1.1 일반현황', ch2: '2장 자위소방대', consent: '아래 송달 동의',
}

const CHAPTERS = [
  { key: 'archive', label: '개정이력·보관', icon: History },
  { key: 'ch1', label: '1장 소방안전관리계획', icon: BookOpen },
  { key: 'ch2', label: '2장 자위소방대', icon: Users },
  { key: 'ch3', label: '3장 피난계획', icon: DoorOpen },
] as const

/** 1장 서식 탭 — 활성: 1.1(4-1) + 1.2·1.3(P4-①) (소방계획서_4.md §3 순서) */
const CH1_FORMS = [
  { key: '1.1', label: '1.1 일반현황', active: true },
  { key: '1.2', label: '1.2 세부현황', active: true },
  { key: '1.3', label: '1.3 위치·소방차진입', active: true },
  { key: '1.4', label: '1.4 소방시설', active: true },
  { key: '1.5', label: '1.5 피난·방화', active: true },
  { key: '1.6', label: '1.6 기타시설', active: true },
  { key: '1.7', label: '1.7 선임현황', active: true },
  { key: '1.8', label: '1.8 업무대행', active: true },
  { key: '1.10', label: '1.10 자체점검', active: true },
  { key: '1.11', label: '1.11 훈련·교육', active: true },
]

export function PlanTabView({
  customerId, canManage, purpose, readiness, revisionInitial, revisionRows, importCandidate, initialSection, archive,
  form11, form12, form13, form14, form15, form16, form17, form18, form110, form111, ch2, ch3,
  isGeneral, docs, quick, consentInitial, latestPlan,
}: {
  customerId: string
  canManage: boolean
  purpose: string | null
  readiness: { done: number; total: number; missing: string[] }
  revisionInitial: { revisionDate: string; revisionNote: string }
  revisionRows: RevisionRow[]
  importCandidate?: boolean
  initialSection?: string
  archive: ReactNode
  form11: ReactNode
  form12: ReactNode
  form13: ReactNode
  form14: ReactNode
  form15: ReactNode
  form16: ReactNode
  form17: ReactNode
  form18: ReactNode
  form110: ReactNode
  form111: ReactNode
  ch2: ReactNode
  ch3: ReactNode
  isGeneral: boolean
  docs: DocChip[]
  quick: QuickReadiness
  consentInitial: { consent: boolean | null; email: string }
  latestPlan: { year: number; title: string; pdfStatus: string; revision: number } | null
}) {
  const router = useRouter()
  // 기본 진입 = 빠른 입력 (§1-1 확정). 딥링크(sub=)로 들어오면 해당 서브탭의 고급 모드
  const [mode, setMode] = useState<'quick' | 'full'>(initialSection ? 'full' : 'quick')
  const [chapter, setChapter] = useState<string>(
    CHAPTERS.some(c => c.key === initialSection) ? initialSection! : 'archive')
  const [form, setForm] = useState<string>('1.1')
  const [year, setYear] = useState(new Date().getFullYear())
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState('')
  const [rev, setRev] = useState(revisionInitial)
  const [revDirty, setRevDirty] = useState(false)
  const [isRevPending, startRevTransition] = useTransition()
  const [consent, setConsent] = useState(consentInitial)
  const [consentDirty, setConsentDirty] = useState(false)
  const [isConsentPending, startConsentTransition] = useTransition()
  const [isLedgerPending, startLedgerTransition] = useTransition()
  const [ledgerPreview, setLedgerPreview] = useState<LedgerPreviewField[] | null>(null)

  // 11-1c: 불러오기 = 미리보기(저장 없음) → 변경분 앰버 확인 → [확정 저장]
  function refreshLedger() {
    setMsg('')
    startLedgerTransition(async () => {
      const res = await previewLedgerAction(customerId)
      if (res.needAddress) { setMsg('⚠ 건물에 저장된 지번 정보가 없습니다 — 서식 전체 모드의 계획서 정보 패널에서 [건축물대장에서 다시 가져오기]로 주소를 1회 확인해주세요.'); return }
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      if (!res.fields || res.fields.length === 0) { setMsg('건축물대장에서 가져올 값이 없습니다.'); return }
      setLedgerPreview(res.fields)
    })
  }

  function applyLedger() {
    if (!ledgerPreview) return
    setMsg('')
    startLedgerTransition(async () => {
      const values = Object.fromEntries(ledgerPreview.map(f => [f.key, f.next]))
      const res = await applyLedgerValuesAction(customerId, values)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setLedgerPreview(null)
      setMsg('✅ 건축물대장 값이 확정 저장됐습니다 — 필수 완성도에 반영됩니다.')
      router.refresh()
    })
  }

  // 11-5: 누락 칩 클릭 → 해당 입력처로 이동 (탭 이동 / 서식 전환 / 화면 내 스크롤)
  function gotoMissing(label: string) {
    const t = CHIP_TARGET[label]
    if (!t) { setMode('full'); setChapter('ch1'); setForm('1.1'); return }
    if (t === 'buildings' || t === 'info') { router.push(`/customers/${customerId}?tab=${t}`); return }
    if (t === 'consent') { document.getElementById('consent-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
    setMode('full')
    setChapter(t === 'ch2' ? 'ch2' : 'ch1')
    if (t === 'form11') setForm('1.1')
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

  function saveConsent() {
    startConsentTransition(async () => {
      const res = await saveEmailConsentAction(customerId, { consent: consent.consent, email: consent.email })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setConsentDirty(false)
      setMsg('✅ 송달 동의 저장됨')
      router.refresh()
    })
  }

  function generateHwp() {
    setMsg('')
    startTransition(async () => {
      const res = await requestFirePlanHwpFromTabAction(customerId, year, recommendPresetType(purpose))
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg(`✅ HWP 생성 요청됨 (${year}년) — 워커가 처리하면 보관함에 등록됩니다`)
    })
  }

  function generatePdf() {
    setMsg('')
    startTransition(async () => {
      const res = await generateFirePlanPdfNowAction(customerId)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ PDF 생성 완료 — 보관함에 등록됐습니다')
      router.refresh()
    })
  }

  function downloadDataSheet() {
    startTransition(async () => {
      const res = await downloadFirePlanDataSheetAction(customerId)
      if (res.error || !res.base64) { setMsg(`❌ ${res.error ?? '데이터 시트 생성 실패'}`); return }
      const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName ?? '계획서데이터시트.pdf'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function saveRevision() {
    startRevTransition(async () => {
      const res = await saveFirePlanRevisionAction(customerId, rev)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setRevDirty(false)
      setMsg('✅ 개정이력 입력 저장됨 — 다음 생성 시 개정이력 표에 반영됩니다')
    })
  }

  const pct = readiness.total > 0 ? Math.round((readiness.done / readiness.total) * 100) : 0
  const quickPct = quick.total > 0 ? Math.round((quick.done / quick.total) * 100) : 0

  // 일반관리 고객 — 소방계획서 작성 대상 아님 (§9-8: 입력 화면 미노출, 안내 배너 + 보관함만)
  if (isGeneral) {
    return (
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
        <div className="flex items-start gap-2 rounded-xl border border-[#d0e3f7] bg-[#f4f9ff] px-4 py-3 mb-4">
          <Info className="size-4 text-[#3b82c4] shrink-0 mt-0.5" />
          <div className="text-xs text-[#2d5a87]">
            <p className="font-semibold">일반관리 유형 — 소방계획서 작성 대상이 아닙니다</p>
            <p className="mt-0.5">필요 문서: 외관점검표(일반용) — 작성 후 2년 보관, 소방서 보고 없음. 외부에서 작성한 문서는 아래 보관함에 보관할 수 있습니다.</p>
          </div>
        </div>
        {archive}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      {/* 생성 바 — 모든 서브탭 상단 고정 (소방계획서_4.md §2) */}
      <div className="flex items-center gap-3 flex-wrap pb-4 border-b border-[#e0ddf5] mb-4">
        <div className="flex items-center gap-2 min-w-40">
          <span className="text-sm font-semibold text-[#090c1d]">소방계획서</span>
          <div className="h-1.5 w-20 rounded-full bg-[#eceafd] overflow-hidden">
            <div className="h-full rounded-full bg-[#7b68ee]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-[#514b81]">{readiness.done}/{readiness.total}</span>
        </div>
        {readiness.missing.length > 0 && (
          <span className="text-[11px] text-amber-600 truncate max-w-56" title={readiness.missing.join(', ')}>
            누락: {readiness.missing.slice(0, 3).join(' · ')}{readiness.missing.length > 3 ? ` 외 ${readiness.missing.length - 3}` : ''}
          </span>
        )}
        {canManage && (
          <div className="flex items-center gap-1.5 ml-auto">
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value || '0', 10))}
              className="h-8 w-20 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]" />
            <button onClick={generateHwp} disabled={isPending}
              title="한글 원본 생성 — 워커(한글 SDK) 큐로 요청, 완료 시 보관함 등록"
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileOutput className="size-3.5" />} HWP 생성
            </button>
            <button onClick={generatePdf} disabled={isPending}
              title="표준양식 PDF 즉시 생성 — 저장된 양식 데이터(없으면 자동 기본값)로 생성"
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
              <Printer className="size-3.5" /> PDF 생성
            </button>
            <button onClick={downloadDataSheet} disabled={isPending}
              title="한글 수동 편집용 데이터 요약 1장"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
              <Download className="size-3.5" /> 데이터 시트
            </button>
            <button onClick={() => setMode(m => m === 'quick' ? 'full' : 'quick')}
              title={mode === 'quick' ? '서식 전체 모드 — 장·서식별 세부 입력' : '빠른 입력 모드 — 필수 공통값만'}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f5f4ff] transition-colors">
              {mode === 'quick' ? <LayoutList className="size-3.5" /> : <Zap className="size-3.5" />}
              {mode === 'quick' ? '서식 전체' : '빠른 입력'}
            </button>
          </div>
        )}
      </div>
      {msg && <p className="text-xs text-[#514b81] mb-3">{msg}</p>}

      {/* ══ 빠른 입력 모드 (기본 진입 — §1-1) ══ */}
      {mode === 'quick' && (
        <div className="space-y-4">
          {/* §7-3b: 최초 진입 1회 임포트 배너 — 서식 입력이 없고 구 생성 데이터가 있을 때 */}
          {importCandidate && canManage && !importHidden && (
            <div className="flex items-center gap-2 rounded-xl border border-[#c3bdf5] bg-[#f5f4ff] px-4 py-2.5">
              <Info className="size-4 text-[#7b68ee] shrink-0" />
              <span className="text-xs text-[#514b81]">
                이전에 생성한 소방계획서의 수기 편집값(구역·취약장소·피난계획·개정이력)을 서식 입력으로 가져올 수 있습니다. (최초 1회)
              </span>
              <button onClick={importLegacy} disabled={isImportPending}
                className="ml-auto inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium shrink-0 disabled:opacity-50">
                {isImportPending ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />} 가져오기
              </button>
              <button onClick={() => setImportHidden(true)} className="h-7 px-2 rounded-lg text-[11px] text-[#b0acd6] hover:text-[#514b81] shrink-0">닫기</button>
            </div>
          )}

          {/* 필요 문서 칩 (§9-8 매트릭스) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-[#514b81]">필요 문서</span>
            {docs.map(d => (
              <span key={d.doc} title={d.note}
                className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] border ${
                  !d.need ? 'text-[#b0acd6] border-[#eceafd]'
                    : d.have ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-[#f5f4ff] text-[#7b68ee] border-[#d0ccf5]'
                }`}>
                {d.label}{!d.need ? ' — 해당없음' : d.have ? ' ✓' : ''}
              </span>
            ))}
          </div>

          {/* 필수 완성도 (준비율 이원화 — 생성 가능 여부 기준) */}
          <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-semibold text-[#514b81]">필수 완성도 <span className="font-normal text-[#b0acd6]">(소방계획서 + 별지 9호 공통값)</span></p>
              <div className="h-1.5 w-24 rounded-full bg-[#eceafd] overflow-hidden">
                <div className={`h-full rounded-full ${quick.done < quick.total ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${quickPct}%` }} />
              </div>
              <span className="text-[11px] text-[#514b81]">{quick.done}/{quick.total}</span>
              {canManage && (
                <button onClick={refreshLedger} disabled={isLedgerPending}
                  title="건축물대장에서 건축허가일·면적·세대수·동수·승강기·주차장·구조·지붕·높이 자동 채움"
                  className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                  {isLedgerPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} 건축물대장 불러오기
                </button>
              )}
            </div>
            {/* 11-1c: 대장값 미리보기 — 변경분 앰버 하이라이트, [확정 저장]으로만 반영 */}
            {ledgerPreview && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                <p className="text-[11px] font-medium text-amber-800 mb-1.5">
                  건축물대장 조회 결과 — <span className="font-semibold">앰버 표시</span>가 변경되는 값입니다. 확인 후 확정 저장해주세요. (아직 저장 전)
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-2">
                  {ledgerPreview.map(f => (
                    <div key={f.key} className={`flex items-baseline gap-1.5 text-[11px] rounded px-1.5 py-0.5 ${f.changed ? 'bg-amber-100 text-amber-900' : 'text-[#514b81]'}`}>
                      <span className="w-24 shrink-0 text-[10px] text-[#847ba8]">{f.label}</span>
                      {f.changed && f.current !== '' && <span className="line-through text-amber-500">{f.current}</span>}
                      <span className={f.changed ? 'font-semibold' : ''}>{f.next}</span>
                      {!f.changed && <span className="text-[10px] text-[#b0acd6]">(동일)</span>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={applyLedger} disabled={isLedgerPending}
                    className="inline-flex items-center gap-1 h-7 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-medium disabled:opacity-50">
                    {isLedgerPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 확정 저장
                  </button>
                  <button onClick={() => setLedgerPreview(null)} disabled={isLedgerPending}
                    className="h-7 px-3 rounded-lg border border-amber-300 text-[11px] text-amber-700 hover:bg-amber-100 disabled:opacity-50">취소</button>
                </div>
              </div>
            )}
            {quick.missing.length > 0 ? (
              <>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[11px] text-amber-600">누락:</span>
                  {quick.missing.map(m2 => (
                    <button key={m2} onClick={() => gotoMissing(m2)}
                      title={`클릭 → ${CHIP_TARGET_LABEL[CHIP_TARGET[m2] ?? 'form11']}에서 입력`}
                      className="inline-flex items-center h-5 px-1.5 rounded bg-amber-50 text-amber-700 text-[10px] border border-amber-200 hover:bg-amber-100 hover:border-amber-300 cursor-pointer transition-colors">
                      {m2} ↗
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-[#b0acd6]">칩을 클릭하면 해당 입력처로 이동합니다 — 건물 값은 위 [건축물대장 불러오기]로도 채울 수 있습니다.</p>
              </>
            ) : (
              <p className="text-[11px] text-green-700">필수값이 모두 입력됐습니다 — 두 문서를 생성할 수 있습니다.</p>
            )}
          </div>

          {/* 전자우편 송달 동의 (098, 별지 9호 1쪽 — §9-6①) */}
          {canManage && (
            <div id="consent-section" className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
              <p className="text-xs font-semibold text-[#514b81] mb-2">자체점검 보고서 전자우편 송달 동의 <span className="font-normal text-[#b0acd6]">(별지 9호 1쪽)</span></p>
              <div className="flex items-center gap-2 flex-wrap">
                {([[true, '동의'], [false, '미동의']] as Array<[boolean, string]>).map(([v, label]) => (
                  <button key={label}
                    onClick={() => { setConsent(p => ({ ...p, consent: p.consent === v ? null : v })); setConsentDirty(true) }}
                    className={`h-8 px-3 rounded-lg text-xs font-medium border transition-colors ${
                      consent.consent === v ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'border-[#d0ccf5] text-[#514b81] hover:bg-[#f5f4ff]'
                    }`}>
                    {label}
                  </button>
                ))}
                <input value={consent.email} type="email" placeholder="송달 이메일"
                  onChange={e => { setConsent(p => ({ ...p, email: e.target.value })); setConsentDirty(true) }}
                  className="h-8 w-56 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]" />
                <button onClick={saveConsent} disabled={!consentDirty || isConsentPending}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
                  {isConsentPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 저장
                </button>
              </div>
            </div>
          )}

          {/* 최근 보관함 1줄 요약 */}
          <div className="flex items-center gap-2 rounded-xl border border-[#e0ddf5] px-4 py-2.5">
            <History className="size-3.5 text-[#b0acd6]" />
            {latestPlan ? (
              <span className="text-xs text-[#514b81]">
                최근 보관함: <span className="font-medium text-[#090c1d]">{latestPlan.year}년 {latestPlan.title}</span>
                {latestPlan.revision > 1 ? ` (개정${latestPlan.revision})` : ''} · PDF {latestPlan.pdfStatus === 'ready' ? '완료' : latestPlan.pdfStatus === 'converting' ? '변환 중' : '실패'}
              </span>
            ) : (
              <span className="text-xs text-[#b0acd6]">보관함이 비어 있습니다 — 첫 생성 시 자동 등록됩니다.</span>
            )}
            <button onClick={() => { setMode('full'); setChapter('archive') }}
              className="ml-auto text-[11px] text-[#7b68ee] hover:underline">보관함 열기 →</button>
          </div>
        </div>
      )}

      {/* ══ 서식 전체 모드 (고급 — 4-1 골격) ══ */}
      {mode === 'full' && (<>
      {/* 서브탭 (장 단위) */}
      <div className="flex items-center gap-1 flex-wrap mb-4">
        {CHAPTERS.map(c => {
          const Icon = c.icon
          return (
            <button key={c.key}
              onClick={() => setChapter(c.key)}
              className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                chapter === c.key ? 'bg-[#7b68ee] text-white' : 'text-[#514b81] hover:bg-[#f5f4ff]'
              }`}>
              <Icon className="size-3.5" /> {c.label}
            </button>
          )
        })}
      </div>

      {/* ── 개정이력·보관 ── */}
      {chapter === 'archive' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e0ddf5] bg-[#fafaff] p-4">
            <p className="text-xs font-semibold text-[#514b81] mb-2">개정이력</p>
            {revisionRows.length > 0 ? (
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="border-b border-[#e0ddf5] text-left text-[11px] text-[#514b81]">
                    <th className="pb-1 pr-3 font-medium w-12">순번</th>
                    <th className="pb-1 pr-3 font-medium w-24">일자</th>
                    <th className="pb-1 pr-3 font-medium">주요 개정내용</th>
                    <th className="pb-1 font-medium w-20">작성자</th>
                  </tr>
                </thead>
                <tbody>
                  {revisionRows.map((r, i) => (
                    <tr key={`${r.year}-${r.revision}-${i}`} className="border-b border-[#f3f1fb] last:border-0">
                      <td className="py-1.5 pr-3 text-[#514b81]">{i + 1}</td>
                      <td className="py-1.5 pr-3 text-[#090c1d]">{r.date.slice(0, 10)}</td>
                      <td className="py-1.5 pr-3 text-[#090c1d]">{r.note ?? `${r.year}년 소방계획서${r.revision > 1 ? ` (개정${r.revision})` : ' 작성'}`}</td>
                      <td className="py-1.5 text-[#514b81]">{r.uploader ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[11px] text-[#b0acd6] mb-3">생성 이력이 없습니다 — 첫 생성 시 1행이 기록됩니다</p>
            )}
            {canManage && (
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="text-[11px] font-medium text-[#514b81] block mb-1">이번 작성일 <span className="text-[#b0acd6] font-normal">(비우면 생성일)</span></label>
                  <DateInput value={rev.revisionDate}
                    onChange={e => { setRev(p => ({ ...p, revisionDate: e.target.value })); setRevDirty(true) }}
                    className="h-8 text-xs" />
                </div>
                <div className="flex-1 min-w-52">
                  <label className="text-[11px] font-medium text-[#514b81] block mb-1">주요 개정내용</label>
                  <input value={rev.revisionNote}
                    onChange={e => { setRev(p => ({ ...p, revisionNote: e.target.value })); setRevDirty(true) }}
                    placeholder={`${year}년 소방계획서 작성`}
                    className="h-8 w-full rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]" />
                </div>
                <button onClick={saveRevision} disabled={!revDirty || isRevPending}
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] text-white text-xs font-medium disabled:opacity-50">
                  {isRevPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} 저장
                </button>
              </div>
            )}
            <p className="text-[10px] text-[#b0acd6] mt-2">생성(HWP·PDF) 시 위 목록 + 이번 작성일·개정내용이 문서의 개정이력 표에 병합됩니다.</p>
          </div>
          {archive}
        </div>
      )}

      {/* ── 1장 소방안전관리계획 ── */}
      {chapter === 'ch1' && (
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-3">
            {CH1_FORMS.map(f => (
              f.active ? (
                <button key={f.key} onClick={() => setForm(f.key)}
                  className={`inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors ${
                    form === f.key ? 'bg-[#7b68ee] text-white border-[#7b68ee]' : 'bg-[#f5f4ff] text-[#7b68ee] border-[#d0ccf5] hover:bg-[#eceafd]'
                  }`}>
                  {f.label}
                </button>
              ) : (
                <span key={f.key}
                  title="후속 단계에서 제공됩니다 (소방계획서_4.md 4-3~4-4)"
                  className="inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-medium text-[#b0acd6] border border-[#eceafd]">
                  {f.label}<span className="ml-1 text-[9px]">예정</span>
                </span>
              )
            ))}
          </div>
          {form === '1.1' && form11}
          {form === '1.2' && form12}
          {form === '1.3' && form13}
          {form === '1.4' && form14}
          {form === '1.5' && form15}
          {form === '1.6' && form16}
          {form === '1.7' && form17}
          {form === '1.8' && form18}
          {form === '1.10' && form110}
          {form === '1.11' && form111}
        </div>
      )}

      {/* ── 2장 자위소방대 운영계획 ── */}
      {chapter === 'ch2' && ch2}

      {/* ── 3장 피난계획 ── */}
      {chapter === 'ch3' && ch3}
      </>)}
    </div>
  )
}
