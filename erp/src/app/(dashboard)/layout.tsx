import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8f9fa]">
      <Sidebar role={profile.role} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header profile={profile} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
