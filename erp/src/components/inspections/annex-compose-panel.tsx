'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { X, Eye, FileText, Loader2, Save, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react'
import { getAnnexInputsAction, saveAnnexInputsAction, getPrevAnnexInputsAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { getAnnexPreviewHtmlAction, requestReport9Action } from '@/app/(dashboard)/inspections/report9-actions'
import { DateInput } from '@/components/ui/date-input'

/** 별지 9·10·11호 작성 패널 — 공통 3단 패턴 (소방계획서_7 H-23, §4-A-2b)
 *  [1단 자동 채움 검토(①②)] → [2단 서식 고유 값 입력(③ annex_inputs)] → [3단 미리보기·PDF 생성]
 *  진입점: 점검 상세 타임라인 ④⑤⑥ · 별지 9호 카드 — 화면 1개(이중 구현 금지).
 *  같은 점검 건을 다시 열면 이전 ③ 입력 유지(재생성 대응). 배지 규약(§4-A-2c): [자동]=회색·원본 링크, [입력]=보라 */

export type ComposeAnnexNo = 'report9' | 'report10' | 'report11'

const TITLES: Record<ComposeAnnexNo, { title: string; doc: string }> = {
  report9: { title: '별지 9호 작성', doc: '자체점검 실시결과 보고서' },
  report10: { title: '별지 10호 작성', doc: '이행계획서' },
  report11: { title: '별지 11호 작성', doc: '이행완료 보고서' },
}

type FieldDef = {
  key: string
  label: string
  type: 'date' | 'daterange' | 'text' | 'textarea' | 'select'
  placeholder?: string
  hint?: string
  /** type='select' 전용 — 첫 항목이 기본(빈 값=자동 판정) */
  options?: Array<{ value: string; label: string }>
}

/** ③ 서식 고유 값 폼 정의 — 별지 MD §3 계층 매핑 기준 (문서 레벨 값만, 불량별 값은 불량 카드가 원본) */
const FIELD_DEFS: Record<ComposeAnnexNo, FieldDef[]> = {
  report9: [
    { key: 'reportDate', label: '보고일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'note', label: '비고·보완 문구', type: 'textarea', hint: '1쪽 하단(유의사항 위)에 1줄 출력 — 없으면 미출력' },
    // B-2c(소방계획서_19 K-2, Q-1 확정): 교육훈련 '실시' 수동 보정 — 자동 판정(1.11.4 전년도 실적)이
    // 못 보는 경우(종이로만 실시) 구제. 부정('미실시') 강제는 없다 — 단정 금지 설계(A9-6 확정) 유지
    { key: 'eduDone', label: '소방안전교육 실시(전년도) 보정', type: 'select',
      options: [{ value: '', label: '자동 판정 (1.11.4 전년도 실적)' }, { value: '실시', label: '실시로 기재 (수동 확정)' }],
      hint: '2쪽 교육훈련 칸 — 실적 기록부에 없지만 실제 실시한 경우만 수동 확정' },
    { key: 'drillDone', label: '소방훈련 실시(전년도) 보정', type: 'select',
      options: [{ value: '', label: '자동 판정 (1.11.4 전년도 실적)' }, { value: '실시', label: '실시로 기재 (수동 확정)' }],
      hint: '2쪽 교육훈련 칸 — 실적 기록부에 없지만 실제 실시한 경우만 수동 확정' },
  ],
  report10: [
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'totalPeriod', label: '총 이행기간 (수동 보정)', type: 'daterange', hint: '미입력 시 불량별 계획 시작·종료일로 자동 산출 — 문서에는 "○년 ○월 ○일" 형식으로 출력' },
    { key: 'totalDays', label: '총 일수 (수동 보정)', type: 'text', placeholder: '예: 20' },
    { key: 'summary', label: '계획 내용 요약', type: 'textarea', hint: '이행조치 사항 표의 첫 행으로 출력' },
    { key: 'contractor', label: '공사업체 메모', type: 'text', hint: '내부 메모 — 문서에는 출력되지 않습니다' },
    { key: 'budget', label: '예산 메모', type: 'text', hint: '내부 메모 — 문서에는 출력되지 않습니다' },
  ],
  report11: [
    { key: 'reportDate', label: '제출일', type: 'date', hint: '미입력 시 생성일(오늘)로 출력' },
    { key: 'note', label: '완료 보고 문구', type: 'textarea', hint: '서명 블록 위에 1줄 출력 — 없으면 미출력' },
    { key: 'evidence', label: '증빙 목록 메모', type: 'textarea', hint: '내부 메모 — 전/후 사진·계약서 첨부는 제출 패키지에 자동 포함' },
  ],
}

type AutoRow = { label: string; source: string; href?: string }

/** 1단 [자동] 항목 요약 — ①②계층 원본·수정처 안내 (§4-A-0) */
function autoRows(annexNo: ComposeAnnexNo, customerId?: string, inspectionId?: string): AutoRow[] {
  const cust = customerId ? `/customers/${customerId}` : undefined
  // D-17 9호發 진입 컨텍스트 — 설비 대장이 스플릿 ON·첫 빈칸 포커스·[9호로 돌아가기]를 켜는 신호
  const ledger = customerId
    ? `/customers/${customerId}?tab=plan&form=1.4&from=report9${inspectionId ? `&insp=${inspectionId}` : ''}`
    : undefined
  if (annexNo === 'report9') {
    return [
      { label: '1~2쪽 대상물·관계인·건축물·보험', source: '고객정보', href: cust },
      { label: '1·3쪽 점검기간·점검인력·점검결과', source: '점검 상세(이 화면 점검표·참여자)' },
      { label: '4~7쪽 설비 세부현황', source: '설비 대장 (소방계획서 탭 1.4)', href: ledger },
      { label: '8쪽 불량 세부', source: '불량내역 카드(이 화면 아래)' },
    ]
  }
  if (annexNo === 'report10') {
    return [
      { label: '대상물·관계인·소방안전관리자', source: '고객정보', href: cust },
      { label: '이행조치 사항 표·총 이행기간(자동 산출)', source: '불량내역 카드 [이행계획]' },
    ]
  }
  return [
    { label: '대상물·관계인·소방공사업체(자사)', source: '고객정보·회사 정보', href: cust },
    { label: '이행조치 내용·완료일', source: '불량내역 카드 [조치 완료]' },
  ]
}

const stepNo = 'inline-flex items-center justify-center size-5 rounded-full bg-[#7b68ee] text-white text-[11px] font-bold shrink-0'
const badgeAuto = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#eeedf3] text-[#514b81]'
const badgeInput = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#7b68ee] text-white'
const inputBase = 'text-xs border border-[#c8c4d0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#7b68ee]'
const inputCls = `w-full ${inputBase}`

export function AnnexComposePanel({ inspectionId, annexNo, customerId, onClose, onGenerated }: {
  inspectionId: string
  annexNo: ComposeAnnexNo
  customerId?: string
  onClose: () => void
  onGenerated?: () => void
}) {
  const meta = TITLES[annexNo]
  const defs = FIELD_DEFS[annexNo]
  const [fields, setFields] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [previewHtml, setPreviewHtml] = useState('')
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()
  // H-5b 전 회차 이어받기 — 첫 작성(기존 입력 없음)일 때만 제안 (덮어쓰기 방지, D-5)
  const [prevOffer, setPrevOffer] = useState<{ fields: Record<string, string>; fromLabel: string } | null>(null)

  // 로드 — ③ 이전 입력 복원(getAnnexInputs) + ①② 누락 목록(preview missing)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setPreviewHtml('')
    setMsg('')
    setDirty(false)
    Promise.all([
      getAnnexInputsAction(inspectionId, annexNo),
      getAnnexPreviewHtmlAction(inspectionId, annexNo),
    ]).then(([inp, prev]) => {
      if (!alive) return
      const f: Record<string, string> = {}
      for (const d of FIELD_DEFS[annexNo]) {
        const v = inp.fields[d.key]
        if (typeof v === 'string') f[d.key] = v
      }
      setFields(f)
      setMissing(prev.missing ?? [])
      const err = inp.error || prev.error
      if (err) setMsg(`❌ ${err}`)
      setLoading(false)
      // H-5b: 첫 작성일 때만 전 회차 서술 입력 이어받기 제안 — 날짜류(type==='date')는 제외
      setPrevOffer(null)
      if (Object.values(f).every(v => !v?.trim())) {
        getPrevAnnexInputsAction(inspectionId, annexNo).then(pv => {
          if (!alive || !pv.fromLabel) return
          const copyable: Record<string, string> = {}
          for (const d of FIELD_DEFS[annexNo]) {
            if (d.type === 'date' || d.type === 'daterange') continue
            const v = pv.fields[d.key]
            if (typeof v === 'string' && v.trim()) copyable[d.key] = v
          }
          if (Object.keys(copyable).length > 0) setPrevOffer({ fields: copyable, fromLabel: pv.fromLabel })
        })
      }
    })
    return () => { alive = false }
  }, [inspectionId, annexNo])

  function setField(key: string, value: string) {
    setFields(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  async function doSave(): Promise<boolean> {
    const res = await saveAnnexInputsAction(inspectionId, annexNo, fields)
    if (res.error) { setMsg(`❌ ${res.error}`); return false }
    setDirty(false)
    return true
  }

  function save() {
    setMsg('')
    startTransition(async () => {
      if (await doSave()) setMsg('✅ 저장됨 — 같은 점검 건을 다시 열면 유지됩니다.')
    })
  }

  // 미리보기·생성 전 미저장분 자동 저장 — ③ 값이 문서에 반영되도록
  function preview() {
    setMsg('')
    startTransition(async () => {
      if (dirty && !(await doSave())) return
      const res = await getAnnexPreviewHtmlAction(inspectionId, annexNo)
      if (res.error || !res.html) { setMsg(`❌ ${res.error ?? '미리보기 실패'}`); return }
      setPreviewHtml(res.html)
      setMissing(res.missing ?? [])
    })
  }

  function generate() {
    setMsg('')
    startTransition(async () => {
      if (dirty && !(await doSave())) return
      const res = await requestReport9Action(inspectionId, annexNo)
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ PDF 생성 완료 — 생성물 목록에서 확인하세요.')
      onGenerated?.()
    })
  }

  return (
    <>
      {/* 오버레이 */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* 우측 슬라이드 패널 — 화면 1개 원칙(§4-A-2b) */}
      <div className="fixed right-0 top-0 h-full w-[560px] max-w-full bg-white shadow-2xl z-50 flex flex-col" data-annex-panel={annexNo}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e0ddf5] shrink-0">
          <div>
            <p className="text-sm font-semibold text-[#090c1d]">{meta.title} <span className="font-normal text-[#514b81]">— {meta.doc}</span></p>
            <p className="text-[11px] text-[#b0acd6] mt-0.5">자동 채움 검토 → 고유 값 입력 → 미리보기·생성 — 데이터는 입력하고, 문서는 생성합니다</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="p-1 hover:bg-[#f5f4ff] rounded-lg transition-colors">
            <X className="size-4 text-[#514b81]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <p className="text-xs text-[#514b81] inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 불러오는 중…</p>
          ) : (
            <>
              {/* ── H-5b 전 회차 이어받기 배너 (D-5) — 서술 입력만 복사, 날짜류 제외 ── */}
              {prevOffer && (
                <div className="flex items-center gap-2 rounded-lg bg-[#f5f4ff] border border-[#d0ccf5] px-3 py-2 text-xs text-[#514b81]">
                  <span>💡 전 회차({prevOffer.fromLabel}) 입력값이 있습니다 — 비고·요약 등 서술만 복사, 날짜는 새로 계산</span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setFields(prev => ({ ...prev, ...prevOffer.fields }))
                        setDirty(true)
                        setPrevOffer(null)
                        setMsg('✅ 전 회차 입력을 이어받았습니다 — 확인 후 저장하세요')
                      }}
                      className="h-6 px-2 rounded bg-[#7b68ee] hover:bg-[#6647f0] text-white text-[11px] font-medium">
                      이어받기
                    </button>
                    <button onClick={() => setPrevOffer(null)} className="h-6 px-2 rounded border border-[#d0ccf5] text-[11px] hover:bg-white">
                      새로 작성
                    </button>
                  </span>
                </div>
              )}

              {/* ── 1단 자동 채움 검토 ([자동] 회색 — §4-A-2c) ── */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className={stepNo}>1</span>
                  <h3 className="text-xs font-semibold text-[#090c1d]">자동 채움 검토</h3>
                  <span className={badgeAuto}>자동</span>
                  <span className="text-[10px] text-[#b0acd6]">여기서는 못 고칩니다 — 원본 화면에서 수정</span>
                </div>
                <div className="space-y-1.5 pl-7">
                  {autoRows(annexNo, customerId, inspectionId).map(r => (
                    <div key={r.label} className="flex items-center gap-2 text-xs">
                      <span className={badgeAuto}>자동</span>
                      <span className="text-[#090c1d]">{r.label}</span>
                      <span className="text-[10px] text-[#b0acd6] ml-auto text-right">
                        원본: {r.source}
                        {r.href && (
                          <Link href={r.href} className="text-[#7b68ee] hover:underline ml-1 inline-flex items-center gap-0.5">
                            수정 <ExternalLink className="size-2.5" />
                          </Link>
                        )}
                      </span>
                    </div>
                  ))}
                  {missing.length > 0 ? (
                    <p className="text-[11px] text-amber-600 flex items-start gap-1 pt-1">
                      <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                      <span>미비 항목: {missing.join(' · ')} — 빈 칸으로 출력됩니다 (생성은 막지 않음)</span>
                    </p>
                  ) : (
                    <p className="text-[11px] text-green-600 flex items-center gap-1 pt-1">
                      <CheckCircle2 className="size-3.5 shrink-0" /> 자동 채움 항목에 누락이 없습니다
                    </p>
                  )}
                </div>
              </section>

              {/* ── 2단 서식 고유 값 입력 ([입력] 보라 — ③ annex_inputs) ── */}
              <section className="border-t border-dashed border-[#e0ddf5] pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={stepNo}>2</span>
                  <h3 className="text-xs font-semibold text-[#090c1d]">서식 고유 값 입력</h3>
                  <span className={badgeInput}>입력</span>
                  <span className="text-[10px] text-[#b0acd6]">이 서식에서만 쓰는 값 — 여기서만 입력</span>
                  {dirty && <span className="text-[10px] text-amber-600 font-medium ml-auto">미저장</span>}
                </div>
                <div className="space-y-3 pl-7">
                  {defs.map(d => (
                    <div key={d.key}>
                      <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#514b81] mb-1">
                        <span className={badgeInput}>입력</span> {d.label}
                      </label>
                      {d.type === 'date' ? (
                        <DateInput value={fields[d.key] ?? ''} aria-label={d.label}
                          onChange={e => setField(d.key, e.target.value)} className={`${inputCls} w-40`} />
                      ) : d.type === 'daterange' ? (
                        // 가입기간(1.1 일반현황)과 동일 패턴 — "YYYY-MM-DD ~ YYYY-MM-DD"로 저장, 문서 출력 시 한국어 날짜로 변환(report9-actions)
                        (() => {
                          const [ps = '', pe = ''] = (fields[d.key] ?? '').split(/\s*~\s*/)
                          const join = (s: string, e2: string) => setField(d.key, !s && !e2 ? '' : `${s} ~ ${e2}`.trim())
                          return (
                            <span className="inline-flex items-center gap-1.5">
                              <DateInput value={ps} aria-label={`${d.label} 시작일`} onChange={e => join(e.target.value, pe)} className={`${inputBase} w-36`} />
                              <span className="text-xs text-[#847ba8] shrink-0">~</span>
                              <DateInput value={pe} aria-label={`${d.label} 종료일`} onChange={e => join(ps, e.target.value)} className={`${inputBase} w-36`} />
                            </span>
                          )
                        })()
                      ) : d.type === 'select' ? (
                        <select value={fields[d.key] ?? ''} aria-label={d.label}
                          onChange={e => setField(d.key, e.target.value)} className={`${inputBase} w-64 bg-white`}>
                          {(d.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : d.type === 'textarea' ? (
                        <textarea value={fields[d.key] ?? ''} aria-label={d.label} rows={2}
                          placeholder={d.placeholder} onChange={e => setField(d.key, e.target.value)}
                          className={`${inputCls} resize-y`} />
                      ) : (
                        <input type="text" value={fields[d.key] ?? ''} aria-label={d.label}
                          placeholder={d.placeholder} onChange={e => setField(d.key, e.target.value)}
                          className={inputCls} />
                      )}
                      {d.hint && <p className="text-[10px] text-[#b0acd6] mt-0.5">{d.hint}</p>}
                    </div>
                  ))}
                  <button onClick={save} disabled={isPending || !dirty}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] font-medium text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                    {isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />} 저장
                  </button>
                </div>
              </section>

              {/* ── 3단 미리보기 · PDF 생성 ── */}
              <section className="border-t border-dashed border-[#e0ddf5] pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={stepNo}>3</span>
                  <h3 className="text-xs font-semibold text-[#090c1d]">미리보기 · PDF 생성</h3>
                  <span className="text-[10px] text-[#b0acd6]">미입력 [입력] 항목은 노란 하이라이트 (§4-A-2c)</span>
                </div>
                <div className="pl-7 space-y-2">
                  <div className="flex items-center gap-2">
                    <button onClick={preview} disabled={isPending}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs font-medium text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
                      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} 미리보기
                    </button>
                    <button onClick={generate} disabled={isPending}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium transition-colors disabled:opacity-50">
                      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} PDF 생성
                    </button>
                    <span className="text-[10px] text-[#b0acd6]">미저장 입력은 자동 저장 후 반영</span>
                  </div>
                  {msg && <p className="text-xs text-[#514b81]">{msg}</p>}
                  {previewHtml && (
                    <iframe srcDoc={previewHtml} title={`${meta.doc} 미리보기`} sandbox=""
                      className="w-full h-[480px] border border-[#e0ddf5] rounded-lg bg-white" />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  )
}
