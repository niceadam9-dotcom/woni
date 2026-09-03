/** 39 — 3층 보류 가드의 **실패 방향**과 축 일치 회귀 가드 (2026-09-03 독립 판정 후속).
 *
 *  왜 필요한가: 이 가드는 틀려도 화면이 붉어지지 않는다. 조회가 실패하면 '응답 0건'으로 보여
 *  전 항목이 무응답이 되고, 완료가 조용히 전건 차단된다(판정자 실측: required 57 → 195).
 *  반대로 카탈로그가 죽으면 가드가 조용히 해제된다. 둘 다 **로그도 경보도 없다** —
 *  그래서 주입 실패로만 잡을 수 있다.
 *
 *  [A] 실패 방향: 응답 조회 실패·설비 조회 실패 모두 보수적(통과 쪽)으로 떨어지는가
 *      — 대조군(정상 경로가 required>0)을 **먼저** 세워 공허 통과를 막는다
 *  [B] 축 일치: countInstalledRequiredBlanks(보류 판정) == 화면 카운터(buildSheetOverviews 설치 시트)
 *      — 갈라지면 "화면은 N건 남았다는데 완료는 통과"가 된다
 *  [C] 문구 축: report9-assemble이 만드는 미비 문구와 annex-missing-list의 [고치기] 규칙이
 *      같은 접두를 보는가 — 한쪽만 바뀌면 딥링크가 조용히 사라진다
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-39-guards.mts */
import './_env.mjs'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { countInstalledRequiredBlanks, buildSheetOverviews } from '../src/lib/sheet-overview.ts'
import { getSheets, getAllSheetItems } from '../src/lib/sheet-catalog.ts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = client as never as Parameters<typeof countInstalledRequiredBlanks>[0]
const VIEWER = { id: '00000000-0000-0000-0000-000000000000', role: 'admin' as const }

// ── 선행 단언 — 카탈로그가 죽으면 아래 수치는 전부 0이고 전 검사가 공허 통과한다 ──
console.log('[0] 카탈로그 생존')
const [cat, catItems] = await Promise.all([getSheets(), getAllSheetItems()])
ok('점검표 카탈로그가 살아 있다', cat.length > 0 && catItems.length > 0, `시트 ${cat.length} / 항목 ${catItems.length}`)
if (cat.length === 0 || catItems.length === 0) {
  console.log('\n결과: 카탈로그 없음 — 이후 검사는 무의미하므로 중단'); process.exit(1)
}

// ── [B] 축 일치 (대조군 확보를 겸한다 — required>0인 표본을 여기서 고른다) ──────
console.log('\n[B] 보류 판정 축 == 화면 카운터 축')
const { data: allRaw } = await client.from('inspections').select('id, plan_type, status')
const selfIds = ((allRaw ?? []) as Array<{ id: string; plan_type: string | null; status: string }>)
  .filter(r => !r.plan_type || r.plan_type.startsWith('special')).map(r => r.id)
// 표본이 없으면 아래 mismatch===0은 공허 통과다 — 분모를 먼저 단언한다(빈 집합의 전칭명제 금지)
ok('대조 표본 — 자체점검 회차가 존재한다', selfIds.length > 0, `${selfIds.length}건`)
const { overviews } = await buildSheetOverviews(admin, selfIds, VIEWER)
let mismatch = 0, sampleWithReq = ''
for (const id of selfIds) {
  const c = await countInstalledRequiredBlanks(admin, id)
  const inst = (overviews[id]?.sheets ?? []).filter(s => s.installed)
  const uiReq = inst.reduce((a, s) => a + (s.total - s.responded), 0)
  const uiComp = inst.reduce((a, s) => a + s.compBlank, 0)
  if (c.required !== uiReq || c.comp !== uiComp) {
    mismatch++
    console.log(`     AXIS-MISMATCH ${id} count=${c.required}/${c.comp} ui=${uiReq}/${uiComp}`)
  }
  if (!sampleWithReq && c.required > 0) sampleWithReq = id
}
ok('자체점검 전수에서 두 축이 일치한다', mismatch === 0, `자체점검 ${selfIds.length}건 · 불일치 ${mismatch}`)

// ── [A] 실패 방향 — 주입 ────────────────────────────────────────────────────
console.log('\n[A] 조회 실패 시 보수적으로 떨어지는가')
if (!sampleWithReq) {
  // 표본이 없으면 [A]는 "0 == 0"이라 항진명제다 — 통과시키지 않고 드러낸다
  ok('대조군(필수 미입력이 남은 점검)이 존재한다', false,
    '미입력 보유 점검이 0건이라 실패 방향을 측정할 수 없다(공허 통과 방지로 실패 처리)')
} else {
  const base = await countInstalledRequiredBlanks(admin, sampleWithReq)
  ok('대조군 — 정상 경로가 required>0을 준다', base.required > 0, `required=${base.required}`)

  // 응답 조회만 실패시킨다(나머지 표는 진짜 client로 통과)
  const failResp = {
    from(table: string) {
      if (table !== 'inspection_sheet_responses') return client.from(table as never)
      const q: Record<string, unknown> = {}
      q.select = () => q; q.eq = () => q
      q.range = () => Promise.resolve({ data: null, error: { message: 'INJECTED response failure' } })
      return q as never
    },
  } as never as typeof admin
  const injR = await countInstalledRequiredBlanks(failResp, sampleWithReq)
  ok('응답 조회 실패 → 과잉 차단하지 않는다(0=통과)', injR.required === 0 && injR.comp === 0,
    `normal=${base.required} injected=${injR.required}`)

  const failFac = {
    from(table: string) {
      if (table !== 'fire_facilities') return client.from(table as never)
      const q: Record<string, unknown> = {}
      q.select = () => q; q.in = () => q
      q.eq = () => Promise.resolve({ data: null, error: { message: 'INJECTED facility failure' } })
      return q as never
    },
  } as never as typeof admin
  const injF = await countInstalledRequiredBlanks(failFac, sampleWithReq)
  ok('설비 조회 실패 → 과잉 차단하지 않는다(0=통과)', injF.required === 0, `injected=${injF.required}`)
}

// ── [C] 문구 축 — 조립 문구와 [고치기] 규칙이 같은 접두를 본다 ────────────────
console.log('\n[C] 미비 문구 ↔ [고치기] 딥링크 규칙')
// 미비 문구는 두 파일이 만든다 — 한쪽만 스캔하면 삼킴 검사의 분모가 반쪽이 된다
const asm = readFileSync('src/lib/report9-assemble.ts', 'utf8')
  + '\n' + readFileSync('src/app/(dashboard)/inspections/report9-actions.ts', 'utf8')
const fixSrc = readFileSync('src/components/inspections/annex-missing-list.tsx', 'utf8')
const asmLine = asm.match(/`점검표 항목 미입력 \$\{reqBlank\}건\(설치 설비/)
ok('조립이 39 미비 문구를 만든다', !!asmLine)
const rule = fixSrc.match(/\{\s*match:\s*'점검표 항목 미입력'\s*,\s*axis:\s*'inspection'/)
ok('[고치기] 규칙이 그 접두를 잡는다', !!rule)
// 부분일치가 이웃(1.4 대장 축)을 삼키지 않는지 — 조립의 다른 문구에 이 접두가 없어야 한다
const others = [...asm.matchAll(/missing\.push\(\s*`?([^`'"\n]*)/g)].map(m => m[1])
  .filter(s => s.includes('점검표 항목 미입력'))
ok('이 접두를 쓰는 미비 문구는 하나뿐이다(이웃 삼킴 없음)', others.length <= 1, `${others.length}건`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
