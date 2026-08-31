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
  // timeline(제출일) 1 + sheet(saveSheetResponses) 1 + defect(조치저장) 1 = 3
  //
  // ⚠ 이 수를 올릴 때는 **왜 그 자리가 안전한지**를 함께 적어야 한다. 가드는
  //    "이 액션이 바꾼 것을 클라이언트가 스스로 책임진다"는 주장이고, 그 주장은 검사로
  //    뒷받침돼야 한다(F-1). 각 자리의 근거:
  //      · timeline 제출일  → justSubmitted 선반영
  //      · sheet 응답저장   → 소방계획서_28의 자동저장 경로가 화면을 책임진다
  //      · defect 조치저장  → S3-5 집계 미러 + F-21 부모 편집분,
  //                          그리고 그 둘을 test-workbench-defect-pane-switch.mts(7/0)가 지킨다
  check('가드 경로(alsoChanged 생략)는 정확히 3곳', guarded === 3,
    `${guarded}곳 — 늘었다면 F-1 위반 가능(단계 외 서버 prop이 안 갱신된다)`)
}

// ── S2-2 수용 기준 ⓐ — '참일 때만 2회, 거짓이면 0회'를 **규칙 단위로 단언**한다.
//    독립 판정이 "정적 검사는 호출 형태만 본다"고 지적한 공백을 여기서 닫는다.
//    규칙은 next/cache를 안 끌어들이는 순수 모듈이라 서버 없이 부를 수 있다.
console.log('\n— S2-2 수용 기준 ⓐ (revalidate 결정 규칙)')
{
  const { shouldRevalidate, stepsChangedFrom } = await import('../src/lib/step-revalidate-rule.ts')

  // 가드 경로(alsoChanged 생략): 단계가 안 바뀌면 **한 번도 안 부른다**
  check('단계 무변경 + 가드 → 무효화 안 함', shouldRevalidate(false, undefined) === false)
  check('단계 변경 + 가드 → 무효화 함', shouldRevalidate(true, undefined) === true)
  // alsoChanged 경로: 종전 무조건 동작과 **동일**해야 한다(등가성이 S2-2의 핵심)
  check('단계 무변경 + alsoChanged → 무효화 함(종전 동작 등가)', shouldRevalidate(false, true) === true)
  check('단계 변경 + alsoChanged → 무효화 함', shouldRevalidate(true, true) === true)
  check('alsoChanged:false는 생략과 같다', shouldRevalidate(false, false) === false)

  // stepsChanged 판정: 행이 바뀌었거나 점검이 방금 완료됐으면 참
  check('changed>0 → stepsChanged', stepsChangedFrom({ changed: 1 }) === true)
  check('changed=0 → stepsChanged 아님', stepsChangedFrom({ changed: 0 }) === false)
  check('changed=0이어도 justCompleted면 참', stepsChangedFrom({ changed: 0, justCompleted: true }) === true)

  // 헬퍼가 그 규칙을 **실제로** 쓰는가 — 규칙만 맞고 배선이 끊기면 의미가 없다
  const helper = read('step-revalidate.ts')
  check('헬퍼가 shouldRevalidate를 경유한다',
    /if \(shouldRevalidate\(stepsChanged, opts\.alsoChanged\)\) revalidateInspection\(/.test(helper))
  check('헬퍼가 stepsChangedFrom을 경유한다', /stepsChangedFrom\(sync\)/.test(helper))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
