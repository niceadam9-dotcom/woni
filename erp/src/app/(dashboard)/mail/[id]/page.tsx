import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Mail } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { isGoogleConfigured, gmailGet } from '@/lib/google'
import { MailAttachmentList } from '@/components/mail/mail-attachment-list'

export const dynamic = 'force-dynamic'

/** 메일 상세 — HTML 본문은 sandbox iframe으로 격리 렌더 (스크립트 차단) */
export default async function MailDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!isGoogleConfigured()) redirect('/mail')

  const { id } = await params
  let mail: Awaited<ReturnType<typeof gmailGet>>
  try {
    mail = await gmailGet(id)
  } catch {
    notFound()
  }

  const dateStr = mail.date ? new Date(mail.date).toLocaleString('ko-KR') : ''

  return (
    <div className="space-y-4">
      <Link href="/mail" className="inline-flex items-center gap-1 text-sm text-[#7b68ee] hover:underline">
        <ChevronLeft className="size-4" /> 받은편지함
      </Link>

      <div className="bg-white rounded-xl border border-[#c8c4d0] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#e0ddf5]">
          <div className="flex items-start gap-3">
            <Mail className="size-5 text-[#7b68ee] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-[#090c1d]">{mail.subject}</h1>
              <p className="text-xs text-[#514b81] mt-1">보낸사람: {mail.from}</p>
              {mail.to && <p className="text-xs text-[#b0acd6]">받는사람: {mail.to}</p>}
              <p className="text-xs text-[#b0acd6]">{dateStr}</p>
            </div>
          </div>
        </div>

        <div className="p-2">
          {mail.html ? (
            <iframe
              sandbox=""
              srcDoc={mail.html}
              className="w-full border-0 rounded-lg bg-white"
              style={{ minHeight: '60vh' }}
              title="메일 본문"
            />
          ) : mail.text ? (
            <pre className="whitespace-pre-wrap text-sm text-[#292d34] p-4 font-sans">{mail.text}</pre>
          ) : (
            <p className="text-sm text-[#b0acd6] p-4">본문이 없습니다</p>
          )}
        </div>

        {mail.attachments.length > 0 && (
          <div className="px-6 py-4 border-t border-[#e0ddf5]">
            <MailAttachmentList messageId={mail.id} attachments={mail.attachments} />
          </div>
        )}
      </div>
    </div>
  )
}
