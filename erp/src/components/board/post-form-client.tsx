'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createPostAction, updatePostAction } from '@/app/(dashboard)/board/actions'

const inputCls = 'w-full h-10 rounded-lg border border-brand-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition'

type Category = { id: string; name: string }
type Post = { id: string; title: string; content: string; category_id: string; is_notice: boolean }

export function PostFormClient({ categories, existing, isAdmin }: { categories: Category[]; existing?: Post; isAdmin: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    category_id: existing?.category_id ?? (categories[0]?.id ?? ''),
    title: existing?.title ?? '',
    content: existing?.content ?? '',
    is_notice: existing?.is_notice ?? false,
  })

  function setField(key: keyof typeof form, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    setError('')
    if (!form.category_id) { setError('카테고리를 선택해주세요.'); return }
    if (!form.title.trim()) { setError('제목을 입력해주세요.'); return }
    if (!form.content.trim()) { setError('내용을 입력해주세요.'); return }

    startTransition(async () => {
      if (existing) {
        const result = await updatePostAction({
          id: existing.id, title: form.title.trim(), content: form.content.trim(), is_notice: form.is_notice,
        })
        if (result.error) { setError(result.error); return }
        router.push(`/board/${existing.id}`)
        router.refresh()
      } else {
        const result = await createPostAction({
          category_id: form.category_id, title: form.title.trim(), content: form.content.trim(), is_notice: form.is_notice,
        })
        if (result.error) { setError(result.error); return }
        router.push(`/board/${result.postId}`)
        router.refresh()
      }
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="bg-surface rounded-xl border border-line shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-ink-sub">카테고리 <span className="text-red-500">*</span></label>
            <select value={form.category_id} onChange={e => setField('category_id', e.target.value)} className={inputCls}>
              <option value="">선택</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {isAdmin && (
            <label className="flex items-center gap-2 cursor-pointer mt-5">
              <input type="checkbox" checked={form.is_notice} onChange={e => setField('is_notice', e.target.checked)}
                className="size-4 rounded border-brand-line accent-brand" />
              <span className="text-sm text-ink-sub">공지로 등록</span>
            </label>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-ink-sub">제목 <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e => setField('title', e.target.value)} placeholder="제목을 입력하세요" className={inputCls} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-ink-sub">내용 <span className="text-red-500">*</span></label>
          <textarea value={form.content} onChange={e => setField('content', e.target.value)} placeholder="내용을 입력하세요" rows={10}
            className="w-full rounded-lg border border-brand-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition resize-none" />
        </div>
      </section>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>}

      <div className="flex gap-3 pb-8">
        <button type="button" onClick={() => router.back()}
          className="flex-1 h-11 rounded-lg border border-line text-sm text-ink-sub hover:bg-paper transition-colors">취소</button>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="flex-1 h-11 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors flex items-center justify-center disabled:opacity-50">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : (existing ? '수정' : '등록')}
        </button>
      </div>
    </div>
  )
}
