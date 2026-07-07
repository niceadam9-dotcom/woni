import { redirect } from 'next/navigation'
import { getProfile } from '@/lib/auth'
import { SignatureClient } from '@/components/my/signature-client'

export default async function SignaturePage() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  return <SignatureClient userId={profile.id} userName={profile.name} />
}
