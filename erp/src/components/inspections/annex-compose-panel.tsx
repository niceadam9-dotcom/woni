'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { X, Eye, FileText, Loader2, Save, ExternalLink } from 'lucide-react'
import { AnnexMissingList } from '@/components/inspections/annex-missing-list'
import { getAnnexInputsAction, saveAnnexInputsAction, getPrevAnnexInputsAction, getAnnexAutoDefaultsAction } from '@/app/(dashboard)/customers/facility-spec-actions'
import { getAnnexPreviewHtmlAction, requestReport9Action } from '@/app/(dashboard)/inspections/report9-actions'
import { ANNEX_TITLES as TITLES, FIELD_DEFS, AnnexFieldInput, type ComposeAnnexNo } from '@/components/inspections/annex-fields'

/** 별지 9·10·11호 작성 패널 — 공통 3단 패턴 (소방계획서_7 H-23, §4-A-2b)
 *  [1단 자동 채움 검토(①②)] → [2단 서식 고유 값 입력(③ annex_inputs)] → [3단 미리보기·PDF 생성]
 *  진입점: 점검 상세 타임라인 ④⑤⑥ · 별지 9호 카드 — 화면 1개(이중 구현 금지).
 *  같은 점검 건을 다시 열면 이전 ③ 입력 유지(재생성 대응). 배지 규약(§4-A-2c): [자동]=회색·원본 링크, [입력]=보라 */

export type { ComposeAnnexNo }

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
  // 자동 계산값 — 보여주기만 한다(저장 금지). 작업대 AnnexFields와 같은 규약
  const [auto, setAuto] = useState<Record<string, string>>({})
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
      // 자동값은 보조 정보 — 실패해도 입력은 되어야 한다
      getAnnexAutoDefaultsAction(inspectionId, annexNo).catch(() => ({ defaults: {} })),
    ]).then(([inp, prev, def]) => {
      if (!alive) return
      const f: Record<string, string> = {}
      for (const d of FIELD_DEFS[annexNo]) {
        const v = inp.fields[d.key]
        if (typeof v === 'string') f[d.key] = v
      }
      setFields(f)
      setAuto(def.defaults ?? {})
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
                  <AnnexMissingList missing={missing} customerId={customerId} inspectionId={inspectionId} />
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
                  {defs.map(d => {
                    // 자동 계산값을 빈 칸에 회색으로 비춘다 — 작업대(AnnexFields)와 같은 규약.
                    // 채워 넣지는 않는다: 저장되면 원천이 바뀌어도 옛 값이 굳는다.
                    const a = auto[d.key]?.trim()
                    const filled = (fields[d.key] ?? '').trim()
                    return (
                      <div key={d.key}>
                        <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#514b81] mb-1">
                          <span className={badgeInput}>입력</span> {d.label}
                        </label>
                        <AnnexFieldInput def={a ? { ...d, placeholder: a } : d} value={fields[d.key] ?? ''}
                          onChange={v => setField(d.key, v)} />
                        {a && !filled && (
                          <p className="text-[10px] text-[#847ba8] mt-0.5">
                            <span className="inline-flex items-center rounded bg-[#eeecf8] px-1 py-px text-[9px] font-medium text-[#514b81] mr-1">자동</span>
                            이대로 출력됩니다 — 고치면 고친 값이 나갑니다
                          </p>
                        )}
                        {d.hint && <p className="text-[10px] text-[#b0acd6] mt-0.5">{d.hint}</p>}
                      </div>
                    )
                  })}
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
