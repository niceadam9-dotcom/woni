import { redirect } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MessagesClient } from '@/components/my/messages-client'

export default async function MessagesPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const admin = createAdminClient()

  const [inboxRes, sentRes, employeesRes] = await Promise.all([
    supabase
      .from('messages')
      .select(`
        id, subject, body, is_read, read_at, created_at,
        sender:sender_id ( id, name, position, department_id )
      `)
      .eq('recipient_id', profile.id)
      .eq('is_deleted_by_recipient', false)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('messages')
      .select(`
        id, subject, body, is_read, read_at, created_at,
        recipient:recipient_id ( id, name, position, department_id )
      `)
      .eq('sender_id', profile.id)
      .eq('is_deleted_by_sender', false)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('profiles')
      .select('id, name, position, department_id')
      .eq('is_active', true)
      .neq('id', profile.id)
      .order('name'),
  ])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <MessageSquare className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">쪽지함</h1>
      </div>

      <MessagesClient
        inbox={(inboxRes.data ?? []) as Record<string, unknown>[]}
        sent={(sentRes.data ?? []) as Record<string, unknown>[]}
        employees={(employeesRes.data ?? []) as Record<string, unknown>[]}
        myId={profile.id}
        myName={profile.name}
      />
    </div>
  )
}
