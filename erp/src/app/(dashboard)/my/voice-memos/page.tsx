import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { VoiceMemosClient } from '@/components/my/voice-memos-client'

export default async function VoiceMemosPage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return <VoiceMemosClient userId={profile.id} />
}
