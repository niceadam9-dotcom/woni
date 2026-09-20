/** 소방계획서 **절↔시트 대장** — 화면 목차와 엑셀 워크북을 잇는 단일 원천.
 *
 *  워크북은 **50시트**인데 화면 목차는 **15노드**다. 1:1이 아니고, 한 노드가 여러 시트를
 *  담당한다(1.12 노드 하나가 1.12.1·1.13·1.14.1·1.14.2·1.15 다섯 장). 그 대응이 지금까지
 *  **어디에도 적혀 있지 않았다** — 목차는 `plan-tab-view.tsx`가, 시트는 manifest가, 배선은
 *  `fire-plan-anchors.ts`가 각자 들고 있었고 셋을 잇는 것은 사람의 기억뿐이었다.
 *
 *  ⚠ **라벨을 두 곳에 적지 않는다.** 여기가 갖는 것은 *화면* 어휘(`'1.1 일반현황'`)이고,
 *    *법정 시트명*(`'1.1 건축물 일반현황'`)은 manifest가 갖는다 — 둘은 일부러 다른 글이다.
 *    시트명이 필요하면 `sheetManifest(def.sheet).name`으로 **파생**한다(사본 금지).
 *
 *  🚨 **`no`로 잇지 않는다.** manifest의 `no`는 유일하지 않다 — `1.3`·`1.11.4`·`2.3`·`2.14`가
 *    각 2장이고 표지·개정이력은 `null`이다. **시트명만이 유일 키**다.
 *
 *  🚨 **적재 시점에 throw 한다**(`labelAt`과 같은 규약). 빌드가 시트를 하나 얻거나 잃으면
 *    앱이 500으로 알려 준다. 「새 시트만 조용히 빠지고 아무도 모른다」가 구조적으로 불가능해야
 *    한다 — 이 저장소는 「앵커 0칸」을 **네 번**(1.4·1.8·1.5.2·1.10.1) 뒤늦게 발견했다.
 */

/** 모바일 드롭다운의 그룹 접두 — 목차 그룹과 같은 갈래 */
type FirePlanFormGroup = '본문 1장' | '본문' | '조회'

/** 목차 노드 — 순서가 곧 화면 순서다.
 *
 *  🚨 **`as const`가 핵심이다.** 노드 키 유니온을 손으로 또 적으면 배열과 **독립**이 되어,
 *    배열에서 노드를 빼도 타입은 그대로다 — 실제로 그렇게 짰다가 변이 검사에서 뚫렸다
 *    (`FIRE_PLAN_FORMS`에서 `1.10`을 지웠는데 `tsc`가 0으로 통과했다). 배열이 유일 원천이고
 *    타입은 **거기서 파생**해야 관문이 문다.
 *
 *  ⚠ `1.9` 키가 **없다**. 법정 서식엔 1.9가 있는데(자위소방대 현황·입주사 현황 두 장) 화면
 *    목차는 1.8 다음이 1.10이다. 그 두 장은 아래 대장에서 각자 데이터가 사는 노드로 보낸다. */
export const FIRE_PLAN_FORMS = [
  // ⭐ 1.1도 [공통] 탭으로 이사했다(2026-09-20 사용자 확정 — 화재보험·구조·수신기위치 등이
  //   별지 9호 1~2쪽에도 인쇄되는 공통 축). 1.4와 같은 규약: 대장에서 빼지 않는다.
  { key: '1.1', label: '1.1 일반현황', group: '본문 1장', tab: 'facilities' },
  { key: '1.2', label: '1.2 세부현황', group: '본문 1장' },
  { key: '1.3', label: '1.3 위치·소방차진입', group: '본문 1장' },
  // ⭐ 1.4는 고객 상세 **최상위 [소방시설] 탭**으로 이사했다(2026-09-20 사용자 확정 — 소방계획서·
  //   별지 4·9호·점검표가 모두 읽는 공통 축이라 계획서 트리 소유가 아니다). 대장에서 빼지 않는다:
  //   시트 '1.4 소방시설 현황'·'1.10.3 다중이용업소'는 여전히 워크북에 있고 form 배정이 필요하다.
  { key: '1.4', label: '1.4 소방시설', group: '본문 1장', tab: 'facilities' },
  { key: '1.5', label: '1.5 피난·방화', group: '본문 1장' },
  { key: '1.6', label: '1.6 기타시설', group: '본문 1장' },
  { key: '1.7', label: '1.7 선임현황', group: '본문 1장' },
  { key: '1.8', label: '1.8 업무대행', group: '본문 1장' },
  { key: '1.10', label: '1.10 자체점검', group: '본문 1장' },
  { key: '1.11', label: '1.11 훈련·교육', group: '본문 1장' },
  { key: '1.12', label: '1.12~1.15 기록부', group: '본문 1장' },
  { key: 'ch2', label: '2장 자위소방대', group: '본문' },
  { key: 'ch3', label: '3장 피난계획', group: '본문' },
  { key: 'cover', label: '보고서 커버', group: '본문' },
  { key: 'archive', label: '조회·개정이력', group: '조회' },
] as const satisfies readonly { key: string; label: string; group: FirePlanFormGroup; tab?: 'facilities' }[]

/** 화면 목차 노드 키 = `plan-tab-view`의 `select()` 값 = 딥링크 `?tab=plan&form=` 값.
 *  ⭐ 위 배열에서 **파생**한다 — 노드를 더하거나 빼면 이 유니온이 따라 움직이고,
 *    그 순간 `[id]/page.tsx`의 `formStatus`가 `tsc`에서 막힌다. */
export type FirePlanFormKey = (typeof FIRE_PLAN_FORMS)[number]['key']
export type FirePlanFormDef = (typeof FIRE_PLAN_FORMS)[number]

/** 1장 목차(`plan-tab-view`의 구 `CH1_FORMS`) — 그룹으로 **파생**한다. 손목록을 두지 않는다 */
export const CH1_FORM_KEYS: readonly FirePlanFormKey[] =
  FIRE_PLAN_FORMS.filter(f => f.group === '본문 1장').map(f => f.key)

/** 대장이 아는 전체 노드 키 — 적재 검증(④)·`formOfSheet`의 축. ⚠ 이사 노드(1.4)도 **있다**:
 *  옛 딥링크(`?form=1.4`)는 `[id]/page.tsx`가 서버에서 새 탭으로 해석하므로 키 자체는 생존해야 한다 */
export const FIRE_PLAN_FORM_KEYS: readonly FirePlanFormKey[] = FIRE_PLAN_FORMS.map(f => f.key)

/** 고객 상세 **최상위 탭으로 이사한** 노드 (2026-09-20 사용자 확정 — 1.4 소방시설 → [소방시설] 탭).
 *  `tab` 필드가 있는 노드가 그것이고, 타입은 배열 리터럴에서 **파생**한다(손 유니온 금지 — 위 27줄 교훈). */
export type MovedFormKey = Extract<FirePlanFormDef, { tab: string }>['key']
const MOVED_KEYS: ReadonlySet<string> = new Set(FIRE_PLAN_FORMS.filter(f => 'tab' in f).map(f => f.key))

/** 소방계획서 탭 좌측 트리·모바일 드롭다운·`select()`가 받는 노드(구 `VALID_SEL`) — 이사 노드는 뺀다.
 *  그 서식의 입력은 이제 최상위 탭이 열고, `?tab=plan&form=1.4` 구 딥링크는 서버가 그 탭으로 보낸다. */
export const PLAN_TREE_FORMS: readonly FirePlanFormDef[] = FIRE_PLAN_FORMS.filter(f => !('tab' in f))
export const PLAN_TREE_FORM_KEYS: readonly FirePlanFormKey[] = PLAN_TREE_FORMS.map(f => f.key)

/** 노드 → 이사 간 최상위 탭 (이사하지 않았거나 모르는 키면 undefined) — 카드 앵커 구제(`formOfCard`)와
 *  `[id]/page.tsx`의 구 딥링크 서버 변환이 쓴다. 인자를 string으로 받는 것은 의도 —
 *  변환부는 URL에서 온 임의 문자열을 그대로 묻는다(모르는 키 = undefined = 변환 없음). */
export function tabOfForm(form: string): string | undefined {
  const d = FIRE_PLAN_FORMS.find(f => f.key === form)
  return d && 'tab' in d ? d.tab : undefined
}

/** 완성도 배지를 다는 노드 — `archive`는 서식이 아니라 조회 화면이라 분모에서 빼고,
 *  이사 노드(1.4)는 소방계획서 탭 뱃지의 분모가 아니라 **[소방시설] 탭 자신의 warn**이라 뺀다.
 *
 *  ⭐ 타입으로도 좁힌다. `[id]/page.tsx`의 `formStatus`가 이 타입의 `Record`라서, 노드를
 *    더하거나 빼면 **tsc가** 「키가 빠졌다/모르는 키다」로 막는다 — 검사보다 앞서는 관문이다. */
export type FirePlanStatusKey = Exclude<FirePlanFormKey, 'archive' | MovedFormKey>
export const FIRE_PLAN_STATUS_KEYS: readonly FirePlanStatusKey[] =
  FIRE_PLAN_FORM_KEYS.filter((k): k is FirePlanStatusKey => k !== 'archive' && !MOVED_KEYS.has(k))

export type FirePlanSectionDef = {
  /** manifest 시트명 — **유일 키** */
  sheet: string
  /** 이 시트를 보여 주고, 이 시트의 값을 **고치는** 화면 */
  form: FirePlanFormKey
  /** 그 서식 안의 카드 앵커(`#c-1.10.1`). 없으면 「아직 그 시트 전용 카드가 없다」는 **사실** */
  card?: string
  /** 커버리지 면제 — 🚨 사유가 비면 적재 시점에 throw 한다(봐주기에 이름을 강제한다) */
  exempt?: string
}

/** 50시트 ↔ 15노드.
 *
 *  ⭐ 배정 규칙은 하나다 — **「그 칸의 값을 어느 화면에서 고치는가」**. 시트 번호가 아니다.
 *    그래서 1.9.3·1.10.3처럼 **장을 넘나드는 줄**이 생기고, 그게 정확히 이 대장이 있어야 하는 이유다.
 */
export const FIRE_PLAN_SECTIONS: readonly FirePlanSectionDef[] = [
  // ── 앞붙이 ──
  // 표지 앵커는 `cover_title`(고객명)·`cover_purpose`(용도) 둘뿐이고 **둘 다 1.1 축**이다.
  // 🚨 `cover` 노드로 보내면 안 된다 — 그 화면이 고치는 것은 `sections.reportCover`(생성 문서
  //    **마지막** 페이지 업체명·연도)라 표지에 한 글자도 들어가지 않는다. 미리보기가 거짓이 된다.
  { sheet: '표지', form: '1.1' },
  { sheet: '개정이력', form: 'archive' },

  // ── 제1장 ──
  { sheet: '1.1 건축물 일반현황', form: '1.1' },
  { sheet: '1.2.1 구역별 세부현황', form: '1.2' },
  { sheet: '1.2.2 화재취약장소 현황', form: '1.2' },
  { sheet: '1.3 건축물 위치·운영현황', form: '1.3' },
  { sheet: '1.3 소방차 진입경로', form: '1.3' },
  { sheet: '1.4 소방시설 현황', form: '1.4' },
  { sheet: '1.5.1 피난·방화시설 현황', form: '1.5' },
  { sheet: '1.5.2 방화·제연구획 현황도', form: '1.5' },
  { sheet: '1.6.1 기타시설 일반현황', form: '1.6' },
  { sheet: '1.7.1 소방안전관리자 선임현황', form: '1.7' },
  { sheet: '1.8 업무대행 현황', form: '1.8' },
  // ⭐ 입주사는 별도 입력이 아니라 **1.2.1 구역표의 열**이다(PDF `fire-plan-template.ts`의
  //    구역별 세부현황 표에 `관리주체(입주사)`·`담당자(연락처)` 머리글이 있다 — `sections.zones`).
  //    그래서 1.9.3은 1.2 노드가 담당한다.
  { sheet: '1.9.3 입주사 현황', form: '1.2' },
  // ⭐ 1장에 있는 자위소방대 **요약**이다. 실제 입력은 2장(`fire_brigade_members`·`brigadeGeneral`).
  { sheet: '1.9 자위소방대 현황', form: 'ch2' },
  { sheet: '1.10.1 연간 점검 계획', form: '1.10', card: 'c-1.10.1' },
  // ⭐ 다중이용업소 입력 자리가 1.10 → 1.4 「기타」로 이사했다(소방계획서_43 S7, 2026-09-09).
  //    구 `MOVED_ANCHOR_FORM`이 들고 있던 그 사실을 여기로 흡수한다 — 두 곳에 둘 일이 아니다.
  { sheet: '1.10.3 다중이용업소 관리현황', form: '1.4', card: 'c-1.10.3' },
  { sheet: '1.10.4 화재·비화재보 이력', form: '1.10', card: 'c-1.10.4' },
  { sheet: '1.11.1 소방훈련·교육 연간계획', form: '1.11' },
  { sheet: '1.11.2 소방훈련·교육 세부계획', form: '1.11' },
  { sheet: '1.11.3 소방훈련 시나리오', form: '1.11' },
  { sheet: '1.11.4 훈련·교육 결과기록부', form: '1.11' },
  { sheet: '1.11.4 결과기록부 뒷쪽', form: '1.11' },
  { sheet: '1.12.1 화기취급작업 현황', form: '1.12', card: 'c-1.12' },
  { sheet: '1.13 소방시설 공사·정비 기록', form: '1.12', card: 'c-1.13' },
  { sheet: '1.14.1 화재예방 및 홍보 계획', form: '1.12', card: 'c-1.14' },
  { sheet: '1.14.2 화재예방 및 홍보 결과', form: '1.12', card: 'c-1.14' },
  { sheet: '1.15 피해 복구', form: '1.12', card: 'c-1.15' },

  // ── 제2장 (전부 `plan-ch2`. 머리주석이 2.1·2.2·2.5~2.13·2.14를 자기 것이라 적고 있다) ──
  { sheet: '2.1 자위소방대 일반현황', form: 'ch2' },
  { sheet: '2.2 자위소방대 편성표', form: 'ch2', card: 'c-2.2' },
  { sheet: '2.3 조직도', form: 'ch2' },
  { sheet: '2.3 임무', form: 'ch2' },
  { sheet: '2.4 개별임무카드', form: 'ch2' },
  { sheet: '2.5 지휘통제팀', form: 'ch2' },
  { sheet: '2.6 비상연락팀(지휘반)', form: 'ch2' },
  { sheet: '2.8 비상상황별 연락방법', form: 'ch2' },
  { sheet: '2.9 초기소화팀(진압반)', form: 'ch2' },
  { sheet: '2.10 피난유도팀', form: 'ch2' },
  { sheet: '2.11 응급구조팀', form: 'ch2' },
  { sheet: '2.12 방호안전팀', form: 'ch2' },
  { sheet: '2.13 초기대응체계', form: 'ch2' },
  { sheet: '2.14 교육·훈련 결과기록부', form: 'ch2' },
  { sheet: '2.14 결과기록부 뒷쪽', form: 'ch2' },

  // ── 제3장 (`plan-ch3`의 `CH3_FORMS`가 3.1~3.7을 그대로 든다) ──
  // ⭐ 3.1은 그 화면이 **1.5 입력값을 읽기 전용으로 비추는** 자리다(「수정은 1장 > 1.5에서」,
  //    §9-6⑦ 단일 입력처). 값을 고치는 곳은 1.5지만 **그 시트를 보여 주는 곳**은 ch3라 여기 둔다.
  { sheet: '3.1 피난시설 일반현황', form: 'ch3', card: 'c-3.1' },
  { sheet: '3.2 피난시설 세부현황', form: 'ch3', card: 'c-3.2' },
  { sheet: '3.3 피난인원현황', form: 'ch3', card: 'c-3.3' },
  { sheet: '3.4 피난유도 절차·경로', form: 'ch3', card: 'c-3.4' },
  { sheet: '3.5 피난약자 현황·계획', form: 'ch3', card: 'c-3.5' },
  { sheet: '3.6 피난약자 유형별 방법', form: 'ch3', card: 'c-3.6' },
  { sheet: '3.7 피난기구·유도장비 현황', form: 'ch3', card: 'c-3.7' },
] as const

const BY_SHEET = new Map(FIRE_PLAN_SECTIONS.map(d => [d.sheet, d]))

/** 한 목차 노드가 담당하는 시트들 — **대장 순서**(= 워크북 순서)를 지킨다 */
export function sectionsOfForm(form: FirePlanFormKey): FirePlanSectionDef[] {
  return FIRE_PLAN_SECTIONS.filter(d => d.form === form)
}

/** 시트명 → 그 시트를 보여 주는 노드. 🚨 없는 시트면 throw(대장이 유일 원천이라 폴백이 없다) */
export function formOfSheet(sheet: string): FirePlanFormKey {
  const d = BY_SHEET.get(sheet)
  if (!d) throw new Error(`fire-plan 대장: 시트 '${sheet}'가 대장에 없다`)
  return d.form
}

/** 그 노드가 담당하는 시트 수 — 목차 배지(「N장 중 M장 배선」)의 분모 */
export function sheetCountOfForm(form: FirePlanFormKey): number {
  return sectionsOfForm(form).length
}

const BY_CARD = new Map(
  FIRE_PLAN_SECTIONS.filter(d => d.card).map(d => [d.card as string, d.form]),
)

/** 카드 앵커(`#c-1.10.3`) → 그 카드가 **지금 있는** 서식.
 *
 *  구 `plan-tab-view`의 `MOVED_ANCHOR_FORM`을 흡수한 것이다. 그 표가 있던 이유는
 *  *「절 번호는 그대로인데 어느 서식에 있는지가 바뀌었다」* 였고, 그건 정확히 이 대장이 드는 사실이다.
 *  두 곳에 두면 다음 이사 때 한쪽만 고쳐진다.
 *
 *  ⭐ 이사한 카드만이 아니라 **모든 카드**를 답한다 — `#c-3.1`로 들어와도 3장으로 보낸다.
 *    구 표는 이사 이력이 있는 한 칸만 알아서 나머지 딥링크는 엉뚱한 화면에 떨어졌다. */
export function formOfCard(cardId: string): FirePlanFormKey | undefined {
  return BY_CARD.get(cardId)
}
