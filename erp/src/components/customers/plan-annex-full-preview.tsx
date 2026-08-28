'use client'

import { useRef } from 'react'
import { Loader2 } from 'lucide-react'
import type { CustomerRound } from '@/app/(dashboard)/reports/docs-actions'
import { AnnexPrintButton } from '@/components/customers/annex-print-button'

/** 회차 전체 미리보기 모달 (소방계획서_8 H-5c + 2026-08-10 #13 단일 문서 모드).
 *  소방계획서_20 S3에서 plan-annex-section.tsx에서 분리 — 문자열·#fp-* 앵커·동작 모두 불변. */

export type PreviewDoc = {
  type: 'report9' | 'report4' | 'report10' | 'report11'
  label: string
  html?: string
  missing: string[]
  error?: string
}

export type FullPreviewState = { inspectionId: string; label: string; only?: PreviewDoc['type'] }

export function PlanAnnexFullPreview({
  state, setState, docsForPreview, curRound, customerName, open, upload, feedback,
}: {
  state: FullPreviewState
  setState: (updater: (p: FullPreviewState | null) => FullPreviewState | null) => void
  docsForPreview: PreviewDoc[]
  curRound: CustomerRound | undefined
  customerName: string
  open: (path: string | null | undefined, saveName?: string) => void
  upload: (inspectionId: string, slot: 'cert' | 'contract', file: File, rowKey: string) => void
  feedback: (key: string) => React.ReactNode
}) {
  // 요약 바의 배치확인서 칩 — 없으면 그 자리에서 업로드(협회 발급본이라 생성 불가)
  const certChipRef = useRef<HTMLInputElement>(null)

  const allLoaded = docsForPreview.length > 0 && docsForPreview.every(d => d.html || d.error)
  const totalMissing = docsForPreview.reduce((n, d) => n + d.missing.length, 0)
  // 종이 보관 후 정리된 회차는 누락이 아니다 (소방계획서_18 D-7 ⚠)
  const certMissing = curRound?.docs ? !curRound.docs.cert && !curRound.docs.certArchived : false
  // 단일 문서 모드 — 선택 문서가 이 회차에 없으면(불량 0건 회차의 ⑩⑪) 전체 모드로 되돌린다
  const only = state.only ? docsForPreview.find(d => d.type === state.only) : undefined
  const close = () => setState(() => null)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[60]" onClick={close} />
      <div className="fixed inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 top-6 bottom-6 md:w-[860px] bg-surface rounded-2xl shadow-2xl z-[70] flex flex-col">
        {/* 요약 바 (고정 상단) — 칩 = 문서 선택기([전체] + 문서별), 단일 모드에서도 닫지 않고 전환 */}
        <div className="px-5 py-3 border-b border-brand-line-soft shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-ink">
              {state.label} — {only ? `${only.label} 보기` : '전체 미리보기'}
            </p>
            <button onClick={close} className="ml-auto text-ink-faint hover:text-ink-sub">✕</button>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
            <button onClick={() => setState(p => p && { ...p, only: undefined })}
              title="전 별지를 세로로 이어 봅니다"
              className={`px-2 py-0.5 rounded-full border ${!state.only ? 'border-brand bg-brand-tint text-brand font-medium' : 'border-brand-line text-ink-sub hover:bg-brand-tint'}`}>
              전체
            </button>
            {docsForPreview.map(d => (
              <button key={d.type}
                onClick={() => setState(p => p && { ...p, only: d.type })}
                title={`${d.label}만 크게 보기`}
                className={`px-2 py-0.5 rounded-full border ${state.only === d.type ? 'border-brand bg-brand-tint text-brand font-medium'
                  : d.missing.length > 0 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                {d.label.replace(' 점검표', '').replace(' 실시결과 보고서', '').replace(' 이행계획서', '').replace(' 이행완료 보고서', '')} {d.missing.length > 0 ? `⚠${d.missing.length}곳` : '✓'}
              </button>
            ))}
            {/* 배치확인서 — 별지와 달리 협회 발급본이라 생성이 없다. 없으면 이 자리에서 업로드, 있으면 열기 */}
            {(() => {
              const cert = curRound?.docs?.cert
              const certKey = `${state.inspectionId}:cert-chip`
              const chipCls = 'px-2 py-0.5 rounded-full border transition-colors'
              // 종이 보관 후 정리된 회차 — 업로드를 재촉하면 안 된다 (소방계획서_18 D-7 ⚠)
              if (!cert && curRound?.docs?.certArchived) {
                return (
                  <span title="과거본 정리로 ERP 사본이 삭제되었습니다 — 원본은 종이로 보관 중"
                    className={`${chipCls} border-brand-line-soft bg-brand-tint text-ink-soft`}>
                    배치확인서 · 종이 보관
                  </span>
                )
              }
              if (cert) {
                return (
                  <button onClick={() => open(cert.path, `${customerName}_점검인력 배치확인서_${(cert.at ?? '').slice(0, 10)}.${cert.path.split('.').pop()}`)}
                    title="협회 발급 배치확인서 열기"
                    className={`${chipCls} border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50`}>
                    배치확인서 ✓
                  </button>
                )
              }
              return (
                <>
                  <input ref={certChipRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.hwp" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(state.inspectionId, 'cert', f, certKey); e.target.value = '' }} />
                  {/* isPending은 미리보기 렌더·문서 생성과 공유하는 플래그다 — 여기에 묶으면 미리보기가 뜨는 동안
                      업로드를 못 누른다. 칩은 회차 문서 정보만 보고, 업로드 결과는 아래 feedback이 알린다 */}
                  <button onClick={() => certChipRef.current?.click()} disabled={!curRound?.docs}
                    title="협회(kfma.kr) 발급본을 업로드합니다 — 미리보기를 닫지 않고 이 자리에서"
                    className={`${chipCls} border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50`}>
                    배치확인서 ⚠없음 — 업로드
                  </button>
                </>
              )
            })()}
            {feedback(`${state.inspectionId}:cert-chip`)}
            {allLoaded && totalMissing === 0 && !certMissing && (
              <span className="text-green-700 font-medium">✅ 제출 준비 완료 — 빈칸 없음</span>
            )}
            {allLoaded && totalMissing > 0 && (
              <span className="text-ink-faint">미입력 총 {totalMissing}곳 — 본문 노란 하이라이트 확인</span>
            )}
          </div>
        </div>
        {/* 본문 — 단일 모드는 문서 1건이 창 높이를 다 쓰고(8쪽짜리 9호 대응), 전체 모드는 종전대로 세로 연결 */}
        {only ? (
          <div className="flex-1 flex flex-col bg-paper p-4 min-h-0">
            <div className="flex items-start gap-2 mb-1.5 shrink-0">
              <p className="text-xs font-semibold text-ink-sub">
                ▌{only.label}
                {only.missing.length > 0 && <span className="text-amber-600"> ⚠ 미입력 {only.missing.length}곳: {only.missing.slice(0, 6).join(' · ')}{only.missing.length > 6 ? ' …' : ''}</span>}
              </p>
              {/* 이 별지만 인쇄 — 생성본이 있으면 서버 PDF(제출용), 없으면 초안(경고 후) */}
              <span className="ml-auto shrink-0 flex items-center gap-1.5">
                <AnnexPrintButton
                  inspectionId={state.inspectionId}
                  type={only.type}
                  label={only.label}
                  hasPdf={!!curRound?.docs?.[only.type]?.pdf}
                />
              </span>
            </div>
            {only.error ? (
              <p className="text-xs text-red-600 bg-surface rounded-lg p-3">{only.error}</p>
            ) : only.html ? (
              <iframe srcDoc={only.html} title={only.label} className="flex-1 w-full bg-surface rounded-lg border border-brand-line-soft" />
            ) : (
              <p className="text-xs text-ink-sub inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 미리보기 렌더 중…</p>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-paper p-4 space-y-4">
            {!allLoaded && (
              <p className="text-xs text-ink-sub inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> 미리보기 렌더 중…</p>
            )}
            {docsForPreview.map(d => (
              <div key={d.type} id={`fp-${d.type}`}>
                <p className="text-xs font-semibold text-ink-sub mb-1.5">▌{d.label} {d.missing.length > 0 && <span className="text-amber-600">⚠ 미입력 {d.missing.length}곳: {d.missing.slice(0, 4).join(' · ')}{d.missing.length > 4 ? ' …' : ''}</span>}</p>
                {d.error ? (
                  <p className="text-xs text-red-600 bg-surface rounded-lg p-3">{d.error}</p>
                ) : d.html ? (
                  <iframe srcDoc={d.html} title={d.label} className="w-full h-[540px] bg-surface rounded-lg border border-brand-line-soft" />
                ) : (
                  <div className="h-24 bg-surface rounded-lg border border-brand-line-soft animate-pulse" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
