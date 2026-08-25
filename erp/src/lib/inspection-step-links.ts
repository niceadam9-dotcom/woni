import { sheetShownWhenInstalledOnly } from '@/lib/sheet-facility-map'

/** 단계별 '정상 경로' 진입 링크 — 달력 패널·계획 슬라이드 패널 공용 단일 소스
 *
 *  배경: 6단계는 [완료] 버튼을 눌러 끝내는 게 아니라 **증거가 등록되면 자동으로 완료**된다
 *  (inspection-step-status.ts `evidenceDone`). 그런데 화면에는 강제 완료(사유 입력) 버튼만 있고
 *  정작 증거를 남기러 갈 링크가 없어서, 사용자가 예외 경로를 정상 경로로 오인했다.
 *  여기서 '이 단계의 증거를 어디서 만드는가'를 링크로 되돌려 준다.
 *
 *  ⚠ 목적지가 **확인된 단계만** 반환한다. ②③④⑥은 업로드 슬롯·제출일 입력 위치를 확정하지 못해
 *  1차에서 뺐다 — 추측으로 링크를 걸면 엉뚱한 화면으로 보내는 편이 링크가 없는 것보다 나쁘다.
 *  null을 돌려주면 호출부는 [입력] 버튼을 아예 그리지 않는다(침묵). */
export function stepInputLink(
  inspectionId: string,
  stepNum: number,
): { href: string; label: string; title: string } | null {
  switch (stepNum) {
    case 1:
      // ① 증거 = 점검표 응답 1건 이상 → **입력 전용 페이지**(소방계획서_28 S1)로 보낸다.
      //    종전엔 점검 상세(`?step=1&sheet=auto`)의 드로어를 열었지만, 입력의 정본이
      //    `/inspections/{id}/sheet`로 옮겨졌다(회차트리·1.4 배지도 그리로 간다).
      //    `?sheet=auto` 의미는 보존된다 — 신설 페이지도 아래 pickAutoOpenSheet로 첫 미완성을 고른다.
      return {
        href: `/inspections/${inspectionId}/sheet?sheet=auto`,
        label: '점검표 입력',
        title: '점검표를 입력하면 이 단계는 사유 없이 자동으로 완료됩니다',
      }
    case 5:
      // ⑤ 증거 = 불량 전건 조치 완료. #defects 앵커는 예전부터 있었지만 step=5여야 그 칸이 렌더된다
      return {
        href: `/inspections/${inspectionId}?step=5#defects`,
        label: '불량 조치',
        title: '불량을 전건 조치하면 이 단계는 사유 없이 자동으로 완료됩니다',
      }
    default:
      return null
  }
}

/** `?sheet=auto`가 열 시트 고르기 — **첫 미완성 시트**, 없으면 null(열지 않는다)
 *
 *  구조적 타입만 받는다: SheetProgress를 값으로 import하면 sheet-overview.ts가 딸려 오고
 *  그 안의 createAdminClient가 클라이언트 번들로 새어 든다. 순수 함수라 DB 없이 단언 가능하다.
 *
 *  ⚠ 필터는 보드(SheetGroupBoard)의 기본 표시와 **같아야** 한다 — 여기서 그 필터를 빼면 화면에
 *  보이지도 않는 시트가 열려 '첫 미완성'이 사용자 눈의 첫 미완성과 어긋난다.
 *  주석으로만 맞춰 두면 한쪽만 바뀐다(2026-08-20 STD-31 실사고) — 이제 같은 함수를 쓴다.
 *  설치 정보가 아예 없는 고객은 보드가 전체를 보여주므로(Q-12) 필터도 함께 푼다. */
export function pickAutoOpenSheet<T extends {
  sheetId: string; sheetCode: string; total: number; responded: number; installed: boolean
}>(list: T[]): T | null {
  const noFacility = list.length > 0 && list.every(p => !p.installed)
  return list.find(p =>
    (noFacility || sheetShownWhenInstalledOnly(p))
    && p.total > 0
    && p.responded < p.total) ?? null
}
