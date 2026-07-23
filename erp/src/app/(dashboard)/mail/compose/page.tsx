import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, PenSquare } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGoogleConfigured, gmailGet } from '@/lib/google'
import { MailComposeClient } from '@/components/mail/mail-compose-client'

export const dynamic = 'force-dynamic'

/** 메일 작성 (2026-07-23) — ?reply=<id> 답장 / ?fwd=<id> 전달 프리필. 수신자 후보 = 관계인·직원 이메일 */
export default async function MailComposePage({
  searchParams,
}: { searchParams: Promise<{ reply?: string; fwd?: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  if (!isGoogleConfigured()) redirect('/mail')

  const { reply, fwd } = await searchParams
  const admin = createAdminClient()

  // 수신자 자동완성 후보 — 고객 관계인 + 직원 (이메일 보유자)
  const [contactsRes, profilesRes] = await Promise.all([
    admin.from('customer_contacts').select('name, email, customer:customers(customer_name)')
      .not('email', 'is', null).limit(300),
    admin.from('profiles').select('name, email').eq('is_active', true).not('email', 'is', null).limit(100),
  ])
  const seen = new Set<string>()
  const candidates: Array<{ email: string; label: string }> = []
  for (const c of (contactsRes.data ?? []) as unknown as Array<{ name: string; email: string; customer: { customer_name: string } | null }>) {
    if (!c.email || seen.has(c.email)) continue
    seen.add(c.email)
    candidates.push({ email: c.email, label: `${c.name} (${c.customer?.customer_name ?? '관계인'})` })
  }
  for (const p of (profilesRes.data ?? []) as Array<{ name: string; email: string }>) {
    if (!p.email || seen.has(p.email)) continue
    seen.add(p.email)
    candidates.push({ email: p.email, label: `${p.name} (직원)` })
  }

  // 답장/전달 프리필
  let initial: { to?: string; subject?: string; body?: string; replyToId?: string } = {}
  const srcId = reply ?? fwd
  if (srcId) {
    try {
      const mail = await gmailGet(srcId)
      const quote = (mail.text ?? '').split('\n').slice(0, 30).map(l => `> ${l}`).join('\n')
      const header = `\n\n\n----- 원본 메일 -----\n보낸사람: ${mail.from}\n날짜: ${mail.date}\n제목: ${mail.subject}\n\n${quote}`
      if (reply) {
        const fromEmail = mail.from.match(/<([^>]+)>/)?.[1] ?? mail.from
        initial = {
          to: fromEmail,
          subject: mail.subject.startsWith('Re:') ? mail.subject : `Re: ${mail.subject}`,
          body: header,
          replyToId: srcId, // 스레드 유지
        }
      } else {
        initial = {
          subject: mail.subject.startsWith('Fwd:') ? mail.subject : `Fwd: ${mail.subject}`,
          body: header,
        }
      }
    } catch { /* 원본 조회 실패 — 빈 작성 화면 */ }
  }

  return (
    <div className="space-y-4">
      <Link href="/mail" className="inline-flex items-center gap-1 text-sm text-[#7b68ee] hover:underline">
        <ChevronLeft className="size-4" /> 받은편지함
      </Link>
      <div className="flex items-center gap-2">
        <PenSquare className="size-5 text-[#7b68ee]" />
        <h1 className="text-lg font-bold text-[#090c1d]">{reply ? '답장' : fwd ? '전달' : '메일 쓰기'}</h1>
        <span className="text-xs text-[#b0acd6]">발신: sjfirekorea@gmail.com (공용)</span>
      </div>
      <MailComposeClient candidates={candidates} initial={initial} />
    </div>
  )
}
