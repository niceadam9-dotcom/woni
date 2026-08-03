/** 외관점검표(소방시설등 외관점검표 — 소방시설 자체점검사항 등에 관한 고시 별지 제6호서식) HTML 템플릿 (소방계획서_7 H-7)
 *
 *  서식 원문: erp_goal/_form/외관점검표-placeholder.hwpx section0.xml(개정 2022.12.1., 고시 2022-71) 추출(2026-08-03) —
 *  표지(대상물·소방안전관리자·월별 점검 기록 12행·비고) + 14개 설비 점검표(항목별 12개월 결과란 ○/×//) 동일 재현.
 *  항목 목록 = 외관점검표-manifest.json(EXTERIOR_SECTIONS 상수로 내장) — seed-exterior-sheet.mjs가 심는
 *  inspection_sheet_items(item_code X{섹션}-{행})와 동일 원본이라 코드↔행이 항상 일치한다.
 *  쪽 구성은 원본 기준 16쪽: 표지 1 + 섹션 14(3번 섹션만 앞/뒤 2쪽 분할).
 *  렌더는 순수 함수(조회 없음) — 데이터 조립은 report9-actions(assembleExterior, 워커 process_exterior 이식). */

import { renderDocument, pageHeader, pageFooter, esc, val, ck, resultMark } from './base'

export type ExteriorItem = { code: string; category: string | null; content: string }
export type ExteriorSection = { sec: number; title: string; items: ExteriorItem[] }

/** 별지 6호 점검항목 카탈로그 — erp_goal/_form/외관점검표-manifest.json(v2022)과 1:1 */
export const EXTERIOR_SECTIONS: ExteriorSection[] = [
  { sec: 1, title: "소화기구 및 자동소화장치", items: [
    { code: "X1-01", category: "소화기(간이소화용구 포함)", content: "거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부" },
    { code: "X1-02", category: "소화기(간이소화용구 포함)", content: "구획된 거실(바닥면적 33㎡ 이상)마다 소화기 설치 여부" },
    { code: "X1-03", category: "소화기(간이소화용구 포함)", content: "소화기 표지 설치 여부" },
    { code: "X1-04", category: "소화기(간이소화용구 포함)", content: "소화기의 변형‧손상 또는 부식이 있는지 여부" },
    { code: "X1-05", category: "소화기(간이소화용구 포함)", content: "지시압력계(녹색범위)의 적정 여부" },
    { code: "X1-06", category: "소화기(간이소화용구 포함)", content: "수동식 분말소화기 내용연수(10년) 적정 여부" },
    { code: "X1-07", category: "자동확산소화기", content: "견고하게 고정되어 있는지 여부" },
    { code: "X1-08", category: "자동확산소화기", content: "소화기의 변형‧손상 또는 부식이 있는지 여부" },
    { code: "X1-09", category: "자동확산소화기", content: "지시압력계(녹색범위)의 적정 여부" },
    { code: "X1-10", category: "자동소화장치", content: "수신부가 설치된 경우 수신부 정상(예비 전원, 음향장치 등) 여부" },
    { code: "X1-11", category: "자동소화장치", content: "본체용기, 방출구, 분사헤드 등의 변형‧ 손상 또는 부식이 있는지 여부" },
    { code: "X1-12", category: "자동소화장치", content: "소화약제의 지시압력 적정 및 외관의 이상 여부" },
    { code: "X1-13", category: "자동소화장치", content: "감지부(또는 화재감지기) 및 차단장치 설치 상태 적정 여부" },
  ] },
  { sec: 2, title: "옥내·외 소화전 설비", items: [
    { code: "X2-01", category: "수원", content: "주된수원의 유효수량 적정여부 (겸용설비 포함)" },
    { code: "X2-02", category: "수원", content: "보조수원(옥상)의 유효수량 적정여부" },
    { code: "X2-03", category: "수원", content: "수조 표시 설치상태 적정 여부" },
    { code: "X2-04", category: "가압송수장치", content: "펌프 흡입측 연성계·진공계 및 토출측 압력계 등 부속장치의 변형·손상 유무" },
    { code: "X2-05", category: "송수구", content: "송수구 설치장소 적정 여부 (소방차가 쉽게 접근할 수 있는 장소)" },
    { code: "X2-06", category: "배관", content: "급수배관 개폐밸브 설치(개폐표시형, 흡입측 버터플라이 제외) 적정 여부" },
    { code: "X2-07", category: "함 및 방수구 등", content: "함 개방 용이성 및 장애물 설치 여부 등 사용 편의성 적정 여부" },
    { code: "X2-08", category: "함 및 방수구 등", content: "위치표시등 적정 설치 및 정상 점등 여부" },
    { code: "X2-09", category: "함 및 방수구 등", content: "소화전 표시 및 사용요령(외국어 병기) 기재 표지판 설치상태 적정 여부" },
    { code: "X2-10", category: "함 및 방수구 등", content: "함 내 소방호스 및 관창 비치 적정 여부" },
    { code: "X2-11", category: "제어반", content: "펌프 별 자동·수동 전환스위치 위치 적정 여부" },
  ] },
  { sec: 3, title: "(간이)스프링클러설비, 물분무소화설비, 미분무소화설비, 포소화설비", items: [
    { code: "X3-01", category: "수원", content: "주된수원의 유효수량 적정여부 (겸용설비 포함)" },
    { code: "X3-02", category: "수원", content: "보조수원(옥상)의 유효수량 적정여부" },
    { code: "X3-03", category: "수원", content: "수조 표시 설치상태 적정 여부" },
    { code: "X3-04", category: "저장탱크(포소화설비)", content: "포소화약제 저장량의 적정 여부" },
    { code: "X3-05", category: "가압송수장치", content: "펌프 흡입측 연성계·진공계 및 토출측 압력계 등 부송장치의 변형·손상 유무" },
    { code: "X3-06", category: "유수검지장치", content: "유수검지장치실 설치 적정(실내 또는 구획, 출입문 크기, 표지) 여부" },
    { code: "X3-07", category: "배관", content: "급수배관 개폐밸브 설치(개폐표시형, 흡입측 버터플라이 제외) 적정 여부" },
    { code: "X3-08", category: "배관", content: "준비작동식 유수검지장치 및 일제개방 밸브 2차측 배관 부대설비 설치 적정" },
    { code: "X3-09", category: "배관", content: "유수검지장치 시험장치 설치 적정(설치 위치, 배관구경, 개폐밸브 및 개방형 헤드, 물받이통 및 배수관) 여부" },
    { code: "X3-10", category: "배관", content: "다른 설비의 배관과의 구분 상태 적정 여부" },
    { code: "X3-11", category: "기동장치", content: "수동조작함(설치높이, 표시등) 설치 적정 여부" },
    { code: "X3-12", category: "제어밸브 등(물분무소화설비)", content: "제어밸브 설치 위치 적정 및 표지 설치 여부" },
    { code: "X3-13", category: "배수설비(물분무소화설비가 설치된 차고·주차장)", content: "배수설비(배수구, 기름분리장치 등) 설치 적정 여부" },
    { code: "X3-14", category: "헤드", content: "헤드의 변형·손상 유무 및 살수장애 여부" },
    { code: "X3-15", category: "호스릴방식(미분무소화설비, 포소화설비)", content: "소화약제저장용기 근처 및 호스릴함 위치표시등 정상 점등 및 표지 설치 여부" },
    { code: "X3-16", category: "송수구", content: "송수구 설치장소 적정 여부(소방차가 쉽게 접근할 수 있는 장소)" },
    { code: "X3-17", category: "제어반", content: "펌프 별 자동·수동 전환스위치 정상위치에 있는지 여부" },
  ] },
  { sec: 4, title: "이산화탄소, 할론소화설비, 할로겐화합물 및 불활성기체소화설비, 분말소화설비", items: [
    { code: "X4-01", category: "저장용기", content: "설치장소 적정 및 관리 여부" },
    { code: "X4-02", category: "저장용기", content: "저장용기 설치장소 표지 설치 여부" },
    { code: "X4-03", category: "저장용기", content: "소화약제 저장량 적정 여부" },
    { code: "X4-04", category: "기동장치", content: "기동장치 설치 적정(출입구 부근 등, 높이 보호장치, 표지 전원표시등) 여부" },
    { code: "X4-05", category: "배관 등", content: "배관의 변형·손상 유무" },
    { code: "X4-06", category: "분사헤드", content: "분사헤드의 변형·손상 유무" },
    { code: "X4-07", category: "호스릴방식", content: "소화약제저장용기의 위치표시등 정상 점등 및 표지 설치 여부" },
    { code: "X4-08", category: "안전시설 등(이산화탄소소화설비)", content: "방호구역 출입구 부근 잘 보이는 장소에 소화약제 방출 위험경고표지 부착 여부" },
    { code: "X4-09", category: "안전시설 등(이산화탄소소화설비)", content: "방호구역 출입구 외부 인근에 공기호흡기 설치 여부" },
  ] },
  { sec: 5, title: "자동화재탐지설비, 비상경보설비, 시각경보기, 비상방송설비, 자동화재속보설비", items: [
    { code: "X5-01", category: "수신기", content: "설치장소 적정 및 스위치 정상 위치 여부" },
    { code: "X5-02", category: "수신기", content: "상용전원 공급 및 전원표시등 정상점등 여부" },
    { code: "X5-03", category: "수신기", content: "예비전원(축전지) 상태 적정 여부" },
    { code: "X5-04", category: "감지기", content: "감지기의 변형 또는 손상이 있는지 여부 (단독경보형감지기 포함)" },
    { code: "X5-05", category: "음향장치", content: "음향장치(경종 등) 변형·손상 여부" },
    { code: "X5-06", category: "시각경보장치", content: "시각경보장치 변형·손상 여부" },
    { code: "X5-07", category: "발신기", content: "발신기 변형·손상 여부" },
    { code: "X5-08", category: "발신기", content: "위치표시등 변형·손상 및 정상점등 여부" },
    { code: "X5-09", category: "비상방송설비", content: "확성기 설치 적정(층마다 설치, 수평거리) 여부" },
    { code: "X5-10", category: "비상방송설비", content: "조작부 상 설비 작동층 또는 작동구역 표시 여부" },
    { code: "X5-11", category: "자동화재속보설비", content: "상용전원 공급 및 전원표시등 정상 점등 여부" },
  ] },
  { sec: 6, title: "피난기구, 유도등(유도표지), 비상조명등 및 휴대용비상조명등", items: [
    { code: "X6-01", category: "피난기구", content: "피난에 유효한 개구부 확보(크기, 높이에 따른 발판, 창문 파괴장치) 및 관리 상태" },
    { code: "X6-02", category: "피난기구", content: "피난기구(지지대 포함)의 변형·손상 또는 부식이 있는지 여부" },
    { code: "X6-03", category: "피난기구", content: "피난기구의 위치표시 표지 및 사용방법 표지 부착 적정 여부" },
    { code: "X6-04", category: "유도등", content: "유도등 상시(3선식의 경우 점검스위치 작동 시) 점등 여부" },
    { code: "X6-05", category: "유도등", content: "유도등의 변형 및 손상 여부" },
    { code: "X6-06", category: "유도등", content: "장애물 등으로 인한 시각장애 여부" },
    { code: "X6-07", category: "유도표지", content: "유도표지의 변형 및 손상 여부" },
    { code: "X6-08", category: "유도표지", content: "설치 상태(쉽게 떨어지지 않는 방식, 장애물 등으로 시각장애 유무) 적정 여부" },
    { code: "X6-09", category: "비상조명등", content: "비상조명등 변형·손상 여부" },
    { code: "X6-10", category: "비상조명등", content: "예비전원 내장형의 경우 점검스위치 설치 및 정상 작동 여부" },
    { code: "X6-11", category: "휴대용비상조명등", content: "휴대용비상조명등의 변형 및 손상 여부" },
    { code: "X6-12", category: "휴대용비상조명등", content: "사용 시 자동으로 점등되는지 여부" },
  ] },
  { sec: 7, title: "제연설비, 특별피난계단의 계단실 및 부속실 제연설비", items: [
    { code: "X7-01", category: "제연구역의 구획", content: "제연경계의 폭, 수직거리 적성 설치 여부" },
    { code: "X7-02", category: "배출구, 유입구", content: "배출구, 공기유입구 변형·훼손 여부" },
    { code: "X7-03", category: "기동장치", content: "제어반 각종 스위치류 표시장치(작동표시등 등) 정상 여부" },
    { code: "X7-04", category: "외기취입구(특별피난계단의 계단실 및 부속실 제연설비)", content: "설치위치(오염공기 유입방지, 배기구 등 으로부터 이격거리) 적정 여부" },
    { code: "X7-05", category: "외기취입구(특별피난계단의 계단실 및 부속실 제연설비)", content: "설치구조(빗물·이물질 유입방지 등) 적정 여부" },
    { code: "X7-06", category: "제연구역의 출입문(특별피난계단의 계단실 및 부속실 제연설비)", content: "폐쇄상태 유지 또는 화재 시 자동폐쇄 구조 여부" },
    { code: "X7-07", category: "수동기동장치(특별피난계단의 계단실 및 부속실 제연설비)", content: "기동장치 설치(위치,전원표시등 등) 적정 여부" },
  ] },
  { sec: 8, title: "연결송수관설비, 연결살수설비", items: [
    { code: "X8-01", category: "연결송수관설비 송수구", content: "표지 및 송수압력범위 표지 적정 설치 여부" },
    { code: "X8-02", category: "방수구", content: "위치표시(표시등, 축광식표지) 적정 여부" },
    { code: "X8-03", category: "방수기구함", content: "호스 및 관창 비치 적정 여부" },
    { code: "X8-04", category: "방수기구함", content: "‘방수기구함’ 표지 설치상태 적정 여부" },
    { code: "X8-05", category: "연결살수설비 송수구", content: "표지 및 송수구역 일람표 설치 여부" },
    { code: "X8-06", category: "연결살수설비 송수구", content: "송수구의 변형 또는 손상 여부" },
    { code: "X8-07", category: "연결살수설비 헤드", content: "헤드의 변형·손상 유무" },
    { code: "X8-08", category: "연결살수설비 헤드", content: "헤드 살수장애 여부" },
  ] },
  { sec: 9, title: "비상콘센트설비, 무선통신보조설비, 지하구", items: [
    { code: "X9-01", category: "비상콘센트설비 콘센트", content: "변형·손상·현저한 부식이 없고 전원의 정상 공급여부" },
    { code: "X9-02", category: "비상콘센트설비 보호함", content: "‘비상콘센트’표지 설치상태 적정 여부" },
    { code: "X9-03", category: "비상콘센트설비 보호함", content: "위치표시등 설치 및 정상 점등 여부" },
    { code: "X9-04", category: "무선통신보조설비 무선기기접속단자", content: "설치장소(소방활동 용이성, 상시 근무장소) 적정여부" },
    { code: "X9-05", category: "무선통신보조설비 무선기기접속단자", content: "보호함 ‘무선기기접속단지’ 표지 설치 여부" },
    { code: "X9-06", category: "지하구(연소방지설비 등)", content: "연소방지설비 헤드의 변형·손상 여부" },
    { code: "X9-07", category: "지하구(연소방지설비 등)", content: "연소방지설비 송수구 1m 이내 살수구역 안내표지 설치상태 적정 여부" },
    { code: "X9-08", category: "방화벽", content: "방화문 관리상태 및 정상기능 적정 여부" },
  ] },
  { sec: 10, title: "기타사항 점검표", items: [
    { code: "X10-01", category: "피난·방화시설", content: "방화문 및 방화셔터의 관리 상태(폐쇄·훼손· 변경) 및 정상 기능 적정 여부" },
    { code: "X10-02", category: "피난·방화시설", content: "비상구 및 피난통로 확보 적정여부 (피난·방화시설 주변 장애물 적치 포함)" },
    { code: "X10-03", category: "방염", content: "선처리 방염대상물품의 적합 여부 (방염성능시험성적서 및 합격표시 확인)" },
    { code: "X10-04", category: "방염", content: "후처리 방염대상물품의 적합 여부 (방염성능검사결과 확인)" },
  ] },
  { sec: 11, title: "위험물 저장·취급시설", items: [
    { code: "X11-01", category: null, content: "가연물 방치 여부" },
    { code: "X11-02", category: null, content: "채광 및 환기 설비 관리상태 이상 유무" },
    { code: "X11-03", category: null, content: "위험물 종류에 따른 주의사항을 표시한 게시판 설치 유무" },
    { code: "X11-04", category: null, content: "기름찌꺼기나 폐액 방치 여부" },
    { code: "X11-05", category: null, content: "위험물 안전관리자 선임 여부" },
    { code: "X11-06", category: null, content: "화재 시 응급조치 방법 및 소방관서 등 비상연락망 확보 여부" },
  ] },
  { sec: 12, title: "화기시설", items: [
    { code: "X12-01", category: null, content: "화기시설 주변 적정(거리,수량,능력단위) 소화기 설치 유무" },
    { code: "X12-02", category: null, content: "건축물의 가연성부분 및 가연성물질로부터 1ｍ 이상의 안전거리 확보 유무" },
    { code: "X12-03", category: null, content: "가연성가스 또는 증기가 발생하거나 체류할 우려가 없는 장소에 설치 유무" },
    { code: "X12-04", category: null, content: "연료탱크가 연소기로부터 2ｍ이상의 수평 거리 확보 유무" },
    { code: "X12-05", category: null, content: "채광 및 환기설비 설치 유무" },
    { code: "X12-06", category: null, content: "방화환경조성 및 주의, 경고표시 유무" },
  ] },
  { sec: 13, title: "가연성 가스시설", items: [
    { code: "X13-01", category: null, content: "채광이 되어 있고 환기 및 비를 피할 수 있는 장소에 용기 설치 유무" },
    { code: "X13-02", category: null, content: "가스누설경보기 설치 유무" },
    { code: "X13-03", category: null, content: "용기, 배관, 밸브 및 연소기의 파손, 변형, 노후 또는 부식 여부" },
    { code: "X13-04", category: null, content: "환기설비 설치 유무" },
    { code: "X13-05", category: null, content: "방화환경조성 및 주의, 경고표시 유무" },
  ] },
  { sec: 14, title: "전기시설", items: [
    { code: "X14-01", category: null, content: "「전기사업법」에 따른 점검 또는 검사 실시 유무" },
    { code: "X14-02", category: null, content: "개폐기 설치상태 등 손상 여부" },
    { code: "X14-03", category: null, content: "규격 전선 사용 여부" },
    { code: "X14-04", category: null, content: "전선의 접속 상태 및 전선피복의 손상 여부" },
    { code: "X14-05", category: null, content: "누전차단기 설치상태 적정여부" },
    { code: "X14-06", category: null, content: "방화환경조성 및 주의, 경고표시 설치 유무" },
    { code: "X14-07", category: null, content: "전기 관련 기술자 등의 근무 여부" },
  ] },
]

export type ExteriorData = {
  // ── 표지 특정소방대상물·소방안전관리자 (워커 ph: customer_name·purpose·address·mgr_name·mgr_phone) ──
  customerName: string
  purpose: string             // 대상물 구분(용도)
  address: string
  mgrTitle: string            // 직위 — 별도 데이터 미보유(워커 동일 공란)
  mgrName: string             // 소방안전관리자 — 관계인(대표) 폴백 (워커 동일)
  mgrPhone: string
  // ── 점검결과 연도·해당 월 (워커 ph: yr·d{월}_md·d{월}_g/b·d{월}_nm) ──
  year: string                // ( yr 년도) 점검결과 — 전 섹션 표 공통
  month: number               // 점검 월(1~12) — 표지 해당 행 + 섹션 표 해당 월 열만 기입
  day: number                 // 점검 일
  inspectorName: string       // 점검자(담당 직원)
  /** 표지 해당 월 양호/불량 체크 — null = 시트 응답 없음(양쪽 공란, 워커 동일) */
  monthGood: boolean | null
  /** 섹션 표 결과란 — item_code(X{섹션}-{행}, 0패딩) → ○/×// (해당 월 열에만 표기) */
  results: Record<string, 'O' | 'X' | 'N'>
}

export type ExteriorRenderOpts = { highlight?: boolean } // 미리보기: 미입력 하이라이트 (§4-A-2c ③)

const CSS = `
  .ext-mark { font-size: 9pt; margin: 2px 0 6px; }
  .sec-head { font-size: 12pt; font-weight: bold; margin: 6px 0 6px; }
  .side { text-align: right; font-size: 8.5pt; }
  table.ext th, table.ext td { padding: 2.5px 3px; font-size: 8.5pt; line-height: 1.4; }
  table.ext td.itm { text-align: left; }
  table.ext td.cat { text-align: left; background: #f7f7f7; }
  table.ext td.mk { text-align: center; padding: 2px 0; }
  .result-note { font-size: 8.5pt; margin-top: 4px; }
  table.cover td, table.cover th { padding: 4px 5px; }
  table.cover td.sign { font-size: 8.5pt; color: #555; }
`

const MONTH_COL = '<col style="width:4.6%">'.repeat(12)

/** 표지 — 특정소방대상물·소방안전관리자·소방시설등 점검내역(12행)·비고 */
function coverPage(d: ExteriorData, h: boolean): string {
  const rows = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const isCur = m === d.month
    const md = isCur ? `${d.month}월 ${d.day}일` : '월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일'
    const good = isCur && d.monthGood !== null ? ck(d.monthGood) : ck(false)
    const bad = isCur && d.monthGood !== null ? ck(!d.monthGood) : ck(false)
    const nm = isCur ? val(d.inspectorName, { highlight: h }) : ''
    return `<tr>
    <td class="center">${isCur ? esc(md) : md}</td>
    <td class="center">${good}양호 ${bad}불량</td>
    <td class="center">${nm}</td>
    <td class="sign right">(서명)</td>
  </tr>`
  }).join('\n')

  return `
${pageHeader('소방시설 자체점검사항 등에 관한 고시[별지 제6호서식] <개정 2022.12.1.>', '')}
<h1 class="doc-title">소방시설등 외관점검표</h1>
<div class="ext-mark">※ [&nbsp;&nbsp;]에는 해당되는 곳에 √ 표기를 합니다.</div>
<table class="form cover">
  <tr>
    <th rowspan="3" style="width:24mm">특정소방<br>대 상 물</th>
    <td colspan="3">기관명 :  ${val(d.customerName, { highlight: h })}</td>
  </tr>
  <tr><td colspan="3">대상물 구분 :  ${val(d.purpose, { highlight: h })}</td></tr>
  <tr><td colspan="3">소재지 :  ${val(d.address, { highlight: h })}</td></tr>
  <tr>
    <th>소방안전<br>관리자</th>
    <td colspan="3">직위: ${val(d.mgrTitle)}&nbsp;&nbsp;&nbsp;직급:&nbsp;&nbsp;&nbsp;&nbsp;성명: ${val(d.mgrName, { highlight: h })}&nbsp;&nbsp;&nbsp;전화번호: ${val(d.mgrPhone, { highlight: h })}</td>
  </tr>
</table>
<table class="form cover" style="margin-top:8px">
  <colgroup><col style="width:24mm"><col style="width:26%"><col style="width:30%"><col><col style="width:22%"></colgroup>
  <tr>
    <th rowspan="13">소방시설등<br>점검내역</th>
    <th>점검월일</th><th>점검결과</th><th>점검자</th><th>확인자</th>
  </tr>
  ${rows}
  <tr><th>비고</th><td colspan="4" style="height:14mm">&nbsp;</td></tr>
</table>
${pageFooter()}`
}

/** 섹션 점검표 1쪽 — items[from..to) 범위 렌더 (3번 섹션 앞/뒤 분할용) */
function sectionPage(
  s: ExteriorSection, d: ExteriorData, h: boolean,
  opts: { from?: number; to?: number; sideLabel?: string; withHead?: boolean; withNote?: boolean } = {},
): string {
  const from = opts.from ?? 0
  const to = opts.to ?? s.items.length
  const items = s.items.slice(from, to)

  let prevCat: string | null | undefined
  const bodyRows: string[] = []
  for (const it of items) {
    if (it.category && it.category !== prevCat) {
      bodyRows.push(`<tr><td class="cat">${esc(it.category)}</td><td class="mk" colspan="12"></td></tr>`)
    }
    prevCat = it.category
    const cells = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      if (m !== d.month) return '<td class="mk"></td>'
      const r = d.results[it.code]
      const mark = resultMark(r)
      return `<td class="mk">${mark || (h ? '<span class="missing">&nbsp;&nbsp;</span>' : '')}</td>`
    }).join('')
    bodyRows.push(`<tr><td class="itm">${esc(it.content)}</td>${cells}</tr>`)
  }

  return `
${opts.sideLabel ? `<div class="side">${esc(opts.sideLabel)}</div>` : ''}
${opts.withHead !== false ? `<div class="sec-head">${s.sec}. ${esc(s.title)}</div>` : ''}
<table class="form ext">
  <colgroup><col>${MONTH_COL}</colgroup>
  ${opts.withHead !== false ? `<tr>
    <th rowspan="2">점&nbsp;&nbsp;검&nbsp;&nbsp;내&nbsp;&nbsp;용</th>
    <th colspan="12">( ${esc(d.year)} 년도) 점검결과</th>
  </tr>
  <tr>${Array.from({ length: 12 }, (_, i) => `<th class="nowrap">${i + 1}월</th>`).join('')}</tr>` : ''}
  ${bodyRows.join('\n  ')}
</table>
${opts.withNote !== false ? '<div class="result-note">※ 점검결과란은 양호 “○”, 불량 “×”, 해당없는 항목은 “/”로 표시한다.</div>' : ''}
${pageFooter()}`
}

/** 외관점검표 렌더 — 표지 1쪽 + 섹션 14개(3번 앞/뒤 분할) = 원본 서식과 동일한 16쪽 */
export function renderExterior(d: ExteriorData, opts: ExteriorRenderOpts = {}): string {
  const h = !!opts.highlight
  const pages: string[] = [coverPage(d, h)]
  for (const s of EXTERIOR_SECTIONS) {
    if (s.sec === 3) {
      // 원본 서식: 3번 섹션(17항목)만 앞/뒤 2쪽 — X3-11까지 앞 쪽, X3-12부터 뒤 쪽(표 머리 없이 이어짐)
      pages.push(sectionPage(s, d, h, { to: 11, sideLabel: '(앞 쪽)', withNote: false }))
      pages.push(sectionPage(s, d, h, { from: 11, sideLabel: '(뒤 쪽)', withHead: false }))
    } else {
      pages.push(sectionPage(s, d, h))
    }
  }
  return renderDocument({ title: `${d.customerName} 외관점검표(별지 6호)`, css: CSS, pages })
}
