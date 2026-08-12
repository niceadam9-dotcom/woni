'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2, Trash2 } from 'lucide-react'
import { listCleanupTargetsAction, cleanupArchiveAction } from '@/app/(dashboard)/customers/fire-plan-cleanup-actions'
// 타입은 원천에서 직접 — 'use server' 파일은 타입 re-export도 런타임 export로 바뀌어 깨진다
import type { CleanupPreview, CleanupResult } from '@/lib/archive-cleanup'

/** 보관함 [과거본 정리] (소방계획서_18 S2) — "최신만 ERP, 과거는 종이 보관".
 *  Storage 산출물 파일만 지운다(원천·이력 무손실, D-5). 인쇄 완료 확인을 강제한다(D-1).
 *  드라이브 백업 안전망은 폐지됐다(D-6, 2026-08-10 사용자 재확정) — 종이가 유일한 사본이므로
 *  삭제는 복구 불가다. 게이트가 '인쇄 완료' 확인 하나뿐인 만큼 문구로 그 사실을 분명히 알린다. */
export function PlanArchiveCleanup({ customerId, canManage }: { customerId: string; canManage: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [printed, setPrinted] = useState(false)
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [error, setError] = useState('')

  if (!canManage) return null

  function load() {
    setError(''); setResult(null); setPrinted(false)
    startTransition(async () => {
      const res = await listCleanupTargetsAction(customerId)
      if (res.error || !res.data) { setError(res.error ?? '조회 실패'); return }
      setPreview(res.data)
    })
  }

  function run() {
    if (!preview) return
    startTransition(async () => {
      const res = await cleanupArchiveAction(customerId, { printed, signature: preview.signature })
      if (res.error || !res.data) {
        setError(res.error ?? '정리 실패')
        // 대상이 바뀌어 거부된 경우 — 미리보기를 닫아야 [대상 확인]이 다시 나온다.
        // 안 닫으면 같은 에러만 반복되고 사용자는 빠져나갈 길을 못 찾는다.
        if (res.error?.includes('대상')) setPreview(null)
        return
      }
      setResult(res.data)
      setPreview(null)
      router.refresh()
    })
  }

  const canRun = !!preview && preview.totalFiles > 0 && printed

  return (
    <div className="mt-4 rounded-xl border border-[#e8e6f5] bg-[#fafaff] p-3 text-xs" data-testid="archive-cleanup">
      <div className="flex items-center gap-2">
        <Archive className="size-3.5 text-[#847ba8]" />
        <span className="font-semibold text-[#514b81]">과거본 정리</span>
        <span className="text-[#b0acd6]">— 최신 계획서·최신 회차 별지만 남기고 과거 산출물 파일을 정리합니다 (입력 데이터·개정이력은 유지)</span>
        {!preview && !result && (
          <button onClick={load} disabled={isPending}
            className="ml-auto h-7 px-3 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50">
            {isPending ? <Loader2 className="size-3 animate-spin" /> : '대상 확인'}
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-2 space-y-2">
          {preview.totalFiles === 0 ? (
            <p className="text-[#b0acd6]">정리할 과거 산출물이 없습니다 — 이미 최신만 남아 있습니다.</p>
          ) : (
            <>
              <ul className="space-y-1 text-[#514b81]">
                {preview.oldPlans.map(p => (
                  <li key={p.id}>
                    · 계획서 과거본: {p.label} (파일 {p.fileCount}개)
                    {p.attachments > 0 && <span className="text-amber-700"> + 부속자료 {p.attachments}개</span>}
                  </li>
                ))}
                {preview.oldRoundFiles.map(r => (
                  <li key={r.round}>
                    · 과거 회차 별지: {r.round} (파일 {r.count}개)
                    {r.scans > 0 && <span className="text-amber-700"> + 업로드 스캔 {r.scans}개</span>}
                  </li>
                ))}
                {preview.staleLatestFiles > 0 && <li>· 최신 회차 내 구본(재생성 이전 파일): {preview.staleLatestFiles}개</li>}
              </ul>
              <p className="font-medium text-[#090c1d]">총 {preview.totalFiles}개 파일이 삭제됩니다.</p>
              {preview.scanFiles > 0 && (
                <p className="text-amber-700">
                  업로드 스캔 {preview.scanFiles}개(배치확인서·계약서)가 함께 삭제됩니다 — 종이 원본을 보관 중인지 확인하세요.
                </p>
              )}
              {preview.attachmentFiles > 0 && (
                <p className="text-amber-700">
                  과거 계획서의 부속자료(지도·사진) {preview.attachmentFiles}개도 함께 삭제됩니다 — 업로드 원본이라 다시 만들 수 없습니다.
                </p>
              )}
              {/* D-6: 드라이브 백업 폐지 — 종이가 유일한 사본이라는 사실을 게이트 문구가 직접 말한다 */}
              <p className="text-red-600 font-medium">
                ⚠ 백업이 없습니다 — 삭제한 파일은 복구할 수 없습니다. 종이 출력물이 유일한 사본이 됩니다.
                <span className="font-normal text-[#847ba8]"> (입력 데이터는 남으므로 별지는 다시 생성할 수 있습니다)</span>
              </p>
              <label className="flex items-center gap-2 text-[#514b81]">
                <input type="checkbox" checked={printed} onChange={e => setPrinted(e.target.checked)} />
                종이 보관(인쇄)을 완료했습니다 — 자체점검 결과는 2년 보관 의무가 있습니다
              </label>
              <div className="flex gap-2">
                <button onClick={() => setPreview(null)}
                  className="h-7 px-3 rounded-lg border border-[#c8c4d0] text-[11px] text-[#514b81] hover:bg-white">취소</button>
                <button onClick={run} disabled={!canRun || isPending}
                  className="h-7 px-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] font-medium disabled:opacity-40 inline-flex items-center gap-1">
                  {isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} 정리 실행
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-2 text-[#514b81]">
          <p>
            ✅ 정리 완료 — 계획서 과거본 {result.plansDeleted}건, 파일 {result.filesDeleted}개 삭제
            {result.scansDeleted > 0 && ` (업로드 스캔 ${result.scansDeleted}개 포함)`}
          </p>
          {result.skipped.length > 0 && (
            <div className="mt-1 text-amber-700">
              <p>⚠ 건너뜀 {result.skipped.length}건 — 항목별 사유:</p>
              <ul className="max-h-96 overflow-auto">
                {result.skipped.map(s => <li key={s.path}>· {s.path.split('/').pop()}: {s.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  )
}
