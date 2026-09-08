'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Download, Loader2, Printer } from 'lucide-react'
import { previewFirePlanHtmlAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { FirePlanXlsxButton } from '@/components/customers/fire-plan-xlsx-button'

/** 소방계획서 즉석 조회·인쇄 (2026-09-02 사용자 확정 — 보관함 폐지)
 *
 *  ERP는 계획서 파일을 저장하지 않는다. [현재 내용]은 즉석 HTML 렌더, [엑셀 받기]·[인쇄]·
 *  [PDF 받기]는 누를 때마다 현재 입력값으로 서버가 즉석 생성해 내려준다 —
 *  파일도 개정 차수도 만들지 않는다. 소방서 제출본 등 파일 보관은 외부 폴더가 담당한다.
 *  연도 표기는 '보고서 커버' 서식(비우면 생성 연도), 변경 이력은 개정이력(수동 기록)이 담당한다.
 *
 *  소방계획서_42 D-1 — **엑셀이 기본 산출물**이다(받은 뒤 사용자가 직접 고쳐 최종본을 만든다).
 *  PDF는 뒤로 물리되 존치한다. */

export function FirePlanViewClient({ customerId }: { customerId: string }) {
  const [preview, setPreview] = useState<{ open: boolean; html: string; missing: string[]; loading: boolean }>(
    { open: false, html: '', missing: [], loading: false })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isPending, startTransition] = useTransition()

  const currentYear = new Date().getFullYear()

  /** 현재 내용 — 즉석 렌더. 파일을 만들지 않는다 (소방계획서_21 R2 D-3 규약 유지) */
  function togglePreview() {
    if (preview.open) { setPreview(p => ({ ...p, open: false })); return }
    setError('')
    setPreview({ open: true, html: '', missing: [], loading: true })
    startTransition(async () => {
      const res = await previewFirePlanHtmlAction(customerId, currentYear)
      if (res.error) { setError(res.error); setPreview({ open: false, html: '', missing: [], loading: false }); return }
      setPreview({ open: true, html: res.html ?? '', missing: res.missing ?? [], loading: false })
    })
  }

  /** 인쇄·PDF — 서버 즉석 생성 라우트를 새 탭으로. 브라우저 PDF 뷰어에서 바로 인쇄된다 */
  function openPdf(download: boolean) {
    window.open(`/customers/${customerId}/fire-plan/pdf${download ? '?download=1' : ''}`, '_blank')
  }

  /* 엑셀 받기 로직은 `fire-plan-xlsx-button.tsx`로 뺐다 (소방계획서_47) — 별지서식 탭에도
     같은 버튼이 필요해졌는데, 복제하면 한쪽만 고쳐지는 날이 온다. 고지·오류는 이 화면이
     이미 자리를 갖고 있으므로 콜백으로 받아 아래 기존 자리에 그대로 그린다. */

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-brand-line-soft">
        <button onClick={togglePreview} disabled={isPending}
          title="지금 서식 입력값으로 계획서를 그 자리에서 렌더합니다 — 파일을 만들지 않습니다"
          className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm font-medium text-ink-sub hover:bg-brand-tint hover:text-brand transition-colors disabled:opacity-50">
          {preview.loading ? <Loader2 className="size-3.5 animate-spin" /> : preview.open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          현재 내용
        </button>
        {/* D-1 — 엑셀이 주 버튼. 받은 뒤 엑셀에서 직접 고쳐 최종본을 만드는 것이 실사용 흐름이다 */}
        <FirePlanXlsxButton customerId={customerId} onNotice={setNotice} onError={setError} />
        <button onClick={() => openPdf(false)}
          title="현재 입력값으로 즉석 생성해 새 탭에서 엽니다 — 뷰어에서 바로 인쇄하세요"
          className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint transition-colors">
          <Printer className="size-3.5" /> 인쇄
        </button>
        <button onClick={() => openPdf(true)}
          title="현재 입력값으로 즉석 생성한 PDF를 내려받습니다"
          className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-ink-sub hover:bg-brand-tint hover:text-brand transition-colors">
          <Download className="size-3.5" /> PDF 받기
        </button>
        <span className="text-form-xs text-ink-meta">
          파일은 ERP에 저장되지 않습니다 — 항상 현재 입력값으로 즉석 생성 · 파일 보관은 외부 폴더
        </span>
      </div>

      {error && <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {/* 헤더 고지 — `window.open`이면 사라졌을 정보다(S6-3). 잘림 표기까지 그대로 보여 준다 */}
      {notice && (
        <p className="text-form-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap break-words">
          엑셀 고지: {notice}
        </p>
      )}

      {preview.open && (
        <div className="mb-4">
          {preview.missing.length > 0 && (
            <p className="text-form-xs text-amber-600 mb-1.5">
              미입력 {preview.missing.length}곳: {preview.missing.slice(0, 8).join(' · ')}{preview.missing.length > 8 ? ' …' : ''}
            </p>
          )}
          <iframe srcDoc={preview.html} title="현재 내용 미리보기" sandbox=""
            className="w-full h-[560px] rounded-lg border border-brand-line bg-surface" />
        </div>
      )}
    </div>
  )
}
