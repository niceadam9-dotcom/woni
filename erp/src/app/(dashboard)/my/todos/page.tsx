import { redirect } from 'next/navigation'
import { CheckSquare } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TodosClient } from '@/components/my/todos-client'

export default async function TodosPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()

  const { data: todos } = await supabase
    .from('todos')
    .select('id, title, description, due_date, priority, completed, completed_at, created_at')
    .order('completed')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CheckSquare className="size-5 text-[#7b68ee]" />
        <h1 className="text-xl font-bold">ToDo 목록</h1>
      </div>

      <TodosClient
        initialTodos={(todos ?? []) as Record<string, unknown>[]}
        today={new Date().toISOString().split('T')[0]}
      />
    </div>
  )
}
