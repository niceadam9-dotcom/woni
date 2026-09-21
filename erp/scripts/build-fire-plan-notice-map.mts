/** 생성기 — 「시트 번호 → 화면 노드」 표를 대장에서 뽑아 `src/lib/fire-plan-notice-map.ts`로 쓴다.
 *
 *  왜 생성하나: 매핑의 원천은 `FIRE_PLAN_SECTIONS`(대장) + manifest의 `no`인데, **manifest는
 *  146KB 서버 전용 모듈**이다(클라이언트 번들로 새던 것을 일부러 떼어 냈다). 고지 칩은 브라우저에서
 *  그려야 하므로 manifest를 import할 수 없다 — 그래서 44줄짜리 표만 뽑아 둔다.
 *  드리프트는 `test-fire-plan-notice.mts`가 대장과 대조해 막는다(손으로 고치지 말 것).
 *
 *  실행: npx tsx --conditions=react-server scripts/build-fire-plan-notice-map.mts
 */
import { writeFileSync } from 'node:fs'
import { FIRE_PLAN_SECTIONS } from '../src/lib/fire-plan-sections.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

/** 대장이 말하는 진실 — 생성기와 검사가 **같은 함수**를 본다(검사가 사본을 만들면 드리프트를 못 잡는다) */
export function deriveNoToForm(): Map<string, string> {
  const byName = new Map((FIRE_PLAN_MANIFEST as unknown as { sheets: { name: string; no?: string | null }[] })
    .sheets.map(s => [s.name, s]))
  const multi = new Map<string, Set<string>>()
  for (const d of FIRE_PLAN_SECTIONS) {
    const no = byName.get(d.sheet)?.no
    if (!no) continue
    const key = String(no)
    if (!multi.has(key)) multi.set(key, new Set())
    multi.get(key)!.add(d.form)
  }
  // 🚨 한 번호가 두 노드로 갈리면 **버린다**(지어내지 않는다). 지금은 0건이지만 대장이 바뀌면 생길 수 있다.
  const out = new Map<string, string>()
  for (const [no, forms] of multi) if (forms.size === 1) out.set(no, [...forms][0])
  return out
}

const HEADER = [
  '/** 시트 번호 → 화면 노드 — **자동 생성**. 손으로 고치지 말 것.',
  ' *  생성: npx tsx --conditions=react-server scripts/build-fire-plan-notice-map.mts',
  ' *  원천: FIRE_PLAN_SECTIONS(대장) + fire-plan-xlsx-manifest의 no.',
  ' *  ⚠ manifest는 146KB **서버 전용**이라 클라이언트가 직접 읽을 수 없어 표만 뽑아 둔다.',
  ' *    대장과 어긋나면 test-fire-plan-notice가 빨강이 된다.',
  ' *',
  ' *  🚨 **접두를 잘라 추측하면 안 된다**: 1.15는 1.1이 아니라 1.12 노드다',
  ' *    (1.12 노드 하나가 1.12.1·1.13·1.14.1·1.14.2·1.15 다섯 장을 담당한다).',
  ' */',
  "import type { FirePlanFormKey } from '@/lib/fire-plan-sections'",
  '',
  'export const SHEET_NO_TO_FORM: Readonly<Record<string, FirePlanFormKey>> = {',
].join('\n')

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('build-fire-plan-notice-map.mts')) {
  const rows = [...deriveNoToForm()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  const body = rows.map(([no, form]) => "  '" + no + "': '" + form + "',").join('\n')
  writeFileSync('src/lib/fire-plan-notice-map.ts', HEADER + '\n' + body + '\n}\n', 'utf8')
  console.log('✅ src/lib/fire-plan-notice-map.ts — ' + rows.length + '개 번호')
}
