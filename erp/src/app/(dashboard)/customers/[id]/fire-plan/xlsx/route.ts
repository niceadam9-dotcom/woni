import { NextResponse, type NextRequest } from 'next/server'
import { getProfile, can } from '@/lib/auth'
import type { UserRole } from '@/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { assembleFirePlan } from '@/lib/fire-plan-generate'
import { firePlanTemplate } from '@/lib/fire-plan-template-cache'
import { toInjectTargets } from '@/lib/xlsx-workbook'
import { injectWorkbook } from '@/lib/xlsx-inject'
import { brigadeRowOverflow, buildFirePlanValues, attendanceOverflow, constructionRowOverflow, constructionUnmapped, equipRowOverflow, evac3RowOverflow, evacDetailOverflow, evacDetailStatusUnmapped, hazmatItemOverflow, evacRouteOverflow, evac210RouteOverflow, fireworkRowOverflow, hazardUnmatched, missingValueFields, revisionRowOverflow, tenantRowOverflow, valuableRowOverflow, vulnerableAreaUnsplit, vulnerableMethodsUnmapped, vulnerablePlanOverflow, zoneRowOverflow } from '@/lib/fire-plan-xlsx-values'
import { FIRE_PLAN_MANIFEST } from '@/lib/fire-plan-xlsx-manifest'
import { embedFirePlanImages, planFirePlanImages } from '@/lib/fire-plan-xlsx-images'
import { applyFirePlanCheckboxes } from '@/lib/fire-plan-checkbox-controls'

/** 소방계획서 엑셀(xlsx) — 소방계획서_42 S6-1.
 *
 *  원형은 `inspections/[id]/workbook/route.ts`(갑지)다. 권한 → 템플릿 → **앵커 검증** → 값 →
 *  주입 → 스트리밍. PDF와 **같은 `assembleFirePlan()`** 을 먹으므로 두 산출물의 값이 갈라질 수
 *  없다. 파일은 저장하지 않는다(보관함 폐지 규약) — 고정 좌표는 생성 시점에만 유효하면 된다.
 *
 *  🚨 **조용한 오적용 금지.** 앵커 라벨 불일치·값 맵 구멍·미착지는 전부 **500으로 끊는다**.
 *    법정 서식에서 '거의 맞는 문서'는 틀린 문서이고, 200으로 나가면 아무도 모른다.
 *    뒤집어 말하면 이 라우트의 **200은 곧 전량 착지 단언**이다(S7-4가 그걸 판정축으로 쓴다).
 *
 *  라우트 핸들러 = 공개 엔드포인트(소방계획서_17 교훈) — 세션·권한을 여기서 직접 검사한다.
 */
export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (!can(profile.role as UserRole, 'customer_manage')) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 })
  // 생성 연도 = 올해 자동 — PDF 라우트와 같은 축(KST 보정)
  const year = new Date(Date.now() + 9 * 3600_000).getFullYear()

  const admin = createAdminClient()
  try {
    // 템플릿·앵커 검증은 **정적 산출물의 함수**라 프로세스당 1회만 계산한다(fire-plan-template-cache).
    // 종전엔 요청마다 1.7MB를 읽고 `validateAnchors`를 두 번 돌렸다 — 둘 다 워크북 전체 파싱이다.
    // ⚠ `templateBytes`는 **공유본**이다. 여기서 변형하면 다음 요청이 오염된다
    //   (`injectWorkbook`은 원본을 안 건드린다 — `xlsx-inject.ts:210`, 검사가 해시로 실증).
    const { bytes: templateBytes, value: check, image: imgCheck } = await firePlanTemplate()

    // ① 앵커 검증 — 서식이 밀렸으면 **주입을 시작하지 않는다**.
    //    자가치유가 일어났다는 것은 좌표가 이미 밀렸다는 뜻이라 고지에 싣는다(S7-2와 같은 축).
    if (!check.ok) {
      return NextResponse.json(
        { error: `소방계획서 서식 좌표가 어긋났습니다(${check.failures.length}건). 관리자에게 알려 주세요.`, detail: check.failures.slice(0, 8) },
        { status: 500 })
    }

    // ①-b 사진 상자 좌표 — **값 앵커와 따로** 검증한다(§사진상자). 저쪽 목록에 섞으면
    //     `missingValueFields`가 '값 없는 필드'라며 생성을 통째로 끊는다(그림엔 값이 없다).
    if (!imgCheck.ok) {
      return NextResponse.json(
        { error: `소방계획서 사진 상자 좌표가 어긋났습니다(${imgCheck.failures.length}건). 관리자에게 알려 주세요.`, detail: imgCheck.failures.slice(0, 8) },
        { status: 500 })
    }

    // ② 값 — PDF와 공유하는 단일 조립 결과만 먹는다(재조회 없음)
    const { data, images, assets, missing } = await assembleFirePlan(admin, id, year)
    const values = buildFirePlanValues(data)
    // 사진 배정은 **주입 전에** 정한다 — 그림이 앉는 상자의 안내 글자(`[해당 층 평면도]`)를
    // 같은 주입 왕복에서 함께 비워야 하기 때문이다.
    const imgPlan = planFirePlanImages(images, assets, imgCheck.anchors)

    // ③ 값 맵 완결성 — 앵커가 요구하는 필드가 하나라도 없으면 그 칸만 템플릿 잔재로 남는다
    const gaps = missingValueFields(values)
    if (gaps.length) {
      return NextResponse.json(
        { error: `소방계획서 값 매핑이 불완전합니다(${gaps.length}칸).`, detail: gaps.slice(0, 12) },
        { status: 500 })
    }

    // ④ 주입 — 값 없는 앵커는 명시적 공란(null)으로 완전 덮어쓰기(S5-4)
    const { targets, unmapped } = toInjectTargets(values, check.anchors)
    if (unmapped.length) {
      return NextResponse.json(
        { error: `주입 대상 누락 ${unmapped.length}칸`, detail: unmapped.slice(0, 12).map(a => `${a.sheet}!${a.cell}`) },
        { status: 500 })
    }
    const result = await injectWorkbook(templateBytes, [
      ...targets,
      // 그림이 앉는 상자의 '여기 붙이시오' 안내는 지운다 — 그림 밑에 글자가 남는다
      ...imgPlan.blankCells.map(c => ({ sheet: c.sheet, cell: c.cell, value: null })),
    ])
    if (result.missed.length) {
      return NextResponse.json(
        { error: `소방계획서 값 주입 실패 ${result.missed.length}칸 — 미착지가 있으면 내보내지 않습니다.`, detail: result.missed.slice(0, 12) },
        { status: 500 })
    }

    // ⑤ 체크박스 — 상자 글자(`□`/`■`)를 **클릭 가능한 양식 컨트롤**로 바꾼다.
    //    받는 사람이 엑셀에서 직접 체크·해제하게 하는 것이 목적이고, 체크 상태는 바로 위 주입이
    //    그 칸에 적어 놓은 글(`■` 여부)이 정한다 — 값 계층을 따로 고칠 필요가 없다.
    //    ⚠ **사진보다 먼저** 돌아야 한다: CT_Worksheet 순서가 `drawing → legacyDrawing`이고
    //      `insertDrawingTag`가 `<legacyDrawing` 앞에 끼우도록 이미 짜여 있다. 뒤집으면
    //      **LibreOffice는 통과하고 Excel만** 복구 대화상자를 띄운다(우리 LO 검사로는 안 잡힌다).
    //    달지 못한 칸은 상자 글자를 그대로 두므로 **오늘과 같은 상태**다 — 끊지 않고 고지로 낸다.
    const checkboxes = await applyFirePlanCheckboxes(result.bytes)

    // ⑥ 사진·도면 — 법정 서식이 비워 둔 상자에 앉힌다. 한 장이 깨져도 문서는 나간다(사유는 고지에).
    const embedded = await embedFirePlanImages(checkboxes.bytes, imgPlan.targets)

    const name = `${data.buildingName || '소방계획서'}_소방계획서_${year}.xlsx`
    return new NextResponse(Buffer.from(embedded.bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="fire-plan-${year}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
        // S6-2 고지 헤더 — 갑지 `X-Workbook-Missing`의 규약을 그대로 이식한다.
        // **순서가 곧 생존 순위다**: 앞이 살고 뒤가 잘린다. 자가치유는 서식이 이미 밀렸다는
        // 신호라 1순위, 넘쳐서 버린 구역은 잘린 채로도 인쇄물이 멀쩡해 보이므로 2순위.
        // 절단할 때는 **잘렸다는 사실 자체**를 드러낸다 — 조용한 절단도 조용한 누락이다.
        'X-FirePlan-Missing': encodeURIComponent(noticeHeader([
          ...check.healed.map(h => `서식 좌표 자가치유: ${h}`),
          // 사진 상자도 같은 1순위다 — 치유됐다는 건 그림이 원래 자리에 안 붙었다는 뜻이다
          ...imgCheck.healed.map(h => `사진 상자 좌표 자가치유: ${h}`),
          ...(zoneRowOverflow(data) ? [`구역별 세부현황 ${zoneRowOverflow(data)}개 구역 미표기(양식 고정 행 상한)`] : []),
          // 3.3은 같은 구역을 19행까지 싣는다 — 1.2.1(8행)에서 잘린 구역이 여기엔 남으므로 따로 센다
          ...(evac3RowOverflow(data) ? [`피난인원현황 ${evac3RowOverflow(data)}개 구역 미표기(양식 고정 행 상한)`] : []),
          // 1.2.2는 「칸이 모자라 잘렸다」가 아니라 **「이름이 달라 어디에도 못 넣었다」**다.
          // 양식이 보일러실·주방·전기실 셋만 인쇄해 두어 그 밖의 장소는 자리가 없다 —
          // 버리되 **이름을 적어** 알린다(조용한 절단은 조용한 누락이다).
          ...(hazardUnmatched(data).length
            ? [`화재취약장소 ${hazardUnmatched(data).length}곳 미표기(양식 고정 3개소 밖): ${hazardUnmatched(data).slice(0, 4).join(' ')}`]
            : []),
          ...(fireworkRowOverflow(data) ? [`화기취급작업 ${fireworkRowOverflow(data)}건 미표기(양식 고정 행 상한)`] : []),
          ...(tenantRowOverflow(data) ? [`입주사 ${tenantRowOverflow(data)}곳 미표기(양식 고정 15행)`] : []),
          ...(equipRowOverflow(data) ? [`피난기구·장비 ${equipRowOverflow(data)}건 미표기(양식 3블록·첫 블록은 완강기 예시)`] : []),
          ...(hazmatItemOverflow(data) ? [`위험물 ${hazmatItemOverflow(data)}건 미표기(양식 3행 — 1.6.1·2.12 공통)`] : []),
          ...(valuableRowOverflow(data) ? [`비상반출물품 ${valuableRowOverflow(data)}건 미표기(양식 3행)`] : []),
          ...(evacDetailOverflow(data) ? [`피난시설 세부 ${evacDetailOverflow(data)}건 미표기(양식 고정 행 상한)`] : []),
          ...(revisionRowOverflow(data) ? [`개정이력 ${revisionRowOverflow(data)}건 미표기(양식 연번 11행)`] : []),
          // PDF는 「상태」를 인쇄하는데 양식 3.2엔 그 열이 없다 — 말 안 하면 엑셀이 빠뜨린 걸로 오해한다
          ...(evacDetailStatusUnmapped(data) ? [`피난시설 「상태」 ${evacDetailStatusUnmapped(data)}건 미표기(양식에 해당 열 없음)`] : []),
          ...(constructionRowOverflow(data) ? [`소방시설 공사·정비 ${constructionRowOverflow(data)}건 미표기(양식 고정 행 상한)`] : []),
          // 🚨 넘침과 다른 축 — 양식 1.13에 **「대상 설비」·「시공업체」 열이 아예 없다**.
          //    PDF는 둘 다 인쇄하므로 말해 주지 않으면 「엑셀이 빠뜨렸다」고 오해한다.
          ...(constructionUnmapped(data).facility ? [`공사·정비 「대상 설비」 ${constructionUnmapped(data).facility}건 미표기(양식에 해당 열 없음)`] : []),
          ...(constructionUnmapped(data).company ? [`공사·정비 「시공업체」 ${constructionUnmapped(data).company}건 미표기(양식 「작업책임자」는 사람 칸이다)`] : []),
          ...(attendanceOverflow(data) ? [`교육·훈련 참석확인 명단 ${attendanceOverflow(data)}명 미표기(양식 정원 50명)`] : []),
          ...(evacRouteOverflow(data) ? [`피난경로 ${evacRouteOverflow(data)}건 미표기(양식이 한 줄만 그려 두었다)`] : []),
          ...(evac210RouteOverflow(data) ? [`피난유도팀(2.10) 피난경로 ${evac210RouteOverflow(data)}건 미표기(양식 세 줄)`] : []),
          ...(vulnerableMethodsUnmapped(data).length ? [`피난약자 방법 ${vulnerableMethodsUnmapped(data).join('·')} 미표기(양식 4종 밖)`] : []),
          ...(vulnerablePlanOverflow(data) ? [`피난약자 피난계획 ${vulnerablePlanOverflow(data)}건 미표기(양식 고정 행 상한)`] : []),
          // 🚨 넘침과 다른 축 — 양식은 「구역」을 **동·층 두 칸**으로 나눠 그리는데 ERP는 한 칸이다.
          //    조각만 넣으면 `3동 4층 로비`의 `로비`가 조용히 사라지므로 통째로 물러나고 **센다**.
          ...(vulnerableAreaUnsplit(data) ? [`피난약자 계획 ${vulnerableAreaUnsplit(data)}건의 구역 미표기(동·층 두 칸으로 나눌 수 없는 표기)`] : []),
          // 대원 넘침도 같은 축이다 — 편성표는 잘려 나가도 인쇄물이 멀쩡해 보인다
          ...(brigadeRowOverflow(data) ? [`자위소방대 현장대응팀 ${brigadeRowOverflow(data)}명 미표기(양식 고정 행 상한)`] : []),
          // 체크박스를 못 단 칸 — 그 칸은 상자가 **글자로 남아** 클릭이 안 된다. 문서는 멀쩡해
          // 보이므로(상자가 보이니까) 여기 적지 않으면 아무도 모른다.
          ...(checkboxes.skipped.length
            ? [`체크박스 미적용 ${checkboxes.skipped.length}칸(글자 상자로 남음): ${checkboxes.skipped.slice(0, 5).join(' ')}`]
            : []),
          // 사진 — 버린 장수·깨진 장수는 여기가 유일한 창구다(문서에는 흔적이 안 남는다)
          ...imgPlan.notes, ...embedded.notes,
          ...missing,
          // 범위 고지 — 받는 사람이 어디까지 담겼는지 헤더에서 바로 알게 한다
          `범위: ${FIRE_PLAN_MANIFEST.scope}(시트 ${FIRE_PLAN_MANIFEST.sheets.length}장)`,
        ])),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/**
 * 고지 문자열 조립 — 600자 상한.
 *
 * ⚠ 생략 글자 수는 **실제로 남긴 것**을 기준으로 센다. 갑지에서 `full.length - 580`으로 세다가
 *   구분자까지 되감은 만큼을 놓쳐 '380자 생략'이라 적고 903자를 버린 적이 있다(실제의 42%만 신고).
 */
function noticeHeader(parts: string[]): string {
  const full = parts.filter(Boolean).join(' | ')
  if (full.length <= 600) return full
  const cut = full.slice(0, 580)
  const back = cut.lastIndexOf(' | ')
  const kept = back > 0 ? cut.slice(0, back) : cut
  return `${kept} | …외 ${full.length - kept.length}자 생략`
}
