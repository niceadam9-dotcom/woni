'use client'

import { useTransition } from 'react'
import { Paperclip, Download, Loader2 } from 'lucide-react'
import { downloadMailAttachmentAction } from '@/app/(dashboard)/mail/actions'

export function MailAttachmentList({ messageId, attachments }: {
  messageId: string
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>
}) {
  const [isPending, startTransition] = useTransition()

  function download(att: { filename: string; mimeType: string; attachmentId: string }) {
    startTransition(async () => {
      const res = await downloadMailAttachmentAction(messageId, att.attachmentId, att.filename)
      if (res.error || !res.base64) { alert(res.error ?? '다운로드 실패'); return }
      const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: att.mimeType }))
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName ?? att.filename
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const fmtSize = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`

  return (
    <div>
      <p className="text-xs font-semibold text-[#514b81] mb-2 flex items-center gap-1">
        <Paperclip className="size-3.5" /> 첨부파일 {attachments.length}개
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map(att => (
          <button key={att.attachmentId} onClick={() => download(att)} disabled={isPending}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors disabled:opacity-50">
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            {att.filename} <span className="text-[#b0acd6]">({fmtSize(att.size)})</span>
          </button>
        ))}
      </div>
    </div>
  )
}
