// test-archive-cleanup.mts가 중단됐을 때 남는 시드(계정·고객·파일) 회수 — 스테이징 전용.
// 실행: npx tsx scripts/_cleanup-archive-e2e-orphan.mts
// @ts-expect-error mjs 헬퍼
import { raw, delUser, cleanupCustomer } from './_e2e-helpers.mjs'

const EMAIL = 'archive-cleanup-e2e@erp-test.com'
const NAME = '과거본정리E2E고객'

const { data: cs } = await raw.from('customers').select('id').eq('customer_name', NAME)
for (const c of (cs ?? []) as Array<{ id: string }>) {
  // storage 하위 전부 — 고객 루트/연도/inspections 폴더
  const paths: string[] = []
  const walk = async (prefix: string) => {
    const { data } = await raw.storage.from('fire-plans').list(prefix, { limit: 1000 })
    for (const o of data ?? []) {
      if (o.id === null) await walk(`${prefix}/${o.name}`)
      else paths.push(`${prefix}/${o.name}`)
    }
  }
  await walk(c.id)
  if (paths.length > 0) await raw.storage.from('fire-plans').remove(paths)
  await raw.from('fire_plan_revisions').delete().eq('customer_id', c.id)
  await raw.from('fire_plans').delete().eq('customer_id', c.id)
  await cleanupCustomer(c.id)
  console.log(`정리: 고객 ${c.id} (파일 ${paths.length}개)`)
}

const { data } = await raw.auth.admin.listUsers({ page: 1, perPage: 1000 })
const u = (data?.users ?? []).find((x: { email?: string }) => x.email === EMAIL)
if (u) { await delUser(u.id); console.log(`정리: 계정 ${u.id}`) }
else console.log('잔여 계정 없음')
