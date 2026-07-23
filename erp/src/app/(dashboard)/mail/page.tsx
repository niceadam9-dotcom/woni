import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Mail, Search, Paperclip, ChevronRight, PenSquare } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { isGoogleConfigured, gmailList } from '@/lib/google'

export const dynamic = 'force-dynamic'

/** 회사 메일 (sjfirekorea@gmail.com) 읽기 전용 조회 — 전 직원 개방 (2026-07-15) */
export default async function MailPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; pageToken?: string; box?: string }> }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const q = sp.q ?? ''
  const box = sp.box === 'sent' ? 'sent' : 'inbox' // 보낸편지함 탭 (조회 스코프로 in:sent 검색만)

  if (!isGoogleConfigured()) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="bg-white rounded-xl border border-[#c8c4d0] p-10 text-center">
          <p className="text-sm text-[#514b81]">Google 계정 연동이 아직 설정되지 않았습니다.</p>
          <p className="text-xs text-[#b0acd6] mt-2">관리자: GCP OAuth 설정 후 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN 환경변수를 등록하세요. (erp_goal/구글연동-GCP설정.md)</p>
        </div>
      </div>
    )
  }

  let messages: Awaited<ReturnType<typeof gmailList>>['messages'] = []
  let nextPageToken: string | undefined
  let error: string | null = null
  try {
    const boxQ = box === 'sent' ? 'in:sent' : 'in:inbox'
    const res = await gmailList({ q: q ? `${boxQ} ${q}` : boxQ, pageToken: sp.pageToken })
    messages = res.messages
    nextPageToken = res.nextPageToken
  } catch (e) {
    error = (e as Error).message
  }

  function pageUrl(token: string) {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (box === 'sent') p.set('box', 'sent')
    p.set('pageToken', token)
    return `/mail?${p}`
  }

  return (
    <div className="space-y-6">
      <Header />

      <div className="flex items-center gap-2 flex-wrap">
        {/* 받은/보낸 탭 */}
        <div className="flex rounded-lg border border-[#d0ccf5] overflow-hidden">
          <Link href="/mail" className={`h-9 px-4 inline-flex items-center text-sm ${box === 'inbox' ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>받은편지함</Link>
          <Link href="/mail?box=sent" className={`h-9 px-4 inline-flex items-center text-sm ${box === 'sent' ? 'bg-[#7b68ee] text-white' : 'bg-white text-[#514b81] hover:bg-[#f5f4ff]'}`}>보낸편지함</Link>
        </div>
        <form method="GET" action="/mail" className="flex items-center gap-2">
          {box === 'sent' && <input type="hidden" name="box" value="sent" />}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#b0acd6]" />
            <input name="q" defaultValue={q} placeholder="검색 (보낸사람, 제목, from:xxx 등 Gmail 문법)"
              className="h-9 w-80 rounded-lg border border-[#d0ccf5] bg-white pl-8 pr-3 text-sm outline-none focus:border-[#7b68ee]" />
          </div>
          <button type="submit" className="h-9 px-4 rounded-lg bg-[#202023] hover:bg-[#292d34] text-white text-sm font-medium transition-colors">검색</button>
          {q && <Link href={box === 'sent' ? '/mail?box=sent' : '/mail'} className="text-xs text-[#7b68ee] hover:underline">초기화</Link>}
        </form>
        <Link href="/mail/compose"
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-sm font-medium transition-colors">
          <PenSquare className="size-4" /> 메일 쓰기
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          메일을 불러오지 못했습니다: {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#c8c4d0] overflow-hidden">
        {messages.length === 0 && !error ? (
          <p className="text-sm text-[#514b81] py-10 text-center">메일이 없습니다</p>
        ) : (
          <div className="divide-y divide-[#f0eefb]">
            {messages.map(m => (
              <Link key={m.id} href={`/mail/${m.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#fafafa] transition-colors">
                <div className={`size-2 rounded-full shrink-0 ${m.unread ? 'bg-[#7b68ee]' : 'bg-transparent'}`} />
                <div className="w-48 shrink-0 truncate">
                  <span className={`text-sm ${m.unread ? 'font-semibold text-[#090c1d]' : 'text-[#514b81]'}`}>
                    {m.from.replace(/<.*>/, '').trim() || m.from}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm ${m.unread ? 'font-semibold text-[#090c1d]' : 'text-[#292d34]'}`}>{m.subject}</span>
                  <span className="text-xs text-[#b0acd6] ml-2 truncate">{m.snippet}</span>
                </div>
                {m.hasAttachment && <Paperclip className="size-3.5 text-[#b0acd6] shrink-0" />}
                <span className="text-xs text-[#514b81] shrink-0 w-24 text-right">
                  {m.date ? m.date.slice(0, 10) : ''}
                </span>
                <ChevronRight className="size-3.5 text-[#b0acd6] shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {nextPageToken && (
        <div className="flex justify-center">
          <Link href={pageUrl(nextPageToken)}
            className="h-9 px-4 rounded-lg border border-[#d0ccf5] text-sm text-[#7b68ee] hover:bg-[#f5f4ff] transition-colors inline-flex items-center">
            다음 페이지
          </Link>
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <Mail className="size-6 text-[#7b68ee]" />
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">회사 메일</h1>
        <p className="text-sm text-[#514b81] mt-0.5">sjfirekorea@gmail.com — 조회·발송 (발송 이력에 작성 직원 기록)</p>
      </div>
    </div>
  )
}
