/** 절↔시트 대장 **적재 시점 검증** — `fire-plan-sections.ts`가 manifest와 어긋나지 않는가.
 *
 *  🚨 **왜 대장 파일에서 떼어 냈나.** 검증이 manifest를 물고, 대장은 `plan-tab-view`(클라이언트
 *    컴포넌트)가 쓴다. 한 파일에 두었더니 **146KB짜리 manifest JSON이 클라이언트 번들로 딸려가
 *    청크가 416KB가 됐다** — 대장 파일 주석에 「그 선을 넘지 않는다」고 적어 놓고 내가 넘었다.
 *    쪼개면 목차 데이터만 브라우저로 가고 manifest는 서버에 남는다.
 *
 *  ⚠ 그래서 이 모듈은 **서버에서 누가 부르든 한 번은 돌아야** 한다. 워크북 축을 건드리는
 *    `fire-plan-blanks`가 import하므로, 엑셀·빈칸 보고 경로는 반드시 이 검증을 지난다.
 *    검사(`test-fire-plan-sections.mts`)도 여기를 import해 같은 사실을 밖에서 다시 묻는다.
 */
import 'server-only'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '@/lib/fire-plan-xlsx-manifest'
import { FIRE_PLAN_SECTIONS, FIRE_PLAN_FORM_KEYS } from '@/lib/fire-plan-sections'

/** 틀리면 **여기서** 터진다 — `labelAt`이 좌표가 밀리면 적재 중 throw 하는 것과 같은 규약이다.
 *  대장이 조용히 어긋난 채 화면만 멀쩡해 보이는 상태를 만들지 않는다. */
export function verifyFirePlanSections(): void {
  const n = FIRE_PLAN_SECTIONS.length
  const total = FIRE_PLAN_MANIFEST.sheets.length

  // ① 개수 — 대장과 manifest가 같은 워크북을 보고 있는가
  if (n !== total) {
    throw new Error(`fire-plan 대장: 항목 ${n}개인데 manifest 시트는 ${total}장이다`)
  }

  // ② 실재 — 오타 난 시트명은 sheetManifest가 「있는 것」 목록과 함께 터뜨린다
  for (const d of FIRE_PLAN_SECTIONS) sheetManifest(d.sheet)

  // ③ 중복
  const seen = new Set<string>()
  for (const d of FIRE_PLAN_SECTIONS) {
    if (seen.has(d.sheet)) throw new Error(`fire-plan 대장: 시트 '${d.sheet}'가 두 번 실렸다`)
    seen.add(d.sheet)
  }

  // ④ 노드 키가 목차에 있는가
  const keys = new Set<string>(FIRE_PLAN_FORM_KEYS)
  for (const d of FIRE_PLAN_SECTIONS) {
    if (!keys.has(d.form)) throw new Error(`fire-plan 대장: '${d.sheet}'의 노드 '${d.form}'가 목차에 없다`)
  }

  // ⑤ **역방향** — 대장에 없는 manifest 시트.
  //   🚨 ①+③이면 수학적으로 자동이지만 **메시지가 다르다**. ①만 두면 「50이 아니라 49」라는
  //     숫자만 나오고 *어느 장이 빠졌는지* 아무도 모른다. 사람이 읽을 수 있어야 가드가 일한다.
  const missing = FIRE_PLAN_MANIFEST.sheets.filter(s => !seen.has(s.name)).map(s => s.name)
  if (missing.length > 0) {
    throw new Error(`fire-plan 대장: manifest에 있는데 대장에 없는 시트 — ${missing.join(' · ')}`)
  }

  // ⑥ 면제에 이름을 강제한다 — 사유 없는 봐주기는 다음 사람이 이유를 못 묻는다
  for (const d of FIRE_PLAN_SECTIONS) {
    if (d.exempt !== undefined && d.exempt.trim() === '') {
      throw new Error(`fire-plan 대장: '${d.sheet}'의 exempt에 사유가 없다`)
    }
  }

  // ⑦ 한 카드가 **두 노드**에 매달리면 안 된다.
  //   🚨 `formOfCard`는 Map이라 조용히 **마지막 것만** 답한다 — 딥링크가 뜻대로 안 가는데
  //     아무 데서도 안 터진다. 같은 카드를 여러 시트가 공유하는 것은 정상이지만(1.14.1·1.14.2가
  //     `c-1.14` 한 장을 쓴다) **노드가 갈리는 것**은 결함이다.
  const cardForm = new Map<string, string>()
  for (const d of FIRE_PLAN_SECTIONS) {
    if (!d.card) continue
    const prev = cardForm.get(d.card)
    if (prev !== undefined && prev !== d.form) {
      throw new Error(`fire-plan 대장: 카드 '${d.card}'가 두 노드에 걸려 있다 — ${prev} vs ${d.form}`)
    }
    cardForm.set(d.card, d.form)
  }
}

// 적재 시점에 즉시 검증한다 — 이 모듈을 import한 서버 경로는 반드시 이 관문을 지난다
verifyFirePlanSections()
