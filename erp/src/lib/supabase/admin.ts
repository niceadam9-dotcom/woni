import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service role — bypasses RLS. 서버 전용 (API Route, Server Action).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
