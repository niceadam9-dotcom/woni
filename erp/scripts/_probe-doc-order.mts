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

const { GENERATED_DOC_ORDER, GENERATED_DOC_KINDS, generatedDocRank } =
  reqMod as unknown as typeof import('../src/lib/doc-requirements.ts')
const { groupFiles } = docsMod as unknown as typeof import('../src/lib/generated-docs.ts')

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

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
