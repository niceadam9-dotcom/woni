'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Stamp, Trash2 } from 'lucide-react'
import { uploadCompanySealAction, removeCompanySealAction } from '@/app/(dashboard)/company/seal-actions'

/** 공문 하단 명의 미리보기 + 직인 업로드·교체·삭제 (C5 마무리, 2026-10-03 · 마이그 174)
 *  직인은 비공개 버킷에 있고 이 화면(관리자)에만 서버가 data URI로 내려 준다 — 공개 URL은 없다.
 *  미리보기의 겹침 위치는 PDF 공문(official.ts .of-seal)과 같은 비율로 흉내 낸다. */
export function CompanySealField({ senderName, signWho, sealSrc }: {
  senderName: string
  /** '대표이사 김흥준' — 대표자가 비면 빈 문자열 */
  signWho: string
  sealSrc: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    run(() => uploadCompanySealAction(fd))
    if (inputRef.current) inputRef.current.value = ''
  }

  const showSeal = !!sealSrc && !!signWho
  return (
    <div className="rounded-lg border border-brand-line-soft bg-brand-tint px-4 py-3">
      <p className="text-form-xs font-medium text-ink-sub">공문에 이렇게 찍힙니다</p>
      <p data-testid="seal-preview" className="mt-1.5 text-center text-sm font-bold leading-relaxed text-ink">
        {senderName}<br />
        {showSeal ? (
          <span className="relative inline-block">
            {signWho}
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI 미리보기(비공개 직인), 최적화 대상 아님 */}
            <img src={sealSrc!} alt="직인" className="absolute top-1/2 -translate-y-1/2 size-10 object-contain" style={{ right: '-1.9rem' }} />
          </span>
        ) : `${signWho || '대표이사 대표자'}(직인생략)`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={e => onFile(e.target.files?.[0])} />
        <button type="button" disabled={pending} onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand-line bg-surface px-3 text-xs font-medium text-ink hover:bg-brand-tint disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Stamp className="size-3.5" />}
          {sealSrc ? '직인 교체' : '직인 올리기'}
        </button>
        {sealSrc && (
          <button type="button" disabled={pending} onClick={() => run(removeCompanySealAction)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand-line bg-surface px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="size-3.5" /> 직인 삭제
          </button>
        )}
      </div>
      <p className="mt-1.5 text-form-xs text-ink-faint">
        흰 종이에 찍은 직인을 스캔·촬영해 올리면 바탕을 투명하게 바꿔 저장합니다 · 직인이 있으면 PDF 공문과 엑셀 「공문」 시트 모두 &lsquo;(직인생략)&rsquo; 대신 직인이 찍힙니다
        {sealSrc && !signWho && ' · ⚠ 대표자 이름이 없어 지금은 직인이 찍히지 않습니다'}
      </p>
      <p className="mt-1 text-form-xs text-ink-faint">
        비워두면 상호는 [회사명], 직함은 &lsquo;대표이사&rsquo;로 나갑니다 · 대표자 이름은 위 [대표자] 칸을 씁니다
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
