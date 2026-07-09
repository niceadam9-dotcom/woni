import { SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './_env.mjs'
const SEC = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
const PUB = { apikey: ANON_KEY }
let r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=email&limit=2`, { headers: SEC })
console.log('secret REST:', r.status, r.ok ? (await r.json()).length + ' rows' : await r.text())
r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, { headers: SEC })
console.log('secret auth admin:', r.status)
r = await fetch(`${SUPABASE_URL}/rest/v1/holidays?select=date&limit=1`, { headers: PUB })
console.log('publishable REST:', r.status)
