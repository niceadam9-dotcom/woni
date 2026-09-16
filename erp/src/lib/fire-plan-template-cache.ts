/** 소방계획서 워크북 템플릿 — **프로세스당 1회** 적재 + 앵커 검증 결과 캐시.
 *
 *  템플릿은 `scripts/build-fire-plan-template.mts`가 만드는 **빌드 산출물**이다. 요청마다
 *  바뀌지 않는다. 그런데 지금까지 라우트는 요청마다 1.66MB를 읽고 `validateAnchors`를
 *  **두 번**(값 앵커·사진 상자) 돌렸다. 실측(`_probe-template-cache-perf.mts`):
 *
 *      readFile 1.7ms · validateAnchors(값) 155.9ms · validateAnchors(사진) 160.7ms
 *      ── 요청마다 **318ms**. 캐시 뒤 2회차부터 0ms.
 *
 *  ⭐ 사진 상자는 앵커가 **5개뿐인데 160ms**다 — 비용이 앵커 수가 아니라 `XLSX.read`의
 *    **워크북 전체 재파싱**에서 온다는 뜻이다. 그래서 앵커 목록을 줄이는 최적화는 소용이 없고,
 *    파싱 자체를 한 번만 하는 것이 유일한 답이다.
 *
 *  ⭐ 이 모듈이 있어야 하는 더 큰 이유는 성능이 아니라 **한 벌**이다. 곧 서식 미리보기가 같은
 *    템플릿과 같은 앵커를 봐야 하는데, 각자 읽으면 「엑셀엔 들어갔는데 미리보기엔 없다」가
 *    생긴다. 라우트·미리보기·계측기가 **같은 것을 먹는다**.
 *
 *  ⚠ `bytes`를 **공유**한다. 안전한 이유는 `injectWorkbook`이 원본을 변형하지 않기 때문이고
 *    (`xlsx-inject.ts:210`의 명시), 그 약속이 지켜지는지는 `test-fire-plan-preview.mts`가
 *    주입 전후 해시로 실증한다 — 주석을 믿지 않는다.
 *
 *  🚨 검증 **실패도 캐시한다**. 템플릿이 정적이라 실패도 정적이기 때문이다. 그리고 실패를
 *    throw로 바꾸지 않는다 — 라우트가 실패 목록을 사용자 고지에 싣고 있어서, 던지면 그 detail이
 *    사라지고 응답이 밋밋한 500으로 퇴화한다. **판정은 여기서, 처리는 부르는 쪽에서.**
 */
import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { validateAnchors, type AnchorCheck } from '@/lib/xlsx-anchors'
import { FIRE_PLAN_ANCHORS, FIRE_PLAN_IMAGE_ANCHORS } from '@/lib/fire-plan-anchors'

const TEMPLATE = path.join(process.cwd(), 'templates', 'fire-plan-workbook.xlsx')

export type FirePlanTemplate = {
  /** 템플릿 원본 바이트 — **읽기 전용으로 다룰 것**(부르는 쪽이 변형하면 다음 요청이 오염된다) */
  bytes: Uint8Array
  /** 값 앵커 검증 결과(자가치유 반영) */
  value: AnchorCheck
  /** 사진 상자 좌표 검증 결과 — 값 앵커와 **따로** 본다(§사진상자: 그림엔 값이 없다) */
  image: AnchorCheck
}

let memo: Promise<FirePlanTemplate> | null = null

async function load(): Promise<FirePlanTemplate> {
  const bytes = new Uint8Array(await readFile(TEMPLATE))
  return {
    bytes,
    value: validateAnchors(bytes, FIRE_PLAN_ANCHORS),
    image: validateAnchors(bytes, FIRE_PLAN_IMAGE_ANCHORS),
  }
}

/** 캐시된 템플릿 + 앵커 검증 결과.
 *
 *  ⚠ 적재 자체가 실패하면(파일 없음 등) memo를 비워 **다음 호출이 다시 시도**하게 한다.
 *    실패한 Promise를 물고 있으면 일시적 I/O 오류가 프로세스 수명 내내 영구 장애가 된다.
 *    반면 **앵커 검증 실패는 캐시한다** — 그건 일시적이지 않고 템플릿 자체의 성질이다. */
export function firePlanTemplate(): Promise<FirePlanTemplate> {
  if (!memo) {
    memo = load().catch(e => { memo = null; throw e })
  }
  return memo
}

/** 검사 전용 — 캐시를 비운다. 제품 경로에서 부르지 않는다. */
export function __resetFirePlanTemplateCache(): void {
  memo = null
}
