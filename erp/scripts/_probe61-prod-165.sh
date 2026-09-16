#!/usr/bin/env bash
# 읽기 전용 — 운영 DB에 마이그 165 컬럼이 있는지, 백필 대상이 몇 건인지 본다.
set -u
sudo docker exec erp-app-1 node -e '
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
console.log("PROD_REF=" + String(url).replace(/https:\/\/([^.]+).*/, "$1"))
const q = async (path) => {
  const r = await fetch(url + "/rest/v1/" + path, { headers: { apikey: key, Authorization: "Bearer " + key, Prefer: "count=exact" } })
  return { status: r.status, count: r.headers.get("content-range"), body: (await r.text()).slice(0, 200) }
}
;(async () => {
  const a = await q("buildings?select=id,stair_direct_count,stair_escape_count,stair_special_count,stair_outdoor_count&limit=1")
  console.log("165 컬럼:", a.status === 200 ? "있음(적용됨)" : "없음/오류 " + a.status + " " + a.body)
  const b = await q("buildings?select=id&limit=1")
  console.log("buildings 총건:", b.count)
  const c = await q("buildings?select=id&stairs_count=not.is.null&limit=1")
  console.log("stairs_count 있는 건물:", c.count)
  const d = await q("fire_plan_forms?select=customer_id&limit=1")
  console.log("fire_plan_forms 총건:", d.count)
})()
'
