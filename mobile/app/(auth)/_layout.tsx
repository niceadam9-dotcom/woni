import { useEffect } from 'react'
import { Stack, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'

export default function AuthLayout() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/(app)')
    })
  }, [router])

  return (
    <Stack screenOptions={{ headerShown: false }} />
  )
}
