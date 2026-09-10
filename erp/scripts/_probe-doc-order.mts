/** 생성물 목록 조회 순서 검증 (2026-08-20) — 순수 함수 단언(DB·브라우저 불필요)
 *  실행: npx tsx --conditions=react-server scripts/_probe-doc-order.mts
 *
 *  요구: 소방계획서·위임장이 이행계획서(10호) **위에** 조회된다.
 *  종전 결함: `kind_stamp` 문자열 하나로 정렬해 종류가 알파벳 역순으로 섞였다
 *            (report9 → report4 → report11 → report10 → official → fire_plan → exterior → delegation → cover).
 *            주석은 "최신 우선"이라 적혀 있어 코드를 읽어도 눈치채기 어려웠다. */
import fs from 'node:fs'
import path from 'node:path'
import reqMod from '../src/lib/doc-requirements.ts'
import docsMod from '../src/lib/generated-docs.ts'

const { GENERATED_DOC_ORDER, GENERATED_DOC_KINDS, generatedDocRank, STEP_DOC_KINDS } =
  reqMod as unknown as typeof import('../src/lib/doc-requirements.ts')
const { groupFiles, filesOfKinds, kindOf, INSPECTION_DOC_FILE_RE, EXTERIOR_DOC_FILE_RE } =
  docsMod as unknown as typeof import('../src/lib/generated-docs.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const f = (name: string, createdAt = '2026-08-20T01:00:00Z') => ({ name, path: `p/${name}`, createdAt })
const kindsOf = (gs: Array<{ kind: string }>) => gs.map(g => g.kind)

console.log('— 요구: 소방계획서·위임장이 10호 위')
{
  // 일부러 종전 정렬이 틀리게 나오던 순서로 넣는다(입력 순서에 기대지 않음을 겸해 확인)
  const groups = groupFiles([
    f('report10_20260820090000.pdf'), f('delegation_20260820090000.pdf'),
    f('fire_plan_20260820090000.pdf'), f('report9_20260820090000.pdf'),
    f('report11_20260820090000.pdf'), f('official_20260820090000.pdf'),
    f('cover_20260820090000.pdf'), f('report4_20260820090000.pdf'),
    f('exterior_20260820090000.pdf'),
  ])
  const ks = kindsOf(groups)
  ok('소방계획서가 10호 위', ks.indexOf('fire_plan') < ks.indexOf('report10'), ks.join(' → '))
  ok('위임장이 10호 위', ks.indexOf('delegation') < ks.indexOf('report10'), ks.join(' → '))
  ok('전체 순서 = GENERATED_DOC_ORDER',
    ks.join(',') === GENERATED_DOC_ORDER.join(','), ks.join(' → '))
  ok('입력 순서와 무관', ks[0] === 'fire_plan', ks.join(' → '))
}

console.log('— 같은 종류 안에서는 최신 생성분이 먼저 (‘최신’ 배지가 이 정렬에 기댄다)')
{
  const groups = groupFiles([
    f('report9_20260101090000.pdf'), f('report9_20260820090000.pdf'), f('report9_20260501090000.pdf'),
    f('delegation_20260301090000.pdf'),
  ])
  const r9 = groups.filter(g => g.kind === 'report9').map(g => g.key)
  ok('report9 3건이 최신순', r9.join(',') === [
    'report9_20260820090000', 'report9_20260501090000', 'report9_20260101090000',
  ].join(','), r9.join(' → '))
  ok('그래도 위임장이 9호보다 위', kindsOf(groups).indexOf('delegation') < kindsOf(groups).indexOf('report9'),
    kindsOf(groups).join(' → '))
}

console.log('— 모르는 종류는 맨 뒤 (순서를 지어내지 않는다)')
{
  const groups = groupFiles([f('사진첨부.pdf'), f('report10_20260820090000.pdf'), f('mystery_20260820090000.pdf')])
  const ks = kindsOf(groups)
  ok('규칙 밖 파일과 미등록 종류가 뒤로', ks[0] === 'report10', ks.map(k => k || '(규칙밖)').join(' → '))
  ok('generatedDocRank — 미등록은 최대값', generatedDocRank('mystery') === GENERATED_DOC_ORDER.length)
  ok('generatedDocRank — 빈 문자열도 최대값', generatedDocRank('') === GENERATED_DOC_ORDER.length)
}

console.log('— 인쇄 번들 순서와 같은 축인가 (화면 차례 ≠ 인쇄 차례 방지)')
{
  const routeSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/app/(dashboard)/inspections/[id]/bundle/route.ts'), 'utf8')
  const m = routeSrc.match(/const TYPE_ORDER = \[([^\]]+)\]/)
  ok('bundle route에서 TYPE_ORDER를 읽었다', !!m, '배열을 못 찾았다 — 프로브를 고칠 것')
  if (m) {
    const bundle = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    const displayMinusPlan = GENERATED_DOC_ORDER.filter(k => k !== 'fire_plan')
    ok('번들 순서 = 조회 순서(소방계획서 제외)',
      bundle.join(',') === displayMinusPlan.join(','),
      `번들=[${bundle.join(',')}] / 조회=[${displayMinusPlan.join(',')}]`)
    ok('소방계획서는 번들 대상이 아니다(?types 화이트리스트 오염 방지)', !bundle.includes('fire_plan'))
  }
}

console.log('— 정의 누락 방지')
{
  const missing = GENERATED_DOC_ORDER.filter(k => !GENERATED_DOC_KINDS[k])
  ok('순서에 있는 종류는 전부 라벨이 있다', missing.length === 0, missing.join(','))
  const unordered = Object.keys(GENERATED_DOC_KINDS).filter(k => !GENERATED_DOC_ORDER.includes(k))
  ok('라벨이 있는 종류는 전부 순서에 있다(새 문서 추가 시 여기서 걸린다)',
    unordered.length === 0, unordered.join(','))
}

console.log('— 단계 창구 추림 (STEP_DOC_KINDS, 2026-09-10)')
{
  const all = [
    f('report4_20260910090000.pdf'), f('report9_20260910090000.pdf'),
    f('report10_20260910090000.pdf'), f('report11_20260910090000.pdf'),
    f('cover_20260910090000.pdf'), f('official_20260910090000.pdf'),
    f('delegation_20260910090000.pdf'),
  ]
  const kinds = (fs2: typeof all) => kindsOf(groupFiles(fs2))

  // 양성 — 각 단계가 자기 문서를 **보여준다**
  ok('① 점검표에 별지 4호가 있다', kinds(filesOfKinds(all, STEP_DOC_KINDS.checklist)).includes('report4'))
  ok('③ 관계인 보고에 별지 9호가 있다', kinds(filesOfKinds(all, STEP_DOC_KINDS.ownerReport)).includes('report9'))
  ok('⑥ 이행완료에 별지 11호가 있다', kinds(filesOfKinds(all, STEP_DOC_KINDS.submit11)).includes('report11'))

  // 음성 — 추림이 **실제로 걸러낸다**. 이 대조가 없으면 필터를 통째로 지워도 위 3건이 초록이다.
  const k1 = kinds(filesOfKinds(all, STEP_DOC_KINDS.checklist))
  ok('① 점검표에 9·10·11호가 없다', !k1.some(k => ['report9', 'report10', 'report11'].includes(k)), k1.join(' → '))
  ok('① 점검표에 표지·공문·위임장이 없다', !k1.some(k => ['cover', 'official', 'delegation'].includes(k)), k1.join(' → '))
  ok('⑥ 이행완료는 11호 한 종류뿐',
    kinds(filesOfKinds(all, STEP_DOC_KINDS.submit11)).join(',') === 'report11')

  // ④ = 사용자 확정 사항(2026-09-10): 앞장 3종은 대응 단계가 없어 여기 묶었다
  const k4 = kinds(filesOfKinds(all, STEP_DOC_KINDS.submit9))
  for (const need of ['official', 'cover', 'delegation', 'report9', 'report10', 'report4']) {
    ok(`④ 제출에 ${GENERATED_DOC_KINDS[need]?.label ?? need}`, k4.includes(need), k4.join(' → '))
  }
  ok('④ 추림 뒤에도 순서는 GENERATED_DOC_ORDER 그대로',
    k4.join(',') === GENERATED_DOC_ORDER.filter(k => k4.includes(k)).join(','), k4.join(' → '))

  // undefined(추림 안 함)와 []( 생성물 없는 단계)는 **다른 뜻**이다 — 빈 배열을 falsy로 보면
  // ②⑤가 다시 7종을 늘어놓는다. 이 한 줄이 그 실수를 고정한다.
  ok('kinds 생략 = 전부 (종전 동작)', filesOfKinds(all, undefined).length === all.length)
  ok('kinds 빈 배열 = 0건 (② 배치신고·⑤ 보수)', filesOfKinds(all, STEP_DOC_KINDS.cert).length === 0,
    `${filesOfKinds(all, STEP_DOC_KINDS.cert).length}건`)
  ok('⑤ 보수도 0건', filesOfKinds(all, STEP_DOC_KINDS.repair).length === 0)
}

console.log('— 고아 종류 0건 (추림이 만드는 새 실패 모드)')
{
  // 조회 필터(report9-actions)가 화면에 흘려보내는 종류 = 자체점검 7종 + 외관 1종.
  // 그 중 **어느 단계에도 없는 종류**가 생기면 그 문서는 만들어도 영영 안 보인다.
  const reaching = [...GENERATED_DOC_ORDER, 'exterior'].filter(k =>
    INSPECTION_DOC_FILE_RE.test(`${k}_20260910090000.pdf`) || EXTERIOR_DOC_FILE_RE.test(`${k}_20260910090000.pdf`))
  const assigned = new Set(Object.values(STEP_DOC_KINDS).flat())
  const orphans = reaching.filter(k => !assigned.has(k))
  ok('조회 필터가 통과시키는 종류는 전부 어느 단계엔가 배정돼 있다',
    orphans.length === 0, `고아=${orphans.join(',') || '없음'} / 도달=${reaching.join(',')}`)
  ok('도달 종류를 실제로 세었다(공허 통과 방지)', reaching.length >= 7, `${reaching.length}종`)

  // 반대 방향 — 배정표에 도달하지도 않는 종류를 적어 두면 그 줄은 죽은 글자다
  const unreachable = [...assigned].filter(k => !reaching.includes(k))
  ok('배정표에 도달 불가 종류가 없다', unreachable.length === 0, unreachable.join(','))
}

console.log('— kindOf 규약 (groupFiles와 한 벌)')
{
  ok('종류 접두어 추출', kindOf('report10_20260910090000.pdf') === 'report10')
  ok('밑줄 있는 종류도 온전히', kindOf('fire_plan_20260910090000.pdf') === 'fire_plan')
  ok('규약 밖 파일은 빈 문자열', kindOf('사진첨부.pdf') === '')
  ok('규약 밖 파일은 어떤 단계에도 안 걸린다',
    filesOfKinds([f('사진첨부.pdf')], STEP_DOC_KINDS.submit9).length === 0)
  ok('groupFiles와 같은 판정', groupFiles([f('report10_20260910090000.pdf')])[0].kind
    === kindOf('report10_20260910090000.pdf'))
}

console.log('— 배선 (순수 함수만 보면 호출부를 지워도 위가 전부 초록이다)')
{
  const src = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8')
  const wb = src('src/components/inspections/inspection-workbench.tsx')

  const calls = wb.match(/<DocPane\b[\s\S]*?\/>/g) ?? []
  ok('작업대에서 DocPane 호출부를 찾았다', calls.length > 0, `${calls.length}건 — 못 찾으면 프로브를 고칠 것`)
  const noKinds = calls.filter(c => !/\bkinds=\{/.test(c))
  ok('DocPane 호출부는 **전부** kinds를 넘긴다', noKinds.length === 0,
    `누락 ${noKinds.length}/${calls.length}건 — 빠진 탭은 다시 7종을 늘어놓는다`)

  // 어느 탭이 걸렸는지까지 고정한다 — 넷 중 하나가 통째로 사라져도 위 단언은 초록이다
  for (const step of ['checklist', 'ownerReport', 'submit9', 'submit11']) {
    ok(`STEP_DOC_KINDS.${step} 배선됨`, wb.includes(`STEP_DOC_KINDS.${step}`))
  }
  ok('DocPane이 추림 결과(shown)를 그린다', /filesOfKinds\(files, kinds\)/.test(wb) && /files=\{shown\}/.test(wb))

  /* 문서명 짜부라짐 — ⚠ **여기서 할 수 있는 건 필요조건까지다**.
     종전 이 자리에 `flex-1 min-w-0`이 붙었는지만 봤는데, 클래스가 다 붙은 채로도
     렌더 폭이 **0px**이었다(2026-09-10 실측: 칸 278px, 한 줄이 요구한 폭 314px).
     남는 폭이 없으면 flex-1의 몫도 0이라, 클래스 단언은 초록인데 화면은 한 글자였다.
     충분조건(실제 렌더 폭)은 test-exterior-ui가 doc-row-name을 **재서** 본다. */
  const list = src('src/components/inspections/generated-doc-list.tsx')
  ok('문서명에 E2E 앵커(doc-row-name)가 있다', list.includes('data-testid="doc-row-name"'),
    '이 앵커가 없으면 test-exterior-ui의 폭 실측이 조용히 못 찾는다')
  const rowFn = list.slice(list.indexOf('const row = '), list.indexOf('  return ('))
  ok('row 함수를 잘라냈다', rowFn.length > 200, `${rowFn.length}자`)
  const iName = rowFn.indexOf('doc-row-name'), iBtns = rowFn.indexOf('ml-auto')
  ok('문서명과 버튼 묶음을 둘 다 찾았다', iName >= 0 && iBtns > iName)
  // 핵심 — 이름이 버튼과 **같은 줄**로 돌아가면 다시 0px로 눌린다. 사이에 </div>가 있어야 다른 줄이다.
  ok('문서명과 버튼이 다른 줄에 있다 (한 줄로 되돌리면 다시 눌린다)',
    iName >= 0 && iBtns > iName && rowFn.slice(iName, iBtns).includes('</div>'))
  ok('문서명은 여전히 남는 폭을 차지한다 (flex-1 min-w-0 — 필요조건)',
    /doc-row-name[\s\S]{0,160}min-w-0[\s\S]{0,40}flex-1/.test(rowFn))
}

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
