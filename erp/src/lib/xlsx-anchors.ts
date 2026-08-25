/** 갑지 워크북 앵커 맵 — 좌표를 쓰되 좌표만 믿지 않는다 (소방계획서_27 S3)
 *
 *  발상은 lib/doc-overrides.ts에서 이식했다: 키+라벨 동시 일치 → 어긋나면 생성 실패
 *  (법정·행정 문서에선 조용히 붙이는 것도 조용히 버리는 것도 안 된다).
 *  갑지의 개요 시트는 A열이 라벨·B열이 값이라 라벨 검증이 그냥 옆 셀이다.
 *
 *  전 좌표는 2026-08-21 실측(scripts/_probe-hub-layout.mjs · _probe-delegation-layout.mjs).
 *  서식이 갱신되면 validateAnchors가 먼저 붉어진다 — 그때 재실측해 재승인한다(Q-4: 재변환). */
import * as XLSX from 'xlsx'
import { FORM4_ROWS, FORM4_SHEET, form4InstallField, form4VerdictField } from '@/lib/xlsx-form4'

export type Anchor = {
  field: string
  sheet: string
  cell: string
  /** 라벨 검증 축 — 이 셀의 실값이 label과 (공백·콜론 무시) 일치해야 주입을 허용한다 */
  labelCell: string
  label: string
  /** 깨진 참조('1번 입력'! 등) 자리 — <f>를 지우고 값으로 대체 */
  dropFormula?: boolean
  /** 값이 비었을 때 **서식의 수식을 지우지 않는다**(dropFormula를 그 경우에만 유예).
   *
   *  왜 필요한가 — 이 칸을 **다른 시트가 단일 참조로 복제**하는데(별지 4호 점검결과 64칸은
   *  전부 `대상물`·`대상물2`에 복제칸을 하나씩 갖는다, 실측 `_probe-form4-mirrors.mts`),
   *  원본이 **빈 셀**이면 복제칸이 재계산으로 **`0`**이 된다. 그래서 빌드가 이 칸들을
   *  `=""`(빈 문자열 수식)로 만들어 두었고, 값이 없을 때는 그 수식을 살려 둬야 한다.
   *
   *  ⚠ 빈 문자열 셀(`<is><t/></is>`)로는 안 된다 — LibreOffice가 blank로 정규화해 역시 0이
   *  된다(2026-08-25 5종 표현 왕복 실측 `scripts/_probe-empty-repr.mts`: 빈 셀·빈 inlineStr·
   *  빈 `<v>` 전부 0, 살아남는 것은 `공백 1칸`과 `=""` 둘뿐). 같은 함정을 `계획서!H12`에서
   *  이미 한 번 밟았다 — 표본 소견을 지웠더니 `"0"`이 인쇄됐다. */
  keepFormulaWhenEmpty?: boolean
}

const HUB = '개요'

/** Phase 1 — 개요 허브 + 위임장 대리인 + 계약서 대표자.
 *  스포크(공문·위임장·계약서·계획서·완료보고서)의 나머지 칸은 허브 수식이 채운다(117수식 실측). */
export const ANCHORS: Anchor[] = [
  // 허브 — 문서 공통
  { field: 'year',            sheet: HUB, cell: 'B9',  labelCell: 'A9',  label: '년도' },
  { field: 'sendDateSerial',  sheet: HUB, cell: 'B10', labelCell: 'A10', label: '발신일자' },
  { field: 'docNo',           sheet: HUB, cell: 'B11', labelCell: 'A11', label: '문서번호', dropFormula: true },
  { field: 'inspectSerial',   sheet: HUB, cell: 'B12', labelCell: 'A12', label: '점검일자' },
  { field: 'customerName',    sheet: HUB, cell: 'B14', labelCell: 'A14', label: '상호' },
  { field: 'station',         sheet: HUB, cell: 'D14', labelCell: 'C14', label: '관할소방서' },
  { field: 'address',         sheet: HUB, cell: 'B16', labelCell: 'A16', label: '소재지' },
  // 허브 — 관계인(소방안전관리자). 위임장 C6~C9가 개요!D10~D13을 거쳐 끌어간다
  { field: 'managerName',     sheet: HUB, cell: 'B17', labelCell: 'A17', label: '소방안전관리자성명' },
  { field: 'managerPosition', sheet: HUB, cell: 'D11', labelCell: 'C11', label: '직위' },
  { field: 'managerPhone',    sheet: HUB, cell: 'B19', labelCell: 'A19', label: '전화번호' },
  { field: 'managerBirth',    sheet: HUB, cell: 'D13', labelCell: 'C13', label: '생년월일' },
  // 허브 — 점검 기간(E1을 E2~E8·위임장 C10이 따라간다) · 주된 점검인력
  { field: 'periodLabel',     sheet: HUB, cell: 'E1',  labelCell: 'A1',  label: '주된점검인력' },
  { field: 'daysLabel',       sheet: HUB, cell: 'F1',  labelCell: 'A1',  label: '주된점검인력' },
  { field: 'mainInspector',   sheet: HUB, cell: 'B1',  labelCell: 'A1',  label: '주된점검인력' },
  // 위임장 — 대리인 4칸. 원본은 존재하지 않는 '1번 입력'! 시트를 참조한다(실측) —
  // 재계산을 안 켜면 #REF!로 드러나지도 않아 캐시값만 보고 지나치기 쉽다. 값으로 대체한다.
  { field: 'agentName',       sheet: '위임장', cell: 'N6', labelCell: 'K6', label: '성명',     dropFormula: true },
  { field: 'agentPosition',   sheet: '위임장', cell: 'N7', labelCell: 'K7', label: '직위',     dropFormula: true },
  { field: 'agentPhone',      sheet: '위임장', cell: 'N8', labelCell: 'K8', label: '연락처',   dropFormula: true },
  { field: 'agentBirth',      sheet: '위임장', cell: 'N9', labelCell: 'K9', label: '생년월일', dropFormula: true },
  // 계약서(Q-2: 공란이 아니라 문서로) — 대표자는 존재하지 않는 '입력'! 참조라 값으로 대체.
  // 보수금액 E11·E14의 NUMBERSTRING은 한국어 Excel 전용 함수다: LibreOffice에선 #NAME?지만
  // 사용자의 실제 도구인 Excel에서는 J11·J14에 금액을 넣으면 한글 금액이 자동으로 살아난다 — 남긴다.
  { field: 'repName',         sheet: '계약서', cell: 'D29', labelCell: 'C29', label: '대표자', dropFormula: true },
  // 대상처(표지, S7-3) — 제목이 '종합점검' **리터럴**이라 작동점검 건에도 종합으로 인쇄되던 것을
  // 점검종류 가변으로. 인접 라벨이 없어 자기 라벨로 검증한다 — 서식이 밀리면 이 문구를 재탐색해
  // 오프셋 0으로 치유된다. 연도(F5)·건물명(B10)·발행일(B29)은 허브 수식이라 폐포가 채운다.
  { field: 'coverTitle',      sheet: '대상처', cell: 'B7', labelCell: 'B7', label: '소방시설 종합점검 결과보고서' },
  // 허브 — 건축물 현황(S3-5 1차 확장). 값의 원천은 customers.use_approval_date + buildings 한 행
  // (report9-actions와 같은 '활성·최고참 1동' 축). 전부 정보 시트가 단일 참조 수식으로 끌어가므로
  // 폐포 전파가 그대로 작동한다(정보!B17='개요'!D17 등 실측 — _probe-hub-sample-values.mts).
  // 등급(B18)·교육이수일(B20)·점검인력 보조 명단은 resolveFireSafetyManager·participants 해석이
  // 필요해 S7-0(assembleReport9 lib 추출) 후 2차 확장 — 여기서 단순 컬럼 읽기로 채우면 PDF와 갈라진다.
  { field: 'households',        sheet: HUB, cell: 'B13', labelCell: 'A13', label: '세대수' },
  { field: 'purpose',           sheet: HUB, cell: 'B15', labelCell: 'A15', label: '대상물구분(용도)' },
  { field: 'buildingCount',     sheet: HUB, cell: 'D15', labelCell: 'C15', label: '건물동수' },
  { field: 'totalArea',         sheet: HUB, cell: 'D17', labelCell: 'C17', label: '연면적' },
  { field: 'buildingArea',      sheet: HUB, cell: 'D18', labelCell: 'C18', label: '건축면적' },
  { field: 'useApprovalSerial', sheet: HUB, cell: 'D19', labelCell: 'C19', label: '사용승인일' },
  { field: 'permitDateSerial',  sheet: HUB, cell: 'D20', labelCell: 'C20', label: '건축허가일' },
  { field: 'heightM',           sheet: HUB, cell: 'B21', labelCell: 'A21', label: '높이' },
  { field: 'floorsAbove',       sheet: HUB, cell: 'B22', labelCell: 'A22', label: '지상' },
  { field: 'floorsBelow',       sheet: HUB, cell: 'B23', labelCell: 'A23', label: '지하' },
  // 경사로 — `정보!J20`이 `=개요!D21`을 읽는데 앵커가 없어 캐시 부재로 뷰어가 **'경사로 0 개소'**를
  // 그렸다. PDF(doc-templates/report9.ts:329)는 buildings.ramp_count 실값을 찍고 있었으므로
  // **D-7('PDF와 엑셀이 갈라지지 않는다')이 깨진 유일한 칸**이었다(2026-08-23 F세대 판정 실측).
  { field: 'rampCount',         sheet: HUB, cell: 'D21', labelCell: 'C21', label: '경사로' },
  // ── S3-5 2차 확장(S7-0 후 개통) — 등급·교육이수일·점검인력 명단. 값은 assembleReport9
  // (lib/report9-assemble)의 main·assistants·managerGrade·mgrEduDate — PDF와 같은 해석기라
  // 대상물 등급(building_grade) vs 사람 자격(license_grade) 축 혼동이 구조적으로 불가능하다(D-7).
  { field: 'managerGrade',   sheet: HUB, cell: 'B18', labelCell: 'A18', label: '소방안전관리등급' },
  // B20은 날짜 서식(yyyy"년" m"월" d일;@)이되 ;@ 텍스트 통과라 kdate 문자열이 그대로 산다
  { field: 'managerEduDate', sheet: HUB, cell: 'B20', labelCell: 'A20', label: '최근 교육이수일' },
  // 주된 점검인력 — 성명(B1)은 기존 mainInspector. 자격구분(C1)·자격번호(D1)는 표본이
  // '점검자경력수첩' 등을 남겨둔 **입력 칸**이다(HUB_INPUT_CELLS 주석의 '고정 라벨' 전제가
  // 틀렸었다 — 보고서!D18~D24가 개요!C2~C8을 수식으로 끌어간다, 2026-08-22 실측)
  { field: 'mainGrade',     sheet: HUB, cell: 'C1', labelCell: 'A1', label: '주된 점검인력' },
  { field: 'mainLicenseNo', sheet: HUB, cell: 'D1', labelCell: 'A1', label: '주된 점검인력' },
  // 보조 점검인력 7행 — 성명 B·자격구분 C·자격번호 D·참여기간 E. 보고서 18~24행이 전부
  // 수식으로 끌어가므로 허브 주입 + 폐포 전파로 간다. 라벨이 7행 동일이라 서식이 밀리면
  // 자가치유는 후보 복수로 실패한다(fail-loud — 재실측이 정답).
  ...[2, 3, 4, 5, 6, 7, 8].flatMap<Anchor>(n => [
    { field: `assist${n - 1}Name`,      sheet: HUB, cell: `B${n}`, labelCell: `A${n}`, label: '보조 점검인력' },
    { field: `assist${n - 1}Grade`,     sheet: HUB, cell: `C${n}`, labelCell: `A${n}`, label: '보조 점검인력' },
    { field: `assist${n - 1}LicenseNo`, sheet: HUB, cell: `D${n}`, labelCell: `A${n}`, label: '보조 점검인력' },
    { field: `assist${n - 1}Period`,    sheet: HUB, cell: `E${n}`, labelCell: `A${n}`, label: '보조 점검인력' },
  ]),
  // ── S7-1·S7-2: 보고서 1·2쪽 — 점검 구분·점검자·전자우편 동의·대표자 구분 ──
  // 전부 √ 위치가 든 **통문자열**(수식 아님)이라 buildWorkbookValues가 서식 원문
  // (_probe-s7-raw-literals 실측)과 자구 동일하게 조립한다. B9~B11은 자기 라벨 검증 —
  // 갑지가 갱신돼 √ 위치·문구가 바뀌면 생성이 붉어진다(조용한 오적용 금지).
  { field: 'reportTypeHeader',    sheet: '보고서', cell: 'A2',  labelCell: 'A3',  label: '※ [  ]에는 해당되는 곳에 √ 표기를 합니다.' },
  { field: 'inspectorOwnerRow',   sheet: '보고서', cell: 'B9',  labelCell: 'B9',  label: '[  ]관계인            (성명:' },
  { field: 'inspectorManagerRow', sheet: '보고서', cell: 'B10', labelCell: 'B10', label: '[  ]소방안전관리자    (성명:' },
  { field: 'inspectorCompanyRow', sheet: '보고서', cell: 'B11', labelCell: 'B11', label: '[√]소방시설관리업자  (업체명:' },
  { field: 'emailConsent',        sheet: '보고서', cell: 'C13', labelCell: 'C12', label: '「행정절차법」 제14조에 따라 정보통신망을 이용한 문서 송달에 동의합니다.' },
  { field: 'repRoleLine',         sheet: '정보',   cell: 'B5',  labelCell: 'A5',  label: '대표자' },
  // ── 정보 시트(별지 9호 2쪽) 나머지 √ 통문자열 12칸 ──
  // S7-2가 B5 하나만 고쳐, 같은 시트의 나머지는 **표본 고객의 답이 전 고객 문서에 인쇄**되고 있었다
  // (2026-08-23 F세대 판정 §1-②): 남의 대상물이 '다중이용업소 해당없음 √'·'철근콘크리트구조 √'·
  // '계단 직통 ( 1 개소 )'·'화재보험 가입기간 2024년 1월 1일~'로 찍혔다. 문장 안 판정 마크가
  // 살아남은 것과 **같은 부류**다(셀 값 전체가 마크가 아니라 문장이라 스크럽 축에도 안 걸렸다).
  // 값은 전부 assembleReport9 — PDF 2쪽(report9.ts:268~343)과 같은 해석기라 갈라질 수 없다(D-7).
  { field: 'mgrAppointLine',  sheet: '정보', cell: 'B8',  labelCell: 'A8',  label: '소방안전관리자' },
  { field: 'firePlanLine',    sheet: '정보', cell: 'B10', labelCell: 'A10', label: '소방계획서' },
  { field: 'prevInspectLine', sheet: '정보', cell: 'B11', labelCell: 'A11', label: '자체점검(전년도)' },
  { field: 'trainingLine',    sheet: '정보', cell: 'B12', labelCell: 'A12', label: '교육훈련' },
  { field: 'insuranceLine',   sheet: '정보', cell: 'B13', labelCell: 'A13', label: '화재보험' },
  // 다중이용업소 3열 — 라벨 칸이 A14 하나(B14:D14·E14:H14·I14:K14 병합 실측)라 셋이 공유한다.
  // 자가치유는 라벨 '다중이용업소현황'이 유일하므로 셋 다 각자의 오프셋으로 따라 옮겨진다
  { field: 'multiUseCol1',    sheet: '정보', cell: 'B14', labelCell: 'A14', label: '다중이용업소현황' },
  { field: 'multiUseCol2',    sheet: '정보', cell: 'E14', labelCell: 'A14', label: '다중이용업소현황' },
  { field: 'multiUseCol3',    sheet: '정보', cell: 'I14', labelCell: 'A14', label: '다중이용업소현황' },
  { field: 'structureLine',   sheet: '정보', cell: 'B19', labelCell: 'A19', label: '건축물구조' },
  { field: 'roofLine',        sheet: '정보', cell: 'B20', labelCell: 'A20', label: '지붕구조' },
  { field: 'stairsLine',      sheet: '정보', cell: 'B21', labelCell: 'A21', label: '계단' },
  { field: 'elevatorLine',    sheet: '정보', cell: 'B22', labelCell: 'A22', label: '승강기' },
  { field: 'parkingLine',     sheet: '정보', cell: 'B23', labelCell: 'A23', label: '주차장' },
  // ── 다수동일때 시트(2·3·4동 건축물 정보 3블록) — **빈 서식으로 상시 덮는다** ──
  // 이 시트는 코드가 한 번도 언급하지 않아(grep 0) 손 안 댄 채 전 고객에게 나갔고, 숫자 칸은
  // 이미 공란인데 **√ 마크만 표본 답이 남아** 있었다(2026-08-24 실측: 콘크리트구조·기타 지붕·
  // 직통 ( 1 개소 )·옥외 ×3블록 = 12칸). 정보 12칸과 같은 부류이고, 숫자는 비웠는데 마크는
  // 놓쳤다는 점까지 판정 마크 결함과 같다.
  // ERP는 이 파이프라인에서 **1동(활성·최고참)만** 해석하므로 2·3·4동 값은 없다 — 그러니
  // 채우는 것이 아니라 **비운다**: 서식 원문의 마크를 전부 `[  ]`로, 개소 슬롯을 공란으로.
  // 값을 지어내지 않고(D-7), 용도(손으로 고쳐 쓰기)에 맞는 백지 서식이 된다.
  // 이미 공란인 승강기 행도 앵커에 넣는다 — 그래야 이 시트의 마크 든 리터럴이 **전부** 덮여
  // 닫힌 덮개(test-xlsx-anchors [7]-c)에 예외가 남지 않는다.
  ...[0, 10, 20].flatMap<Anchor>(off => [
    { field: 'mbStructureBlank', sheet: '다수동일때', cell: `B${6 + off}`,  labelCell: `A${6 + off}`,  label: '건축물구조' },
    { field: 'mbRoofBlank',      sheet: '다수동일때', cell: `B${7 + off}`,  labelCell: `A${7 + off}`,  label: '지붕구조' },
    { field: 'mbStairsBlank',    sheet: '다수동일때', cell: `B${8 + off}`,  labelCell: `A${8 + off}`,  label: '계단' },
    { field: 'mbElevatorBlank',  sheet: '다수동일때', cell: `B${9 + off}`,  labelCell: `A${9 + off}`,  label: '승강기' },
    { field: 'mbParkingBlank',   sheet: '다수동일때', cell: `B${10 + off}`, labelCell: `A${10 + off}`, label: '주차장' },
  ]),
  // 보고서 점검인력 '주된' 행 — **유일하게 허브 미배선 리터럴**이었다(표본: 김흥준·소방시설관리사·
  // 제2005-60호 = 자사 대표이사라 PII 니들엔 안 걸렸지만, 담당은 건마다 다르다). 직접 앵커로
  // 상시 덮는다(값 또는 명시적 공란). 라벨 B17은 수식 캐시('주된 점검인력')지만 검증엔 충분하다.
  { field: 'mainInspector', sheet: '보고서', cell: 'C17', labelCell: 'B17', label: '주된 점검인력' },
  { field: 'mainGrade',     sheet: '보고서', cell: 'D17', labelCell: 'B17', label: '주된 점검인력' },
  { field: 'mainLicenseNo', sheet: '보고서', cell: 'E17', labelCell: 'B17', label: '주된 점검인력' },
  // ── 별지 4호 1쪽(현황) 설비 설치 체크 + 점검결과 — 좌표·라벨·코드는 xlsx-form4 단일 원천 ──
  //
  // 종전엔 이 쪽 전체가 미배선이라, 서식의 `IF(설치칸="[  ]","/","○")` 64칸이 **전 고객 문서에
  // `／`(해당없음)를 인쇄**했다(옥내소화전을 설치한 고객에게도). 캐시를 지우는 것으로는 못 막았다 —
  // LibreOffice가 열면서 재계산해 되살렸기 때문이다(xlsx-form4 머리 주석 참조).
  //
  // 설치칸은 대장 실값으로 `[√]`/`[  ]`를 **상시 덮고**(잔존 경로 없음), 점검결과칸은
  // **미설치일 때만** `／`를 찍고 설치면 비운다(양호는 점검한 사람이 쓴다).
  // dropFormula: 빌드가 이미 `<f>`를 없애지만(④g), 자산이 옛 빌드로 되돌아가도 런타임에서
  // 다시 끊기도록 양쪽에 건다 — 이 칸에 수식이 살아 있으면 뷰어가 ○를 만들어낸다.
  ...FORM4_ROWS.flatMap<Anchor>(r => [
    { field: form4InstallField(r), sheet: FORM4_SHEET, cell: r.cell, labelCell: r.labelCell, label: r.label },
    ...(r.verdictCell
      ? [{
          field: form4VerdictField(r), sheet: FORM4_SHEET, cell: r.verdictCell,
          labelCell: r.labelCell, label: r.label, dropFormula: true, keepFormulaWhenEmpty: true,
        }]
      : []),
  ]),
]

/** 개요 시트의 **모든 입력 칸** — 완전 덮어쓰기 불변식의 축 (S3-4).
 *  템플릿에는 이 칸 전부가 비어 있어야 하고(잔존 = 다른 고객 문서에 남의 값이 인쇄된다),
 *  런타임 주입은 앵커에 있는 칸만 채우며 나머지는 빈 채로 남는 것이 정상이다.
 *  좌표는 _probe-hub-layout.mjs 실측 — 라벨 칸(A열 등)은 여기 넣지 않는다.
 *  ⚠ C1~C8(자격구분)은 입력 칸이지만 여기 안 넣는다: 템플릿에 표본값('점검자경력수첩')이
 *  남아 있어 공란 검증 축이 성립하지 않고, 대신 앵커(mainGrade·assist*Grade)가 **상시 덮는다**
 *  (값 또는 명시적 공란) — 잔존 경로가 없다. 템플릿 재빌드 시 공란화 + 목록 편입이 정본. */
export const HUB_INPUT_CELLS: string[] = [
  // 점검인력 블록(1~8행): 이름(B)·자격번호(D)·참여기간(E)·일수(F1)
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
  'F1',
  // 9~23행 값 칸
  'B9', 'G9', 'I9', 'J9',
  'B10', 'D10', 'G10',
  'B11', 'D11',
  'B12', 'D12',
  'B13', 'D13',
  'B14', 'D14',
  // N15는 손으로 적은 목록에서 빠져 있었고 표본값('점검자경력수첩' — C1~C8 자격구분과 같은
  // 잔재)이 산출물까지 살아 나갔다(2026-08-23 독립 판정 실측, 참조 수식 0건). HUB_LABEL_CELLS와
  // 짝인 **닫힌 덮개** 검사가 이 부류를 앞으로는 빌드에서 잡는다
  'B15', 'D15', 'M15', 'N15', 'P15',
  'B16',
  'B17', 'D17',
  'B18', 'D18',
  'B19', 'D19',
  'B20', 'D20',
  'B21', 'B22', 'B23',
  'D21',   // 경사로 — 앵커(rampCount)가 상시 덮는다. 종전 미등재라 '0 개소'가 인쇄됐다
]

/** 개요 시트의 **서식 라벨 칸** — 값을 갖지만 입력 칸이 아닌 칸(S3-4 닫힌 덮개의 나머지 절반).
 *
 *  HUB_INPUT_CELLS만으로는 불변식이 **손으로 적은 목록 위의 전수**여서, 목록 어디에도 없는
 *  값 보유 칸은 아예 보이지 않는다 — 실제로 N15의 표본 잔재가 그 사각으로 산출물까지 나갔다
 *  (2026-08-23 독립 판정). 두 목록을 합치면 개요의 값 보유 비수식 칸이 **전부 분류**되므로,
 *  서식이 갱신돼 새 칸에 값이 생기면 어느 쪽에도 없어 빌드가 실패한다(분류를 강제한다).
 *  ※ 수식 셀은 폐포(D-9)가 담당하므로 이 덮개의 대상이 아니다. */
export const HUB_LABEL_CELLS: string[] = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
  'A9', 'C9', 'E9', 'H9', 'K9',
  'A10', 'C10', 'E10',
  'A11', 'C11', 'E11', 'G11',
  'A12', 'C12', 'E12', 'G12',
  'A13', 'C13', 'G13', 'H13',
  'A14', 'C14',
  'A15', 'C15',
  'A16',
  'A17', 'C17',
  'A18', 'C18',
  'A19', 'C19',
  'A20', 'C20',
  'A21', 'C21',
  'A22', 'D22',
  'A23', 'C23',
]

/** 체크 마크 표기 — **단일 원천**. 서식이 쓰는 괄호는 세 종류이고 빈 칸의 공백 수도 제각각이다:
 *  반각 `[√]`/`[  ]`, 전각 `［√］`/`［  ］`, 그리고 **공백 1칸짜리 `[ ]`**(현2!C43·현3!C39 등 실측).
 *
 *  ⚠ 종전엔 이 정규식이 `test-xlsx-anchors`와 `_probe-info-mutants` **두 파일에 복붙**돼 있었고
 *  둘 다 공백 1칸 `[ ]`를 빠뜨려, 덮개와 '덮개가 비어 있지 않다'는 자기검사가 **같은 사각을
 *  공유**했다(2026-08-24 독립 판정 — 어제 MARK 상수 사고와 같은 형태다). 보는 쪽이 여럿이면
 *  반드시 한 곳에서 가져다 쓸 것: 좁은 쪽이 결함을 통과시키는 게 아니라 **양쪽이 함께 못 본다**. */
export const MARK_RE = /\[\s*[√]?\s*\]|［\s*[√]?\s*］/
/** 체크된(√) 마크만 — 표본 고객의 '답'을 가려낸다. 빈 마크는 손으로 채우는 백지 서식이라 무해 */
export const MARK_CHECKED_RE = /\[\s*√\s*\]|［\s*√\s*］/

/** 점검 판정 마크 — **단일 원천**. 빌드의 소거(④g)와 검사(빌드 ⑥·test [7])가 **같은 집합**을
 *  봐야 한다. 종전엔 소거가 5종, 검사가 4종이라 라틴 `X`가 소거는 되는데 검사에는 안 걸렸다
 *  (2026-08-24 독립 판정 — 집합이 갈라지면 좁은 쪽이 조용히 통과시킨다). `●`는 이 서식에 없지만
 *  같은 자리를 채울 수 있는 글리프라 함께 금한다.
 *  ⚠ 도너(설비 점검표) 시트의 세로 3연속 `○/／/X` **범례는 서식 정본**이라 검사 대상이 아니다 —
 *  갑지 26시트에만 적용한다(실측: 도너 범례 111칸). */
export const VERDICT_MARKS = ['○', '×', 'X', '/', '／', '●'] as const

/** 표본 고객의 **점검 소견·실내 위치** — 백지 서식에 남의 판단이 있으면 안 된다.
 *  ⚠ '양호'·'적합'은 **넣지 않는다**: 서식 자체의 범례 라벨이다(실측 `현황!A3`·`대상물!A4`·
 *  도너 32칸 — 넣으면 전건 오탐). 니들을 넓히는 것과 축을 넓히는 것은 다르다.
 *  마크 축은 손목록을 없앴지만 이 축은 자유 텍스트라 니들이 불가피하다 — 대신 **단일 원천**으로
 *  두어 빌드와 테스트가 갈라지지 않게 한다. */
export const SAMPLE_OPINION_NEEDLES = ['이상없음', '별첨참조', '직원실'] as const

/** 표본 고객 흔적 니들 — 템플릿에도 산출물 캐시에도 남으면 안 되는 값(S1-1 스크럽 · S2-7 안전망).
 *  빌드 사후검증(build-workbook-template ⑥)·테스트(test-xlsx-anchors)·런타임 안전망(injectWorkbook
 *  forbidden)이 **이 한 목록**을 본다 — 축이 갈라지면 좁은 쪽이 결함을 통과시킨다(2026-08-21에
 *  PII 4종만 보다가 주소·연면적 잔존을 놓칠 뻔한 실측). 주소·연면적도 표본 고객을 특정하는 값이다 */
export const SCRUB_NEEDLES = ['정내과의원', '김미진', '010-7565-3271', '721227', '7565-3271', '용문로 376-1', '845.75']

/** 라벨 비교 정규화 — 서식의 라벨엔 장식 공백·콜론이 섞여 있다('상호 '·'직  위'·'대 표 자 :') */
const normLabel = (s: string) => s.replace(/[\s:：]/g, '')

export type AnchorCheck =
  | { ok: true; anchors: Anchor[]; healed: string[] }
  | { ok: false; failures: string[] }

/** 앵커 전수 검증 + 자가치유(S3-3) — 어긋난 채로는 주입을 시작하지 않는다(조용한 오적용 금지).
 *
 *  라벨이 어긋난 앵커는 같은 시트에서 그 라벨을 가진 셀을 재탐색한다. **유일하게** 찾히면
 *  원래의 라벨→값 오프셋(위임장 K6→N6처럼 옆 칸이 아닌 경우도 있다)을 유지해 좌표를 옮기고
 *  경고로 남긴다 — 서식에 행이 끼어들어도 살아남는다. 0곳이거나 여러 곳이면 치유하지 않고
 *  실패한다(추측 주입 금지). SheetJS **읽기**만 쓴다. */
export function validateAnchors(templateBytes: Uint8Array, anchors: Anchor[] = ANCHORS): AnchorCheck {
  const wb = XLSX.read(templateBytes, { cellStyles: false })
  const failures: string[] = []
  const healed: string[] = []
  const out: Anchor[] = []
  for (const a of anchors) {
    const ws = wb.Sheets[a.sheet]
    if (!ws) { failures.push(`${a.field}: 시트 '${a.sheet}' 없음`); continue }
    const lv = String(ws[a.labelCell]?.v ?? '')
    if (normLabel(lv) === normLabel(a.label)) { out.push(a); continue }
    // 자가치유 — 같은 시트에서 라벨 재탐색(원래 자리는 이미 불일치이므로 제외)
    const found = Object.keys(ws).filter(k =>
      !k.startsWith('!') && k !== a.labelCell &&
      normLabel(String((ws[k] as XLSX.CellObject).v ?? '')) === normLabel(a.label))
    if (found.length !== 1) {
      failures.push(
        `${a.field}: ${a.sheet}!${a.labelCell} 라벨 불일치 — 기대 '${a.label}', 실제 '${lv || '(빈칸)'}'` +
        (found.length ? ` (후보 ${found.length}곳이라 자가치유 불가: ${found.join(',')})` : ' (재탐색 0곳)'))
      continue
    }
    const oldLabel = XLSX.utils.decode_cell(a.labelCell)
    const oldCell = XLSX.utils.decode_cell(a.cell)
    const newLabel = XLSX.utils.decode_cell(found[0])
    const newCell = XLSX.utils.encode_cell({
      c: newLabel.c + (oldCell.c - oldLabel.c),
      r: newLabel.r + (oldCell.r - oldLabel.r),
    })
    out.push({ ...a, labelCell: found[0], cell: newCell })
    healed.push(`${a.field}: ${a.sheet}!${a.cell}→${newCell} (라벨 ${a.labelCell}→${found[0]})`)
  }
  return failures.length ? { ok: false, failures } : { ok: true, anchors: out, healed }
}
