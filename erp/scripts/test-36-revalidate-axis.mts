// 소방계획서_36 S2-7 — revalidate 축 중앙집중 정적 검사
//
// 서버·DB 없이 **소스만** 읽는다 — pre-push(무서버 게이트)에 얹을 수 있어야 하므로
// _e2e-helpers.mjs(supabase 클라이언트를 모듈 로드 시 만든다)를 일부러 쓰지 않는다.
//
// 실행: npx tsx scripts/test-36-revalidate-axis.mts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src', 'app', '(dashboard)', 'inspections')
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

let pass = 0, fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const RE_REVAL = /revalidatePath\(/g
const RE_SYNC = /syncInspectionSteps\(/g

console.log('— 소방계획서_36 S2-7 revalidate 축')

// ── 전환 완료 파일: 직접 호출이 0이어야 한다
for (const f of ['timeline-actions.ts', 'defect-actions.ts']) {
  const src = read(f)
  check(`${f} — revalidatePath 직접 호출 0회`, count(src, RE_REVAL) === 0, `${count(src, RE_REVAL)}회`)
  check(`${f} — syncInspectionSteps 직접 호출 0회`, count(src, RE_SYNC) === 0, `${count(src, RE_SYNC)}회`)
  check(`${f} — 헬퍼를 import한다`, /from '\.\/step-revalidate'/.test(src))
}

// ── 헬퍼: 두 경로(상세·목록)를 정확히 한 쌍만 가진다
{
  const src = read('step-revalidate.ts')
  check('step-revalidate.ts — revalidatePath 정확히 2회(상세·목록)', count(src, RE_REVAL) === 2, `${count(src, RE_REVAL)}회`)
  check('step-revalidate.ts — 상세 경로', /revalidatePath\(`\/inspections\/\$\{inspectionId\}`\)/.test(src))
  check('step-revalidate.ts — 목록 경로', /revalidatePath\('\/inspections'\)/.test(src))
  // D-2 — 여기 'use server'가 붙으면 export가 전부 공개 엔드포인트가 된다(소방계획서_18 교훈)
  check("step-revalidate.ts — 'use server' 없음 (D-2)", !/^\s*['"]use server['"]/m.test(src))
}

// ── sheet-actions.ts — **의도적 부분 전환**. 남은 수를 고정해 새 자리가 늘면 잡는다.
//    S2-2가 지정한 saveSheetResponses(가드 경로) 한 곳만 옮겼다. 나머지는 소방계획서_28의
//    드로어·전용 입력 페이지 축이라 D-8 범위 밖 — 늘어나는 것만 막고 줄이는 건 후속에 맡긴다.
{
  const src = read('sheet-actions.ts')
  const r = count(src, RE_REVAL), s = count(src, RE_SYNC)
  check('sheet-actions.ts — 미전환 revalidatePath가 12를 넘지 않는다', r <= 12, `${r}회`)
  check('sheet-actions.ts — 미전환 syncInspectionSteps가 6을 넘지 않는다', s <= 6, `${s}회`)
  check('sheet-actions.ts — 기준 경로(saveSheetResponses)는 헬퍼를 쓴다',
    /const \{ stepsChanged \} = await syncStepsAndRevalidate\(admin, inspectionId, profile\.id\)/.test(src))
}

// ── F-1 회귀 방지: 헬퍼를 쓰면서 alsoChanged를 **빠뜨린** 자리는 단 하나여야 한다.
//    (제출일 기록 = justSubmitted 선반영이 있는 유일한 순수 후보)
{
  const files = ['timeline-actions.ts', 'defect-actions.ts', 'sheet-actions.ts']
  let guarded = 0
  for (const f of files) {
    for (const m of read(f).matchAll(/syncStepsAndRevalidate\([^)]*\)/g)) {
      if (!m[0].includes('alsoChanged')) guarded++
    }
  }
  // timeline(제출일) 1 + sheet(saveSheetResponses) 1 = 2
  check('가드 경로(alsoChanged 생략)는 정확히 2곳', guarded === 2,
    `${guarded}곳 — 늘었다면 F-1 위반 가능(단계 외 서버 prop이 안 갱신된다)`)
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
