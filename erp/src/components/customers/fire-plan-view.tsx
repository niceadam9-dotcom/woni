'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Loader2, Printer } from 'lucide-react'
import { previewFirePlanHtmlAction } from '@/app/(dashboard)/customers/fire-plan-form-actions'
import { firePlanPdfUrl } from '@/lib/fire-plan-doc-urls'

/** 소방계획서 즉석 조회·인쇄 (2026-09-02 사용자 확정 — 보관함 폐지)
 *
 *  ERP는 계획서 파일을 저장하지 않는다. [현재 내용]은 즉석 HTML 렌더, [엑셀 받기]·[인쇄]·
 *  [PDF 받기]는 누를 때마다 현재 입력값으로 서버가 즉석 생성해 내려준다 —
 *  파일도 개정 차수도 만들지 않는다. 소방서 제출본 등 파일 보관은 외부 폴더가 담당한다.
 *  연도 표기는 '보고서 커버' 서식(비우면 생성 연도), 변경 이력은 개정이력(수동 기록)이 담당한다.
 *
 *  소방계획서_42 D-1 — **엑셀이 기본 산출물**이다(받은 뒤 사용자가 직접 고쳐 최종본을 만든다).
 *
 *  ⭐ **여기는 「보는 곳」이고, 「받는 곳」은 탭 상단 생성 바다** (2026-09-21 사용자 요청).
 *    종전엔 이 노드가 [엑셀 받기]·[PDF 받기]까지 갖고 있었는데, 그러려면 사용자가 서식을 입력하다
 *    말고 트리에서 [조회·이력] 노드를 **찾아 들어와야** 했다. 받기를 생성 바로 올리면서 여기서는
 *    뺐다 — 남기면 같은 탭에 받기 창구가 두 벌이 되고, 둘 중 하나만 고쳐지는 날이 온다.
 *    [현재 내용](즉석 렌더)·[인쇄]는 조회 행위라 여기 남는다. */

export function FirePlanViewClient({ customerId }: { customerId: string }) {
  const [preview, setPreview] = useState<{ open: boolean; html: string; missing: string[]; loading: boolean }>(
    { open: false, html: '', missing: [], loading: false })
  const [error, setError] = useState('')
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

  /** 인쇄 — 서버 즉석 생성 라우트를 새 탭으로. 브라우저 PDF 뷰어에서 바로 인쇄된다.
   *  내려받기(`download=1`)는 생성 바의 [PDF]가 맡는다 — 여기 두면 받기 창구가 두 벌이다. */
  function openPrint() {
    window.open(firePlanPdfUrl(customerId), '_blank')
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-brand-line-soft">
        <button onClick={togglePreview} disabled={isPending}
          title="지금 서식 입력값으로 계획서를 그 자리에서 렌더합니다 — 파일을 만들지 않습니다"
          className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm font-medium text-ink-sub hover:bg-brand-tint hover:text-brand transition-colors disabled:opacity-50">
          {preview.loading ? <Loader2 className="size-3.5 animate-spin" /> : preview.open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          현재 내용
        </button>
        <button onClick={openPrint}
          title="현재 입력값으로 즉석 생성해 새 탭에서 엽니다 — 뷰어에서 바로 인쇄하세요"
          className="inline-flex items-center gap-1 h-form-8 px-3 rounded-lg border border-brand-line text-form-sm text-brand hover:bg-brand-tint transition-colors">
          <Printer className="size-3.5" /> 인쇄
        </button>
        <span className="text-form-xs text-ink-meta">
          파일은 ERP에 저장되지 않습니다 — 항상 현재 입력값으로 즉석 생성 · 파일 보관은 외부 폴더 ·
          <strong className="font-medium">엑셀·PDF 받기는 이 탭 맨 위 줄</strong>에 있습니다
        </span>
      </div>

      {error && <p className="text-form-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {/* 엑셀 고지 자리는 생성 바 아래로 함께 옮겼다(받기가 거기 있으므로) — 고지는 **받는 자리 옆**에
          떠야 읽힌다. 여기 남겨 두면 다른 노드에서 받았을 때 아무 데도 안 뜬다. */}

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
