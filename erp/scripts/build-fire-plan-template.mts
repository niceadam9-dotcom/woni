/** 소방계획서 엑셀 템플릿 자산화 — 소방계획서_42 S3.
 *
 *  법정 양식 `erp_goal/_Data/양식-placeholder.hwpx`(ZIP+XML)를 기계 파싱해
 *    · `erp/templates/fire-plan-workbook.xlsx`      (런타임이 값만 주입하는 골격)
 *    · `erp/src/lib/fire-plan-xlsx-manifest.json`   (시트·라벨·상자글자·토큰의 **단일 원천**)
 *  두 자산을 만든다. 갑지(`build-workbook-template.mts`)와 같은 자리의 역할이되, 원본이
 *  엑셀이 아니라 HWP라 LibreOffice 변환 대신 S1 파서 + S2 빌더를 쓴다.
 *
 *  실행: npx tsx scripts/build-fire-plan-template.mts
 *  게이트가 하나라도 붉으면 **파일을 쓰지 않고** exit 1 한다(S7-1).
 *
 *  범위는 **문서 전건**이다 — 제1장(1단계) + 제2·3장(2단계, 2026-09-08). Q-2가 예고한 대로
 *  파서·빌더·라우트·검증은 그대로이고 아래 지도만 늘었다. 2단계에서 처음 쓰인 갈래는 둘 —
 *  **중첩표**(서식 2.3)와 **세로 병합**(서식 2.4 개별임무카드 6장). 자세한 경위는 CHAPTER2 주석.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  parseTables, parseBorderFills, columnEdges, rowHeights, validateGrid,
  hwpToPt, hwpToPx, pxToColWidth,
  type HwpxTable, type HwpxCell, type HwpxBorderFill,
} from '../src/lib/hwpx-table.ts'
import {
  buildXlsx, cellRef, type BuildSheet, type BuildCell, type CellStyle,
} from '../src/lib/xlsx-build.ts'
import {
  scrubText, uncheckText, FIRE_PLAN_SCRUB_NEEDLES, FIRE_PLAN_MARK_CHECKED_RE,
} from '../src/lib/fire-plan-scrub.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const OUT_XLSX = resolve(HERE, '../templates/fire-plan-workbook.xlsx')
const OUT_MANIFEST = resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json')

/* ══════════════════════ §미세 격자 상수 (소방계획서_47 Q-9) ══════════════════════
 *  모든 표를 같은 N열에 투영한다 — 자세한 근거는 아래 `projectCols` 앞 주석. */
const FINE_N = 60
/** 🎯 **인쇄 글자 크기를 정하는 값**. 가로 1쪽에 맞추면 폰트가 약분되고
 *  `쪽폭 ÷ (열 수 × 열 폭)`만 남는다 — 실측 최적 1.8(2.2는 축소돼 작아지고, 1.1은 줄바꿈). */
const FINE_COL_W = 1.8

/* ══════════════════════ 제1장 시트 지도 ══════════════════════
 *
 *  S3-1은 **1 표 = 1 시트**다. 엑셀은 시트당 열 격자가 하나인데 이 양식의 colCnt는 1~30으로
 *  요동친다 — 장별로 묶으면 열 경계 합집합이 5열 표를 수십 조각으로 쪼개 그 칸에 타이핑을
 *  못 하게 만든다. 1쪽=1시트도 불가하다(서식 1.11의 하위표 5개가 30/10/6/17/7).
 *  실측으로도 제1장에는 **열 경계 벡터가 같은 연속 표가 한 쌍도 없다**(있는 곳은 제2장 #55~#60).
 *
 *  ⚠ 지도를 손으로 적되 **빌드가 파싱 결과와 대조**한다 — 표 번호·행열 수·배너 서식번호가
 *    하나라도 어긋나면 실패한다. 양식이 개정되면 조용히 다른 서식이 나가는 대신 빌드가 선다.
 */
type Part =
  | { kind: 'banner'; table: number }
  | { kind: 'grid'; table: number; rc: [number, number] }

interface SectionDef {
  /** 시트명 — S3-2 규약(31자·금지문자 없음·중복 없음). 앵커·라우트·검증의 키 */
  name: string
  /** 서식 번호. 표지·개정이력은 번호가 없다 */
  no: string | null
  /** 문서 등장 순서 그대로 */
  parts: Part[]
}

const CHAPTER1: SectionDef[] = [
  // 표지 — 배너가 없다. #1(제목)이 #0(용도 상자) **뒤에** 오는 것은 원문 순서 그대로다.
  { name: '표지', no: null, parts: [{ kind: 'grid', table: 0, rc: [2, 4] }, { kind: 'banner', table: 1 }] },
  { name: '개정이력', no: null, parts: [{ kind: 'grid', table: 2, rc: [12, 6] }] },

  { name: '1.1 건축물 일반현황', no: '1.1', parts: [{ kind: 'banner', table: 3 }, { kind: 'banner', table: 4 }, { kind: 'grid', table: 5, rc: [25, 10] }] },

  { name: '1.2.1 구역별 세부현황', no: '1.2.1', parts: [{ kind: 'banner', table: 6 }, { kind: 'grid', table: 7, rc: [21, 12] }] },
  { name: '1.2.2 화재취약장소 현황', no: '1.2.2', parts: [{ kind: 'grid', table: 8, rc: [21, 6] }] },

  { name: '1.3 건축물 위치·운영현황', no: '1.3', parts: [{ kind: 'banner', table: 9 }, { kind: 'grid', table: 10, rc: [4, 1] }] },
  { name: '1.3 소방차 진입경로', no: '1.3', parts: [{ kind: 'grid', table: 11, rc: [7, 9] }] },

  { name: '1.4 소방시설 현황', no: '1.4', parts: [{ kind: 'banner', table: 12 }, { kind: 'grid', table: 13, rc: [25, 5] }] },

  { name: '1.5.1 피난·방화시설 현황', no: '1.5.1', parts: [{ kind: 'banner', table: 14 }, { kind: 'grid', table: 15, rc: [24, 12] }] },
  { name: '1.5.2 방화·제연구획 현황도', no: '1.5.2', parts: [{ kind: 'grid', table: 16, rc: [6, 9] }] },

  { name: '1.6.1 기타시설 일반현황', no: '1.6.1', parts: [{ kind: 'banner', table: 17 }, { kind: 'grid', table: 18, rc: [19, 8] }] },

  { name: '1.7.1 소방안전관리자 선임현황', no: '1.7.1', parts: [{ kind: 'banner', table: 19 }, { kind: 'grid', table: 20, rc: [18, 6] }] },

  { name: '1.8 업무대행 현황', no: '1.8', parts: [{ kind: 'banner', table: 21 }, { kind: 'grid', table: 22, rc: [15, 7] }] },

  // ⚠ 서식 1.9는 **배너 없는 표**다(F-3) — 표 대조 95/95이므로 누락이 아니다.
  //   번호는 표 자신이 들고 있다(#23 '1.9.3'). #24는 번호가 없어 지도에 적어 준다.
  { name: '1.9.3 입주사 현황', no: '1.9.3', parts: [{ kind: 'grid', table: 23, rc: [17, 6] }] },
  { name: '1.9 자위소방대 현황', no: '1.9', parts: [{ kind: 'grid', table: 24, rc: [26, 23] }] },

  { name: '1.10.1 연간 점검 계획', no: '1.10.1', parts: [{ kind: 'banner', table: 25 }, { kind: 'grid', table: 26, rc: [25, 16] }] },
  { name: '1.10.3 다중이용업소 관리현황', no: '1.10.3', parts: [{ kind: 'grid', table: 27, rc: [30, 15] }] },
  { name: '1.10.4 화재·비화재보 이력', no: '1.10.4', parts: [{ kind: 'grid', table: 28, rc: [17, 7] }] },

  { name: '1.11.1 소방훈련·교육 연간계획', no: '1.11.1', parts: [{ kind: 'banner', table: 29 }, { kind: 'grid', table: 30, rc: [16, 30] }] },
  { name: '1.11.2 소방훈련·교육 세부계획', no: '1.11.2', parts: [{ kind: 'grid', table: 31, rc: [19, 10] }] },
  { name: '1.11.3 소방훈련 시나리오', no: '1.11.3', parts: [{ kind: 'grid', table: 32, rc: [9, 6] }] },
  // 별지 제28호서식은 앞쪽·뒷쪽 두 표다. 열 격자가 17 vs 7로 달라 한 시트에 못 넣는다.
  { name: '1.11.4 훈련·교육 결과기록부', no: '1.11.4', parts: [{ kind: 'grid', table: 33, rc: [25, 17] }] },
  { name: '1.11.4 결과기록부 뒷쪽', no: '1.11.4', parts: [{ kind: 'grid', table: 34, rc: [16, 7] }] },

  { name: '1.12.1 화기취급작업 현황', no: '1.12.1', parts: [{ kind: 'banner', table: 35 }, { kind: 'grid', table: 36, rc: [19, 7] }] },

  { name: '1.13 소방시설 공사·정비 기록', no: '1.13', parts: [{ kind: 'banner', table: 37 }, { kind: 'grid', table: 38, rc: [15, 6] }] },

  { name: '1.14.1 화재예방 및 홍보 계획', no: '1.14.1', parts: [{ kind: 'banner', table: 39 }, { kind: 'grid', table: 40, rc: [16, 15] }] },
  { name: '1.14.2 화재예방 및 홍보 결과', no: '1.14.2', parts: [{ kind: 'grid', table: 41, rc: [5, 4] }] },

  { name: '1.15 피해 복구', no: '1.15', parts: [{ kind: 'banner', table: 42 }, { kind: 'grid', table: 43, rc: [17, 9] }] },
]

/* ══════════════════════ 제2장 시트 지도 (표 #44..#79 · 36표) ══════════════════════
 *
 *  2단계(2026-09-08). 파서·빌더·라우트·검증은 그대로이고 지도만 늘었다 — Q-2가 예고한 대로다.
 *  다만 제1장에 없던 갈래 둘이 여기서 처음 나온다:
 *
 *   · **중첩표**(S1-1이 미리 대응해 둔 자리) — 서식 2.3의 조직도(#51)와 임무(#53)는 각각
 *     머리 블록 표(#50 3x2 · #52 2x1) **안에** 들어 있다. 머리 블록을 배너로 얹고 중첩표를
 *     격자로 쓴다. 조직도 18열과 임무 16열은 격자가 달라 한 시트에 못 넣는다(1.11.4 앞/뒷쪽과 같다).
 *   · **세로 병합**(S3-1이 예고한 유일한 자리) — 개별임무카드 #55~#60은 열 경계 벡터가
 *     **완전히 같은 6표**다. 6시트로 쪼개면 같은 서식이 여섯 장 따로 인쇄되므로 한 시트에 쌓는다.
 *
 *  ⚠ 서식 **2.7이 없다**. #65 배너가 `서식 2.8`이고 2.7 배너는 문서에 존재하지 않는다 —
 *    누락이 아니라 양식이 그렇다(표 95/95 대조가 이미 섰다). 없는 번호를 지어내지 않는다.
 */
const CHAPTER2: SectionDef[] = [
  // 장 제목 #44 는 이 장 첫 시트의 배너로 얹는다(제1장의 1.1이 #3·#4 두 배너를 이고 있는 것과 같다)
  { name: '2.1 자위소방대 일반현황', no: '2.1', parts: [{ kind: 'banner', table: 44 }, { kind: 'banner', table: 45 }, { kind: 'grid', table: 46, rc: [27, 17] }] },
  { name: '2.2 자위소방대 편성표', no: '2.2', parts: [{ kind: 'banner', table: 47 }, { kind: 'grid', table: 48, rc: [35, 8] }] },

  // 서식 2.3 — 머리 블록(#50·#52)이 배너, 실제 격자는 그 안의 중첩표(#51·#53)
  { name: '2.3 조직도', no: '2.3', parts: [{ kind: 'banner', table: 49 }, { kind: 'banner', table: 50 }, { kind: 'grid', table: 51, rc: [14, 18] }] },
  { name: '2.3 임무', no: '2.3', parts: [{ kind: 'banner', table: 52 }, { kind: 'grid', table: 53, rc: [12, 16] }] },

  // 서식 2.4 — 개별임무카드 6장을 한 시트에 세로로 쌓는다(열 경계 동일)
  {
    name: '2.4 개별임무카드', no: '2.4',
    parts: [
      { kind: 'banner', table: 54 },
      { kind: 'grid', table: 55, rc: [11, 5] }, { kind: 'grid', table: 56, rc: [11, 5] },
      { kind: 'grid', table: 57, rc: [11, 5] }, { kind: 'grid', table: 58, rc: [11, 5] },
      { kind: 'grid', table: 59, rc: [11, 5] }, { kind: 'grid', table: 60, rc: [11, 5] },
    ],
  },

  { name: '2.5 지휘통제팀', no: '2.5', parts: [{ kind: 'banner', table: 61 }, { kind: 'grid', table: 62, rc: [49, 6] }] },
  { name: '2.6 비상연락팀(지휘반)', no: '2.6', parts: [{ kind: 'banner', table: 63 }, { kind: 'grid', table: 64, rc: [24, 9] }] },
  { name: '2.8 비상상황별 연락방법', no: '2.8', parts: [{ kind: 'banner', table: 65 }, { kind: 'grid', table: 66, rc: [10, 6] }] },
  { name: '2.9 초기소화팀(진압반)', no: '2.9', parts: [{ kind: 'banner', table: 67 }, { kind: 'grid', table: 68, rc: [23, 9] }] },
  { name: '2.10 피난유도팀', no: '2.10', parts: [{ kind: 'banner', table: 69 }, { kind: 'grid', table: 70, rc: [23, 10] }] },
  { name: '2.11 응급구조팀', no: '2.11', parts: [{ kind: 'banner', table: 71 }, { kind: 'grid', table: 72, rc: [21, 10] }] },
  { name: '2.12 방호안전팀', no: '2.12', parts: [{ kind: 'banner', table: 73 }, { kind: 'grid', table: 74, rc: [25, 14] }] },
  { name: '2.13 초기대응체계', no: '2.13', parts: [{ kind: 'banner', table: 75 }, { kind: 'grid', table: 76, rc: [24, 12] }] },

  // 별지 서식이라 앞쪽·뒷쪽 두 표다(1.11.4와 같은 부류 — 15열 vs 9열이라 못 합친다)
  { name: '2.14 교육·훈련 결과기록부', no: '2.14', parts: [{ kind: 'banner', table: 77 }, { kind: 'grid', table: 78, rc: [31, 15] }] },
  { name: '2.14 결과기록부 뒷쪽', no: '2.14', parts: [{ kind: 'grid', table: 79, rc: [27, 9] }] },
]

/* ══════════════════════ 제3장 시트 지도 (표 #80..#94 · 15표) ══════════════════════ */
const CHAPTER3: SectionDef[] = [
  { name: '3.1 피난시설 일반현황', no: '3.1', parts: [{ kind: 'banner', table: 80 }, { kind: 'banner', table: 81 }, { kind: 'grid', table: 82, rc: [19, 13] }] },
  { name: '3.2 피난시설 세부현황', no: '3.2', parts: [{ kind: 'banner', table: 83 }, { kind: 'grid', table: 84, rc: [14, 7] }] },
  { name: '3.3 피난인원현황', no: '3.3', parts: [{ kind: 'banner', table: 85 }, { kind: 'grid', table: 86, rc: [25, 9] }] },
  { name: '3.4 피난유도 절차·경로', no: '3.4', parts: [{ kind: 'banner', table: 87 }, { kind: 'grid', table: 88, rc: [15, 11] }] },
  { name: '3.5 피난약자 현황·계획', no: '3.5', parts: [{ kind: 'banner', table: 89 }, { kind: 'grid', table: 90, rc: [21, 17] }] },
  { name: '3.6 피난약자 유형별 방법', no: '3.6', parts: [{ kind: 'banner', table: 91 }, { kind: 'grid', table: 92, rc: [6, 3] }] },
  { name: '3.7 피난기구·유도장비 현황', no: '3.7', parts: [{ kind: 'banner', table: 93 }, { kind: 'grid', table: 94, rc: [16, 6] }] },
]

/** 전 장 — 지도는 장별로 적되 빌드는 한 목록으로 돈다(갈라 두면 한쪽만 낡는다) */
const SECTIONS: SectionDef[] = [...CHAPTER1, ...CHAPTER2, ...CHAPTER3]

/* ══════════════════════ 표본 답 비우기 (S7-3 강순기 대조가 찾아낸 것) ══════════════════════
 *
 *  스크럽(S3-3)은 **PII**를, 체크 덮개(S3-4)는 **■**를 잡는다. 그 둘을 통과하고도 남는 부류가
 *  있다 — 표본 고객이 손으로 적은 **자유 텍스트 답**이다. 육안으로는 서식의 일부처럼 보여서
 *  안 잡힌다. 이걸 찾아낸 것이 강순기 대조다(같은 칸의 두 문서 값이 다르면 그 칸은 값 칸이다):
 *
 *    표지 용도       양식 '☐ 복합건축물'  vs 강순기 '☐ 근린생활시설'
 *    개정이력 일자   양식 '25.1.14'       vs 강순기 '25.01.01'
 *    1.2.2 위치      양식 '각 세대 보일러실' vs 강순기 '1층 보일러실'
 *
 *  ⚠ **손목록이라 다음 표본 답을 못 본다.** 그 구멍을 메우는 것이 목록이 아니라
 *    `_probe-42-gangsungi.mts` 자체다 — 양식이 갱신되면 그 대조가 먼저 붉어진다.
 *
 *  ⚠ 비우지 **않기로** 한 것들: 1.11.2 시나리오·훈련계획·교보재, 1.11.3 시나리오 본문 등은
 *    승진소방이 고객 간에 재사용하는 **표준 문구**이고, D-4가 '강순기와 같이'이므로 기본값으로
 *    남기는 편이 낫다. 지우면 사용자가 매번 다시 써야 한다. 이건 사용자 확인이 필요한 축이라
 *    S7-3 보고서에 남긴다(조용히 한쪽을 택하지 않는다 — Q-4 규약).
 */
interface BlankCell { table: number; row: number; col: number; why: string; keep?: string }

const SAMPLE_ANSWER_CELLS: BlankCell[] = [
  // 표지 용도 — 상자는 남기고 **라벨만** 지운다. 값 축이 `☐ {용도}`로 다시 조립한다(앵커 cover_purpose)
  { table: 0, row: 0, col: 1, why: '표지 용도 = 고객별 값(강순기는 근린생활시설)', keep: 'box' },
  // 개정이력 1행 — 날짜·내용 모두 표본. 틀린 날짜가 인쇄되는 것이 공란보다 나쁘다
  { table: 2, row: 1, col: 1, why: '개정이력 일자 = 표본(25.1.14). 개정이력 배선은 2단계' },
  { table: 2, row: 1, col: 2, why: "개정이력 내용 = 표본('2025년 …' 연도 고정)" },
  // 1.2.2 화재취약장소 위치 — 소방 문서에서 틀린 위치는 안전 문제다
  { table: 8, row: 3, col: 1, why: '보일러실 위치 = 고객별 값' },
  { table: 8, row: 7, col: 1, why: '주방 위치 = 고객별 값' },
  // ⚠ 이 칸은 강순기와 **우연히 같아서** 대조에 안 걸렸다. 역할이 같으므로 함께 비운다 —
  //   대조가 못 보는 자리를 사람이 메우는 쪽이고, 그래서 이유를 적어 둔다.
  { table: 8, row: 11, col: 1, why: '전기실 위치 = 고객별 값(강순기와 우연히 일치해 대조엔 안 걸렸다)' },
  // 1.11.2 시나리오 — 양식 '2층 주방에서…' vs 강순기 '2층 화재발생…'. 두 고객의 답이 다르므로
  // **값 칸**이다(라벨이면 같아야 한다). 같은 표의 훈련계획·교보재·참여대상은 양쪽이 일치해
  // 공용 표준 문구로 보고 **남겼다** — 그 판단은 사용자 확인이 필요해 Q-5로 올렸다.
  { table: 31, row: 12, col: 1, why: '소방훈련 시나리오 = 고객별 값(강순기와 문구가 다르다)' },
]

const blankAt = new Map<string, BlankCell>(SAMPLE_ANSWER_CELLS.map(b => [`${b.table}:${b.row}:${b.col}`, b]))

/* ══════════════════════ 표본 답 잔재 — **규칙 축**(2026-09-08) ══════════════════════
 *
 *  위 `SAMPLE_ANSWER_CELLS`는 강순기 대조가 잡아 준 손목록이다. 그 대조에는 구조적 사각이 있다:
 *  판별식이 **'두 문서의 값이 다르면 값 칸'** 이라, **두 문서가 같은 답을 쓴 칸은 영영 못 본다**
 *  (양식과 강순기가 둘 다 승진소방 문서라 그런 칸이 실제로 있다).
 *
 *  그래서 대조에 기대지 않는 **다른 축**을 하나 더 세운다 — 문서 자신의 모양만 본다:
 *
 *    R1  「공백으로 패딩된 괄호」 안의 숫자 — 양식은 채우라고 빈칸을 만들 뿐, 거기 숫자를
 *        미리 적어 두지 않는다.  `☐ 매월 (   1   일)` · `[   25 년 제  1 차]`
 *    R2  「기타(…)」 괄호 안의 내용 — '기타' 뒤 괄호는 정의상 자유 기재란이다.
 *        `□ 기타 (   옥상       )` · `□ 기타(  상시 부착        )`
 *    R3  칸 전체가 「숫자+단위」인 칸 — 빈 템플릿에 홀로 선 `100명`은 서식이 아니라 답이다.
 *        (1.1 인원현황: 근무·거주 칸은 ` 명`인데 최대수용인원만 `100명`이었다)
 *
 *  ⭐ 세 규칙 다 **법정 자구는 건드리지 않는다** — 숫자·자유 텍스트만 걷어내고 단위·조사는 남긴다.
 *    `☐ 교대직 (    조   교대)`(숫자 없음)나 `□ 합동훈련 (참여기관 :     )`(패딩만)은 그대로 통과한다.
 *
 *  🚨 각 규칙의 적중 수를 **정확히 단언**한다(아래 EXPECT). 좌표가 밀리거나 양식이 개정돼
 *    0건이 되면 '깨끗하다'가 아니라 **정체 판정**으로 붉어져야 한다 — 0에서 공허 통과하는
 *    개수 단언은 검사가 아니다.
 *
 *  ⭐ 실측 6칸(2026-09-08) — 전부 표본 고객의 답이고, **강순기 대조는 이 중 하나도 못 잡았다**:
 *      1.1!J19      `100명`                  최대수용인원(형제 칸은 ` 명`인데 이 칸만 값이 있었다)
 *      1.5.1!C11    `기타 (   옥상       )`   피난기구 설치 기타 위치
 *      1.5.1!J13    `1 개소`                  개소 수
 *      1.10.1!F17   `매월 (   1   일)`        일상점검 실시일
 *      1.11.2!A3    `[   25 년 제  1 차]`     훈련 연도·회차
 *      1.14.1!J17   `기타(  상시 부착     )`   홍보방법 기타
 */
const FILL_IN_EXPECT = { padded: 2, etc: 2, unit: 2 }

const PADDED_GROUP_RE = /([([])([^)\]]*)([)\]])/g
const UNIT_ONLY_RE = /^\s*\d[\d,.]*\s*(명|대|개소|㎡|천원)\s*$/

const fillIn = { padded: 0, etc: 0, unit: 0 }
/** 걷어낸 칸의 전/후 — **콘솔에만** 찍는다. manifest에 원문을 적으면 지우려던 답이 자산으로
 *  되돌아온다(F-17에서 스크럽 기록이 니들을 11벌 되살렸던 것과 같은 함정). */
const fillInLog: string[] = []

/** 표본 답 잔재를 규칙으로 걷어낸다. 반환은 [정리된 글, 적용된 규칙들] */
function stripFillIns(raw: string): [string, string[]] {
  const applied: string[] = []
  let text = raw

  // R3 — 칸 전체가 숫자+단위
  const um = UNIT_ONLY_RE.exec(text)
  if (um) {
    text = um[1]
    fillIn.unit++
    applied.push('unit')
    return [text, applied]
  }

  text = text.replace(PADDED_GROUP_RE, (whole, open: string, inside: string, close: string) => {
    // R2 — 「기타(…)」: 여는 괄호 바로 앞이 '기타'면 안쪽은 통째로 자유 기재란이다
    const at = raw.indexOf(whole)
    const before = raw.slice(0, at).trimEnd()
    if (before.endsWith('기타') && inside.trim() !== '') {
      fillIn.etc++
      applied.push('etc')
      return `${open}${' '.repeat(inside.length)}${close}`
    }
    // R1 — 패딩된 빈칸 안의 숫자만
    if (!/\s{2,}/.test(inside) || !/\d/.test(inside)) return whole
    const cleaned = inside.replace(/\d[\d,.]*/g, m => ' '.repeat(m.length))
    if (cleaned === inside) return whole
    fillIn.padded++
    applied.push('padded')
    return `${open}${cleaned}${close}`
  })

  return [text, applied]
}

/* ══════════════════════ 게이트 수집기 ══════════════════════ */

const fails: string[] = []
const notes: string[] = []
const fail = (s: string) => { fails.push(s); console.log(`  ✗ ${s}`) }
const ok = (s: string) => console.log(`  · ${s}`)

/* ══════════════════════ ① 파싱 + 눈멂 가드(S3-5) ══════════════════════ */

console.log('① 양식 파싱')
const zip = await JSZip.loadAsync(readFileSync(HWPX))
const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
const headerXml = await zip.file('Contents/header.xml')!.async('string')
const tables = parseTables(sectionXml)
const { fills, unknownBorderTypes } = parseBorderFills(headerXml)

const cellTotal = tables.reduce((s, t) => s + t.cells.length, 0)
const mergeTotalDoc = tables.reduce(
  (s, t) => s + t.cells.filter(c => c.rowSpan > 1 || c.colSpan > 1).length, 0)

// 🚨 S3-5 눈멂 가드 — **먼저** 단언한다. 0을 훑고 '잔재 0'이라 말하면 항진명제다.
if (tables.length < 95) fail(`눈멂 가드: 표 ${tables.length} < 95`)
else ok(`표 ${tables.length}`)
if (cellTotal < 4000) fail(`눈멂 가드: 셀 ${cellTotal} < 4000`)
else ok(`셀 ${cellTotal}`)
if (mergeTotalDoc < 1) fail(`눈멂 가드: 병합 ${mergeTotalDoc} < 1`)
else ok(`병합 ${mergeTotalDoc}`)
if (unknownBorderTypes.length) fail(`미지 테두리 조합 ${unknownBorderTypes.length}종: ${unknownBorderTypes.join(' · ')}`)
else ok(`borderFill ${fills.size}종 · 미지 0`)

// 격자 정합(S1-3) — 여기가 통과해야 병합이 원본과 같아진다
{
  const problems = tables.flatMap(validateGrid)
  if (problems.length) fail(`격자 문제 ${problems.length}건: ${problems.slice(0, 3).map(p => `#${p.tableIndex} ${p.kind} ${p.detail}`).join(' / ')}`)
  else ok('격자 정합 95표 전건 문제 0')
}

/* ══════════════════════ ② 지도 대조 ══════════════════════ */

console.log('② 시트 지도 ↔ 파싱 결과 대조')
const ch2At = tables.findIndex(t => t.rowCnt === 1 && t.cells.some(c => /^제\s*2\s*장/.test(c.text.trim())))
if (ch2At < 0) fail('제2장 배너를 못 찾았다 — 제1장 범위를 정할 수 없다')
else ok(`제1장 = 표 #0..#${ch2At - 1} (제2장 배너 #${ch2At})`)

{
  const used = new Map<number, string>()
  for (const sec of SECTIONS) {
    for (const p of sec.parts) {
      const prev = used.get(p.table)
      if (prev) fail(`표 #${p.table} 를 두 시트가 쓴다 — '${prev}' · '${sec.name}'`)
      used.set(p.table, sec.name)
      const t = tables[p.table]
      if (!t) { fail(`표 #${p.table} 가 없다 (${sec.name})`); continue }
      if (p.kind === 'banner') {
        // ⚠ 2단계에서 규약이 넓어졌다 — 서식 2.3의 머리 블록(#50 3x2 · #52 2x1)은 여러 행이다.
        //   행 수를 1로 못 박는 대신 **한 줄로 접을 만큼 작은가**(≤3행)를 묻는다. 큰 표를
        //   실수로 배너에 얹으면 내용이 통째로 한 칸에 뭉개지므로 상한은 그대로 필요하다.
        if (t.rowCnt > 3) fail(`배너 #${p.table} 가 너무 크다 (${t.rowCnt}행) — ${sec.name}`)
        const m = /^서식\s*([\d.]+)/.exec(t.cells.map(c => c.text.trim()).find(Boolean) ?? '')
        if (m && sec.no && !sec.no.startsWith(m[1])) {
          fail(`배너 #${p.table} 의 서식번호 '${m[1]}' 가 시트 번호 '${sec.no}' 와 다르다 — ${sec.name}`)
        }
      } else if (t.rowCnt !== p.rc[0] || t.colCnt !== p.rc[1]) {
        fail(`격자 #${p.table} 치수 ${t.rowCnt}x${t.colCnt} ≠ 지도 ${p.rc[0]}x${p.rc[1]} — ${sec.name}`)
      }
    }
  }
  // 🚨 2단계부터는 **문서 전건**을 요구한다 — 제1장만 덮는 종전 단언은 제2·3장이 통째로
  //   빠져도 초록이었다(범위가 곧 분모였다). 이제 95표 중 하나라도 지도에 없으면 붉어진다.
  const missing = tables.map((_, i) => i).filter(i => !used.has(i))
  if (missing.length) fail(`지도에 없는 표 ${missing.length}개: ${missing.slice(0, 12).join(',')}`)
  else ok(`표 ${tables.length}개 전건을 ${SECTIONS.length}시트가 빠짐없이 한 번씩 덮는다`)
  if (ch2At >= 0) ok(`제1장 ${CHAPTER1.length}시트 · 제2장 ${CHAPTER2.length} · 제3장 ${CHAPTER3.length}`)
}

// 시트명 규약(S3-2) — buildXlsx도 막지만 여기서 먼저 이유를 붙여 세운다
{
  const seen = new Set<string>()
  for (const sec of SECTIONS) {
    if (sec.name.length > 31) fail(`시트명 31자 초과(${sec.name.length}) — ${sec.name}`)
    if (/[:\\/?*[\]]/.test(sec.name)) fail(`시트명 금지문자 — ${sec.name}`)
    if (seen.has(sec.name)) fail(`시트명 중복 — ${sec.name}`)
    seen.add(sec.name)
    if (sec.no && !sec.name.startsWith(sec.no)) fail(`시트명이 서식번호로 시작하지 않는다 — ${sec.name}`)
  }
  ok(`시트명 ${seen.size}종 규약 통과`)
}

/* ══════════════════════ ③ 빈 상자 글자 판정 (F-6) ══════════════════════
 *
 *  원본이 `□`(449) 와 `☐`(212) 를 **섞어 쓴다**. 전역 어휘를 강제하면 어느 쪽을 골라도
 *  최소 212칸 또는 449칸이 원본과 갈라진다. 그래서 셀마다 원본 글자를 manifest에 적는다.
 *
 *  문제는 **체크된 칸(`■`)** 이다 — 표본 고객의 답이 원본 빈 글자를 덮어써서 그 칸이 원래
 *  `□`였는지 `☐`였는지 문서에 남아 있지 않다. 근처가 답이다: 같은 줄의 형제 상자들이 한
 *  어휘를 쓰고(예: `■ 승용 / ☐ 비상용 / ☐ 피난용`), 같은 열의 형제도 그렇다
 *  (`■소화기구 / □ 옥내소화전설비 / □ 스프링클러설비`). 행 → 열 → 표 → 전역 순으로 묻고,
 *  **어느 축에서 답을 얻었는지 manifest에 남긴다**(추측을 사실처럼 적지 않는다).
 */
const BOX_RE = /[□☐]/g

/** ⚠ 안내문 `※ □에는 해당되는 곳에 √표를 합니다.` 의 `□`는 **표의 어휘가 아니다** — 실측으로
 *  서식 1.1은 본문에 `☐`를 쓰면서 안내문엔 `□`를 쓴다. 인구조사에서 빼지 않으면 이 한 문장이
 *  그 행 전체의 어휘를 뒤집는다(실제로 `■ 대상명 :`을 `□ 대상명 :`으로 만들었다). */
const GUIDE_RE = /※.*√\s*표/

function boxCensus(texts: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of texts) {
    if (GUIDE_RE.test(t)) continue
    BOX_RE.lastIndex = 0
    for (const g of t.match(BOX_RE) ?? []) m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}
const dominant = (m: Map<string, number>): string | null => {
  let best: string | null = null
  let n = 0
  for (const [g, c] of m) if (c > n) { best = g; n = c }
  return best
}

interface BoxOracle {
  /**
   * (row,col) → 원본 빈상자 글자 + 판정 축.
   *
   * `null`은 "이 `■`는 체크박스가 아니다"라는 뜻이다 — 같은 행에도 같은 열에도 형제 빈 상자가
   * 없다. **선택지 묶음은 형제가 있고 불릿은 혼자 선다.** 실측으로 이 자리에 걸리는 것은
   * `■ 대상명 :`(9개 표에 반복)과 `■ 화재의 예방…[별지 제28호서식]` 뿐이고, 둘 다 표본 고객의
   * 답이 아니라 **법정 서식의 불릿 글자**다. 빈 상자로 바꾸면 원본에 없던 선택지가 생긴다.
   */
  glyphFor(cell: HwpxCell): { glyph: string; axis: 'row' | 'col' } | null
}

function makeBoxOracle(t: HwpxTable): BoxOracle {
  const byRow = new Map<number, string[]>()
  const byCol = new Map<number, string[]>()
  for (const c of t.cells) {
    if (!c.text) continue
    ;(byRow.get(c.row) ?? byRow.set(c.row, []).get(c.row)!).push(c.text)
    ;(byCol.get(c.col) ?? byCol.set(c.col, []).get(c.col)!).push(c.text)
  }
  return {
    glyphFor(cell) {
      const r = dominant(boxCensus(byRow.get(cell.row) ?? []))
      if (r) return { glyph: r, axis: 'row' }
      const k = dominant(boxCensus(byCol.get(cell.col) ?? []))
      if (k) return { glyph: k, axis: 'col' }
      return null
    },
  }
}

/* ══════════════════════ ④ 시트 조립 ══════════════════════ */

const TOKEN_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g

interface SheetManifest {
  name: string
  no: string | null
  tables: number[]
  rows: number
  cols: number
  merges: number
  /** 배너 행(0-based 시트 행) — 전폭 병합된 제목 줄 */
  bannerRows: number[]
  /** 리터럴로 인쇄되는 법정 문구. 'A1' → 글 */
  labels: Record<string, string>
  /** F-6 — 셀별 원본 빈상자 글자('□' 또는 '☐') */
  boxes: Record<string, string>
  /** `■`를 되돌린 칸 → 어느 축(행/열)에서 원본 글자를 얻었는가. 추측을 사실처럼 적지 않는다 */
  restoredBoxes: Record<string, string>
  /** 형제 빈 상자가 없어 **체크가 아니라 불릿**으로 판정한 `■` 칸 — 법정 자구라 그대로 둔다 */
  bulletCells: Record<string, string>
  /** 앵커 씨앗 — 'A1' → 원본 템플릿 문자열(`{{token}}` 포함). 셀은 template에서 **공란**이다 */
  tokenCells: Record<string, string>
  /** 스크럽된 칸 → 지운 니들 */
  scrubbed: Record<string, string[]>
  /** 표본 답 잔재를 규칙으로 걷은 칸 → 적용된 규칙(padded·etc·unit) */
  fillInStripped: Record<string, string>
  /** 표본 고객의 자유 텍스트 답이라 비운 칸 → 이유(S7-3 강순기 대조가 찾아냈다) */
  sampleBlanked: Record<string, string>
  /** 0열이 1,2,3… 으로 이어지는 구간 — 반복 행 예산의 파생 원천(S4-3) */
  numberedRuns: { startRow: number; rows: number }[]
  /** 각 격자 표가 이 시트의 **몇 번째 행에서 시작하는가**(0-based) — 세로로 쌓인 시트
   *  (2.4 개별임무카드 6장)에서 원본 표 좌표 ↔ 시트 좌표를 잇는 유일한 사실.
   *  🚨 이걸 안 실으면 대조기가 기하를 **추측**한다 — 실제로 강순기 대조가 카드 6장을 전부
   *  첫 장 자리로 읽어 멀쩡한 서식을 '자구 불일치 26건'으로 신고했다(2026-09-08). */
  gridTops: { table: number; top: number; rows: number; cols: number[] }[]
}

function styleOf(bf: HwpxBorderFill | undefined): CellStyle {
  return {
    left: bf?.left ?? 'none', right: bf?.right ?? 'none',
    top: bf?.top ?? 'none', bottom: bf?.bottom ?? 'none',
    fill: bf?.faceColor ?? null,
    center: true,
  }
}

console.log('③ 시트 조립 · 스크럽 · 체크 되돌리기')

const sheets: BuildSheet[] = []
const manifests: SheetManifest[] = []
let scrubHits = 0
let uncheckHits = 0
let tokenCellCount = 0
let blankHits = 0

for (const sec of SECTIONS) {
  const gridParts = sec.parts.filter(p => p.kind === 'grid') as Extract<Part, { kind: 'grid' }>[]
  if (!gridParts.length) { fail(`${sec.name}: 격자 표가 없다`); continue }
  const gridPart = gridParts[0]
  const grid = tables[gridPart.table]
  /* 미세 격자에서는 시트의 열 수가 표와 무관하게 **항상 FINE_N**이다 — 배너가 시트 폭을
   *  덮어야 하므로 여기서 갈아 끼운다(Q-9). 표별 열 수는 `projectCols`가 흡수한다. */
  const nCols = FINE_N

  /* 세로 병합(S3-1) — 격자가 둘 이상이면 **열 경계 벡터가 같아야만** 쌓는다.
   * 🚨 열 수만 같은지 보면 안 된다. 폭이 다른 5열 표 둘을 겹치면 아래 표의 칸이 위 표의
   *    열 경계에 끌려가 서식이 조용히 어긋난다 — 경계 좌표까지 같은지 묻는다. */
  if (gridParts.length > 1) {
    const edgeKey = (i: number) => columnEdges(tables[i]).join(',')
    const base = edgeKey(gridPart.table)
    const bad = gridParts.slice(1).filter(p => edgeKey(p.table) !== base)
    if (bad.length) fail(`${sec.name}: 세로 병합 불가 — 열 경계가 다른 격자 ${bad.map(p => `#${p.table}`).join(',')}`)
  }

  const banners = sec.parts.filter(p => p.kind === 'banner') as Extract<Part, { kind: 'banner' }>[]
  // 배너를 격자 앞에 둘지 뒤에 둘지는 **원문 순서**가 정한다(표지는 제목이 용도상자 뒤에 온다)
  const gridAt = sec.parts.indexOf(gridPart)
  const before = banners.filter(b => sec.parts.indexOf(b) < gridAt)
  const after = banners.filter(b => sec.parts.indexOf(b) > gridAt)

  const cells: BuildCell[] = []
  const merges: string[] = []
  const heights: number[] = []
  const m: SheetManifest = {
    name: sec.name, no: sec.no, tables: sec.parts.map(p => p.table),
    rows: 0, cols: nCols, merges: 0, bannerRows: [],
    labels: {}, boxes: {}, restoredBoxes: {}, bulletCells: {}, tokenCells: {}, scrubbed: {}, sampleBlanked: {}, fillInStripped: {}, numberedRuns: [], gridTops: [],
  }

  /** 원문 → 스크럽 → 체크 되돌리기 → 토큰 비우기. **배너와 격자가 같은 관을 지난다** —
   *  갈라 두면 한쪽만 낡는다(실측: 배너만 빼놨더니 표지에 `{{customer_name}}`이 남았다). */
  const processText = (raw: string, ref: string, boxGlyph: () => { glyph: string; axis: string } | null) => {
    let text = raw
    const { text: cleaned, hits } = scrubText(text)
    if (hits.length) { text = cleaned; m.scrubbed[ref] = hits; scrubHits++ }

    // `[√]`·`☑`는 글자가 하나로 정해져 있어 상자 어휘를 물을 필요가 없다 — 항상 되돌린다
    const bracketed = text.replace(/\[\s*[√✓✔]\s*\]/g, '[ ]').replace(/[☑▣]/g, '☐')
    if (bracketed !== text) { text = bracketed; uncheckHits++ }

    // 표본 답 잔재(규칙 축) — 스크럽·체크덮개·강순기 대조를 **셋 다** 통과한 부류를 걷는다
    const [stripped, rules] = stripFillIns(text)
    if (rules.length) {
      fillInLog.push(`      ${sec.name}!${ref} [${rules.join('+')}]  ${JSON.stringify(text)} → ${JSON.stringify(stripped)}`)
      text = stripped
      m.fillInStripped[ref] = rules.join('+')
    }

    if (text.includes('■')) {
      const hit = boxGlyph()
      if (hit) {
        text = uncheckText(text, hit.glyph)
        m.restoredBoxes[ref] = hit.axis
        uncheckHits++
      } else {
        // 형제 빈 상자가 없다 = 선택지가 아니다 → 법정 서식의 불릿. 바꾸면 없던 선택지가 생긴다
        m.bulletCells[ref] = text
      }
    }

    TOKEN_RE.lastIndex = 0
    if (TOKEN_RE.test(text)) {
      // 🚨 앵커 셀은 템플릿에서 **공란**이다(S7-2 백지 불변식) — 원문은 manifest가 들고 있다가
      //    S5가 값을 끼워 다시 조립한다. 템플릿에 남겨 두면 값이 없을 때 `{{...}}`가 인쇄된다.
      m.tokenCells[ref] = text
      tokenCellCount++
      text = ''
    }

    BOX_RE.lastIndex = 0
    const boxes = text.match(BOX_RE)
    if (boxes?.length) m.boxes[ref] = boxes[0]
    if (text) m.labels[ref] = text
    return text
  }

  const emitBanner = (idx: number, row: number) => {
    const bt = tables[idx]
    // ⚠ **행 먼저, 그다음 열**로 정렬한다. 열로만 정렬하면 여러 행짜리 머리 블록(서식 2.3의
    //   #50·#52)에서 아래 행의 왼쪽 칸이 위 행의 오른쪽 칸보다 앞서 붙어 문장이 뒤섞인다.
    //   1행 배너에는 아무 영향이 없다(제1장 전건 무변경).
    const raw = bt.cells
      .slice().sort((a, b) => (a.row - b.row) || (a.col - b.col))
      .map(c => c.text.trim()).filter(Boolean).join('  ')
    const style = styleOf(fills.get(bt.cells[0]?.borderFillId ?? 0))
    const text = processText(raw, cellRef(row, 0), () => null)
    for (let k = 0; k < nCols; k++) cells.push({ row, col: k, text: k === 0 ? text : '', style })
    if (nCols > 1) merges.push(`${cellRef(row, 0)}:${cellRef(row, nCols - 1)}`)
    heights.push(hwpToPt(Math.max(...bt.cells.map(c => c.heightHwp), 0)) || 22)
    m.bannerRows.push(row)
  }

  let row = 0
  for (const b of before) emitBanner(b.table, row++)

  const gridTop = row
  // 격자가 여럿이면 순서대로 **세로로 쌓는다**(#55~#60 개별임무카드). 하나뿐이면 종전과 같다.
  for (const gp of gridParts) {
    const g = tables[gp.table]
    const top = row
    const oracle = makeBoxOracle(g)
    for (const h of rowHeights(g).map(hwpToPt)) heights.push(h)
    row += g.rowCnt

    /* 미세 격자 투영 — 표마다 독립이라 열 수가 다른 표를 한 시트에 쌓을 수 있다(Q-9) */
    const proj = projectCols(g)
    /* 🚨 **행뿐 아니라 열도 발행한다.** 종전엔 `top`만 실어 소비자가 `시트 열 == 표 열`이라고
     *   추측했고, 미세 격자로 옮긴 뒤 그 추측이 깨져 강순기 대조 일치율이 95.9% → 24.8%로
     *   무너졌다(멀쩡한 산출물을 '자구 불일치 37건'으로 신고). F-20을 행 축에서 배우고도
     *   열 축에 같은 구멍을 남겨 둔 것이다 — 좌표를 잇는 사실은 **전부** 여기서 나가야 한다.
     *   `cols[i]` = 표의 i번째 열이 시작하는 시트 열(0-based), 길이는 colCnt+1(마지막은 끝 경계). */
    m.gridTops.push({ table: gp.table, top, rows: g.rowCnt, cols: proj })
    for (const c of g.cells) {
      const style = styleOf(fills.get(c.borderFillId))
      const r0 = top + c.row
      const c0 = proj[c.col]
      const c1 = proj[Math.min(c.col + c.colSpan, g.colCnt)] - 1
      if (c1 < c0) throw new Error(`격자에 자리가 없는 셀: 표#${gp.table} r${c.row}c${c.col} — 열 폭 배분을 확인하라`)
      const ref = cellRef(r0, c0)
      // 🚨 표본 답 좌표는 **그 격자의 표 번호**로 찾는다 — 쌓인 시트에서 첫 격자 번호로만
      //   찾으면 둘째 이후 카드의 답이 조용히 안 지워진다
      const blank = blankAt.get(`${gp.table}:${c.row}:${c.col}`)
      // 표본 답 비우기 — 상자만 남기라는 지시면 빈 상자 글자 하나만 남긴다
      const raw = blank ? (blank.keep === 'box' ? (c.text.match(BOX_RE)?.[0] ?? '') : '') : c.text
      if (blank) { m.sampleBlanked[ref] = blank.why; blankHits++ }
      const text = processText(raw, ref, () => oracle.glyphFor(c))

      cells.push({ row: r0, col: c0, text, style })

      /* 미세 격자에서는 colSpan===1인 칸도 여러 열을 먹으므로 **가로도 병합 대상**이다 */
      if (c.rowSpan > 1 || c1 > c0) {
        merges.push(`${cellRef(r0, c0)}:${cellRef(r0 + c.rowSpan - 1, c1)}`)
        // ⚠ 덮인 칸도 만든다 — xlsx에서 병합 영역의 테두리는 구성 셀들의 바깥 변에서 나온다.
        //   안 만들면 병합 안쪽 테두리가 통째로 빠진다.
        for (let r = r0; r < r0 + c.rowSpan; r++) {
          for (let k = c0; k <= c1; k++) {
            if (r === r0 && k === c0) continue
            cells.push({ row: r, col: k, text: '', style })
          }
        }
      }
    }
  }

  for (const b of after) emitBanner(b.table, row++)

  // 반복 행 예산 파생(S4-3) — 0열이 1,2,3…으로 이어지는 구간
  {
    const col0 = new Map<number, string>()
    for (const c of grid.cells) if (c.col === 0) col0.set(gridTop + c.row, c.text.trim())
    let start = -1, want = 1
    for (let r = 0; r <= row; r++) {
      const v = col0.get(r)
      if (v === String(want)) { if (start < 0) start = r; want++; continue }
      if (start >= 0 && want - 1 >= 3) m.numberedRuns.push({ startRow: start, rows: want - 1 })
      start = -1; want = 1
      if (v === '1') { start = r; want = 2 }
    }
    if (start >= 0 && want - 1 >= 3) m.numberedRuns.push({ startRow: start, rows: want - 1 })
  }

  m.rows = row
  m.merges = merges.length
  manifests.push(m)
  /* 미세 격자는 열 폭이 **균일**하다 — 비율은 「병합이 몇 칸을 먹는가」가 담는다(Q-9).
   *  ⚠ 폭 값이 인쇄 글자 크기를 정한다(FINE_COL_W 주석 참조) — 크게 하려면 이 값을 줄인다. */
  sheets.push({
    name: sec.name,
    colWidths: Array.from({ length: FINE_N }, () => FINE_COL_W),
    rowHeights: heights, cells, merges,
  })
}

/* ══════════════════════ 미세 격자 (소방계획서_47 Q-9) ══════════════════════
 *
 *  종전에는 **hwp 열 = 엑셀 열**(성긴 격자)이었다. 그러면 열 수가 표마다 1~30으로 요동쳐
 *  한 시트에 열 수가 다른 표를 못 섞고, 칸 비율이 열 개수만큼만 표현된다.
 *  미세 격자는 모든 표를 **같은 N열**에 투영한다 — 비율이 1/N까지 표현되고, 열 수가 다른 표를
 *  한 시트에 쌓을 수 있다.
 *
 *  ⚠ `columnEdges`는 `colSpan===1` 셀에서만 폭을 읽어 **병합 셀만 걸치는 열이 폭 0**이 된다.
 *    그대로 투영하면 그 열만 차지하는 셀이 격자에서 자리를 잃고 **통째로 사라진다**.
 *    → 병합 셀 폭에서 역산해 미지수 열에 배분한다(`solveWidths`).
 *  🎯 인쇄 글자 크기를 정하는 것은 폰트가 아니라 **열 폭**이다 — 시트를 가로 1쪽에 맞추면
 *    폰트가 약분되고 `쪽폭 ÷ (열 수 × 열 폭)`만 남는다. 실측 최적 1.8. */
/* 상수는 파일 머리에 있다(아래 §미세 격자 상수) — 여기 두면 사용처보다 늦게 초기화돼 TDZ에 걸린다 */

function solveWidths(t: HwpxTable): number[] {
  const w = new Array<number>(t.colCnt).fill(0)
  for (const c of t.cells) if (c.colSpan === 1 && c.widthHwp > 0) w[c.col] = Math.max(w[c.col], c.widthHwp)
  const spans = t.cells.filter(c => c.colSpan > 1 && c.widthHwp > 0).sort((a, b) => a.colSpan - b.colSpan)
  for (let p = 0; p < 4; p++) {
    let changed = false
    for (const c of spans) {
      const cols = Array.from({ length: c.colSpan }, (_, k) => c.col + k).filter(i => i < t.colCnt)
      const unknown = cols.filter(i => w[i] === 0)
      if (!unknown.length) continue
      const rest = c.widthHwp - cols.reduce((a, i) => a + w[i], 0)
      if (rest <= 0) continue
      const each = Math.round(rest / unknown.length)
      for (const i of unknown) w[i] = each
      changed = true
    }
    if (!changed) break
  }
  return w.map(x => (x > 0 ? x : 1))
}
/** hwp 열 경계 → 미세 격자 열 인덱스. 어떤 열도 0칸이 되어선 안 된다(셀이 사라진다) */
function projectCols(t: HwpxTable): number[] {
  const w = solveWidths(t)
  const total = w.reduce((a, b) => a + b, 0) || 1
  const map = [0]
  let acc = 0
  for (const x of w) { acc += x; map.push(Math.round((acc / total) * FINE_N)) }
  for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1
  return map
}

function colWidthsOf(t: HwpxTable): number[] {
  const edges = columnEdges(t)
  return Array.from({ length: t.colCnt }, (_, i) => pxToColWidth(hwpToPx(edges[i + 1] - edges[i])))
}

ok(`시트 ${sheets.length} · 스크럽 ${scrubHits}칸 · 체크 되돌림 ${uncheckHits}칸 · 표본답 비움 ${blankHits}칸 · 토큰칸 ${tokenCellCount}`)
notes.push(`스크럽 ${scrubHits}칸 · 체크 되돌림 ${uncheckHits}칸 · 표본답 비움 ${blankHits}칸 · 토큰 씨앗 ${tokenCellCount}칸`)
// 선언한 만큼 실제로 비웠는가 — 좌표가 밀리면 조용히 0칸이 된다(항진명제 방지)
if (blankHits !== SAMPLE_ANSWER_CELLS.length) {
  fail(`표본답 비움 ${blankHits}칸 ≠ 선언 ${SAMPLE_ANSWER_CELLS.length}칸 — 좌표가 밀렸다`)
}

// 규칙 축도 **정확히** 단언한다. 0건은 '깨끗하다'가 아니라 '규칙이 눈멀었다'일 수 있다
{
  // 걷어낸 칸을 **전건 눈에 보이게** 한다 — 법정 서식을 고치는 일이라 개수만 세면 안 된다
  for (const line of fillInLog) console.log(line)
  const got = `padded ${fillIn.padded} · etc ${fillIn.etc} · unit ${fillIn.unit}`
  const want = `padded ${FILL_IN_EXPECT.padded} · etc ${FILL_IN_EXPECT.etc} · unit ${FILL_IN_EXPECT.unit}`
  if (got !== want) fail(`표본답 규칙 적중 [${got}] ≠ 선언 [${want}] — 양식이 바뀌었거나 규칙이 눈멀었다`)
  else ok(`표본답 규칙 ${want}`)
  notes.push(`표본답 규칙 ${got}`)
}

/* ══════════════════════ ⑤ 조립 ══════════════════════ */

console.log('④ xlsx 조립')
const built = await buildXlsx(sheets)
ok(`${built.bytes.length} bytes · cellXfs ${built.styleCount}`)

/* ══════════════════════ ⑥ 게이트 ══════════════════════ */

console.log('⑤ 게이트')

// 🚨 S3-3 PII — **원시 바이트** 축. 셀 값 스캔은 파트 안에 남은 원문을 못 본다
{
  const z = await JSZip.loadAsync(built.bytes)
  let hitCount = 0
  for (const name of Object.keys(z.files)) {
    if (z.files[name].dir) continue
    const raw = await z.file(name)!.async('string')
    for (const n of FIRE_PLAN_SCRUB_NEEDLES) {
      if (raw.includes(n)) { fail(`원시 바이트 니들 잔존: ${name} ⊃ '${n}'`); hitCount++ }
    }
  }
  if (!hitCount) ok(`니들 ${FIRE_PLAN_SCRUB_NEEDLES.length}종 · 전 파트 원시 바이트 0건`)
}

// 🚨 sharedStrings 파트 **부재** — 내용이 아니라 구조로 닫는다(S2-2)
{
  const z = await JSZip.loadAsync(built.bytes)
  const names = Object.keys(z.files)
  if (names.includes('xl/sharedStrings.xml')) fail('sharedStrings.xml 파트가 생겼다 — 고아 si 사고 경로가 열린다')
  else ok('sharedStrings.xml 부재(고아 si 사고를 구조로 차단)')
  if (names.some(n => n.startsWith('xl/media/'))) fail('xl/media 파트가 생겼다 — 이미지 0 규약 위반')
  else ok('xl/media 부재')
  let f = 0
  for (const n of names.filter(x => /^xl\/worksheets\/.*\.xml$/.test(x))) {
    f += ((await z.file(n)!.async('string')).match(/<f[\s>]/g) ?? []).length
  }
  if (f) fail(`수식 ${f}개 — 무수식 규약 위반`)
  else ok('수식 0개')
}

// 🚨 S3-4 체크 마크 덮개 — 리터럴 셀에 체크된 표시가 남으면 표본 고객의 답이 전 고객 문서에
//    인쇄된다. 지금은 앵커가 없어 **전 셀이 리터럴**이라 가장 강한 형태로 검사된다.
//    유일한 예외는 규칙으로 파생된 `bulletCells`(형제 빈 상자가 없는 `■` = 법정 불릿)뿐이고,
//    그 목록도 여기서 다시 심사한다 — 손목록이 아니라 **규칙과 그 규칙의 결과**를 함께 본다.
{
  const bullets = new Map<string, string>()
  for (const x of manifests) for (const [ref, t] of Object.entries(x.bulletCells)) bullets.set(`${x.name}!${ref}`, t)

  const bad: string[] = []
  for (const sh of sheets) {
    for (const c of sh.cells) {
      if (!c.text || !FIRE_PLAN_MARK_CHECKED_RE.test(c.text)) continue
      const key = `${sh.name}!${cellRef(c.row, c.col)}`
      if (!bullets.has(key)) bad.push(`${key} = ${c.text.slice(0, 24)}`)
    }
  }
  if (bad.length) fail(`체크된 표시 잔존 ${bad.length}칸: ${bad.slice(0, 5).join(' · ')}`)
  else ok(`체크된 표시 0칸 (불릿 예외 ${bullets.size}칸)`)

  // 불릿 심사 — ①`■`로 시작하고 ②그 뒤에 라벨이 있고 ③상자가 하나뿐이고 ④수가 적어야 한다.
  // 하나라도 어긋나면 그건 불릿이 아니라 놓친 체크다.
  for (const [key, t] of bullets) {
    if (!t.trimStart().startsWith('■')) fail(`불릿 판정 부적격(맨 앞이 아니다): ${key} = ${t.slice(0, 30)}`)
    if ((t.match(/■/g) ?? []).length !== 1) fail(`불릿 판정 부적격(■가 여러 개): ${key} = ${t.slice(0, 30)}`)
    if (t.replace(/■/g, '').trim().length < 2) fail(`불릿 판정 부적격(라벨이 없다): ${key} = ${t.slice(0, 30)}`)
    if (/[☑▣√✓✔]/.test(t)) fail(`불릿 판정 부적격(다른 체크 표시 동반): ${key} = ${t.slice(0, 30)}`)
  }
  if (bullets.size > 12) fail(`불릿 예외 ${bullets.size}칸 — 너무 많다. 체크박스를 불릿으로 오판했을 소지`)
  for (const [key, t] of bullets) notes.push(`불릿 예외 ${key} = ${t.slice(0, 40)}`)
}

// 남은 `{{token}}` 0건 — 하나라도 남으면 고객 문서에 `{{owner_name}}`이 인쇄된다
{
  const bad: string[] = []
  for (const sh of sheets) for (const c of sh.cells) if (c.text.includes('{{')) bad.push(`${sh.name}!${cellRef(c.row, c.col)}`)
  if (bad.length) fail(`템플릿에 {{token}} 잔존 ${bad.length}칸: ${bad.slice(0, 5).join(' · ')}`)
  else ok('{{token}} 잔존 0칸')
}

// 눈멂 가드 ② — 산출물 쪽. 시트·병합·라벨이 0이면 위 검사들이 전부 항진명제가 된다
{
  const labelTotal = manifests.reduce((s, x) => s + Object.keys(x.labels).length, 0)
  const mergeTotal = manifests.reduce((s, x) => s + x.merges, 0)
  if (sheets.length < 28) fail(`산출 시트 ${sheets.length} < 28`)
  if (labelTotal < 500) fail(`라벨 ${labelTotal} < 500 — 스크럽이 과했거나 조립이 비었다`)
  if (mergeTotal < 500) fail(`병합 ${mergeTotal} < 500`)
  if (tokenCellCount < 50) fail(`토큰 씨앗 ${tokenCellCount} < 50 — 앵커 초안의 분모가 사라졌다`)
  ok(`산출 시트 ${sheets.length} · 라벨 ${labelTotal} · 병합 ${mergeTotal} · 토큰 ${tokenCellCount}`)
}

/* ══════════════════════ ⑦ 쓰기 ══════════════════════ */

if (fails.length) {
  console.log(`\n🚨 게이트 ${fails.length}건 실패 — 자산을 쓰지 않는다`)
  for (const f of fails) console.log(`   ${f}`)
  process.exit(1)
}

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

/**
 * **내용 지문** — 파트 이름+바이트만으로 만든다(zip 엔트리 타임스탬프 제외).
 *
 * ⚠ 실측: 소스를 한 글자도 안 고치고 재빌드해도 파일 sha가 매번 바뀐다(JSZip이 엔트리에
 *   현재 시각을 찍는다). 이걸 모르면 자산을 재빌드했을 때 뜨는 diff를 보고 "뭔가 바뀌었다"고
 *   오판한다. 파일 sha는 '이 manifest와 이 파일이 한 빌드에서 나왔나'를, 내용 지문은
 *   '내용이 실제로 달라졌나'를 답한다 — **두 질문이 다르므로 둘 다 적는다**.
 */
async function contentFingerprint(bytes: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(bytes)
  const names = Object.keys(z.files).filter(n => !z.files[n].dir).sort()
  const h = createHash('sha256')
  for (const n of names) { h.update(n); h.update(await z.file(n)!.async('nodebuffer')) }
  return h.digest('hex')
}

const manifest = {
  version: 1,
  doc: '소방계획서_42',
  // ⚠ 범위를 손으로 적지 않는다 — 종전 `'제1장'`은 제2·3장을 실은 뒤에도 그대로 남아
  //   라우트 고지 헤더가 사용자에게 거짓을 말할 뻔했다. 지도에서 파생시킨다.
  scope: [
    CHAPTER1.length ? '제1장' : '', CHAPTER2.length ? '제2장' : '', CHAPTER3.length ? '제3장' : '',
  ].filter(Boolean).join('·'),
  builtBy: 'scripts/build-fire-plan-template.mts',
  source: { file: 'erp_goal/_Data/양식-placeholder.hwpx', sha256: sha(readFileSync(HWPX)), tables: tables.length, cells: cellTotal },
  asset: {
    file: 'templates/fire-plan-workbook.xlsx',
    sha256: sha(built.bytes),
    contentSha256: await contentFingerprint(built.bytes),
    bytes: built.bytes.length, styles: built.styleCount,
  },
  scrubNeedles: FIRE_PLAN_SCRUB_NEEDLES,
  sheets: manifests,
}

mkdirSync(dirname(OUT_XLSX), { recursive: true })
writeFileSync(OUT_XLSX, built.bytes)
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`\n✅ 게이트 전건 통과`)
for (const n of notes) console.log(`   ${n}`)
console.log(`   ${OUT_XLSX}  (${built.bytes.length} bytes · sha ${manifest.asset.sha256.slice(0, 12)})`)
console.log(`   ${OUT_MANIFEST}  (${existsSync(OUT_MANIFEST) ? readFileSync(OUT_MANIFEST).length : 0} bytes)`)
