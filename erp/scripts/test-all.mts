// 전체 테스트 단일 진입점 — 신규 개발 후 회귀 확인용. 실행: npm run test:all  (또는 npx tsx scripts/test-all.mts)
// 무서버 게이트(빌드·불변식)는 항상 실행, E2E는 localhost:3000 기동 시에만 실행(없으면 건너뜀 안내).
import { execSync } from 'child_process'

type Step = { name: string; cmd: string; needServer?: boolean }
const steps: Step[] = [
  // 맨 앞에 둔다 — E2E가 중간에 죽으면 픽스처가 남고, 그중 하나가 `일반관리 sub_type null`이라
  // **바로 다음 단계인 불변식 검사**를 붉게 만든다(2026-08-21 실측: 고객 19건·계정 17건 적체).
  // 경고가 상시화되면 진짜 위반이 그 안에 묻히므로 회귀를 깨끗한 상태에서 시작한다.
  // 2시간 이내 픽스처는 건드리지 않는다 — 다른 세션이 지금 돌리는 스위트를 무너뜨리지 않기 위해서다.
  // 그래서 이 청소가 걷어내는 것은 **직전 회귀가 흘린 것**이다(이번 실행분은 다음 회귀가 치운다).
  { name: '테스트 잔재 청소',          cmd: 'node scripts/cleanup-test-leftovers.mjs --apply' },
  { name: '빌드(타입체크)',            cmd: 'npm run build' },
  { name: '데이터 불변식(스테이징)',    cmd: 'node scripts/check-data-invariants.mjs' },
  // 한글 폰트 자립(소방계획서_서버.md §15.3) — 저장소가 폰트의 단일 원천임을 상시 고정한다.
  //   여기선 파일 축만 본다(sha256·패밀리명·글리프 커버리지) — 환경에 기대지 않아 어디서 돌려도 같은 답.
  //   fontconfig 해석·실제 래스터 구조(두부 판정)는 Alpine 안에서만 의미가 있어 Dockerfile이 검사한다.
  { name: '한글 폰트 자산(파일 축)',    cmd: 'node scripts/assert-korean-glyphs.mjs --files-only' },
  // 웹 한글폰트(소방계획서_35 S1) — 위 항목과 **다른 폰트, 다른 축**이다.
  //   위: assets/fonts 나눔고딕 = 서버 PDF·정적지도용. 아래: public/fonts Pretendard = 화면용.
  //   자산(92조각 sha256)·CSS 배선(음절 전수 커버·스택 **순서**)·서빙(본문 매직·immutable)을 본다.
  //   서버가 없으면 서빙 축은 스스로 건너뛴다.
  { name: '웹 한글폰트(자산·배선·서빙)', cmd: 'node scripts/assert-web-korean-font.mjs' },
  // 한글이 **실제로 Pretendard로 그려졌는가** — 위가 '가능한가'라면 이건 '그렇게 그려졌는가'다.
  //   3중 폭 대조(화면 ≈ Pretendard AND ≠ 맑은고딕). fonts.check()·computed fontFamily는
  //   폰트가 404여도 통과하는 항진명제라 쓰지 않는다(스크립트 머리주석 참조).
  //   변이 검증은 `--mutate`로 따로 돌린다(그 실행은 초록이 정상 — 판별자가 살아있다는 뜻).
  { name: '한글 렌더 축(E2E)',          cmd: 'npx tsx scripts/test-korean-font-render.mts', needServer: true },
  // 서식 가독성(소방계획서_35) — 세 축을 따로 돈다. 한 번에 묶으면 무엇이 깨졌는지 안 보인다.
  //   --identity : 코드모드가 값을 바꾸지 않았음(S2 항등). 기준선은 _fixtures/35-baseline.json 고정.
  //                기준을 'HEAD:'나 '지금 화면'으로 잡으면 무엇을 해도 통과한다.
  //   --overflow : 표 넘침·페이지 밀림. **검사한 표 수를 기준선과 대조**해 '안 그려져서 초록'을 막는다
  //                (실제로 dev 타임아웃으로 10/15 화면만 걷힌 실행을 이 가드가 잡았다).
  //   --print    : 화면 배율이 인쇄로 새지 않는가 — 사용자 결정 D35-5의 실증. 배율 lg·xl까지 본다.
  //   --overflow는 배율 축(S6-2·3·4)도 함께 본다 — 화면을 다시 열지 않고 <html data-fs>만
  //   갈아끼워 재므로 이동 횟수는 그대로다.
  { name: '서식 가독성 항등(E2E)',      cmd: 'npx tsx scripts/test-plan-readability.mts --identity', needServer: true },
  { name: '서식 표 넘침·배율(E2E)',     cmd: 'npx tsx scripts/test-plan-readability.mts --overflow', needServer: true },
  { name: '서식 인쇄 격리(E2E)',        cmd: 'npx tsx scripts/test-plan-readability.mts --print',    needServer: true },
  // 글자 배율 4경로 — 다크 모드(test-theme-settings)와 같은 구조. DB·쿠키·<html data-fs> **3축이
  // 함께** 맞아야 통과다. 한 축만 보면 '화면은 커졌는데 다른 기기엔 안 따라간다'를 못 잡는다.
  { name: '글자 배율 4경로(E2E)',       cmd: 'npx tsx scripts/test-font-scale.mts', needServer: true },
  // 점검표 진행률 집계 — 분모(시트 항목 수)·O/X/N·범위 판정을 독립 재계산과 대조한다.
  // 서버는 필요 없지만 Next 런타임 밖이라 --conditions=react-server가 필수다(server-only 패키지).
  { name: '점검표 진행률 집계',        cmd: 'npx tsx --conditions=react-server scripts/test-sheet-overview.mts' },
  // 소방계획서_33 — 종합 대상의 2차는 작동점검. 생성 3축·가드 3케이스(축은 옮기되 없애지 않는다)·
  // 인쇄물 라벨·점검표 범위·재생성 멱등을 한 번에 고정한다. 2차를 종합으로 되돌리는 경로가
  // 5개(생성기·수동추가·초과해결·고객동기화·수동등록)라 결과 축에서 감시하는 편이 싸다.
  { name: '2차=작동 규약(소방계획서_33)', cmd: 'npx tsx scripts/test-second-round-operational.mts' },
  // 소방계획서_36 — 단계 완료일·제출일이 UTC로 찍히던 결함(F-14). KST는 UTC+9라 00:00~09:00에
  // 완료한 건이 **어제 날짜**로 보였다. ⚠ 하루 중 9시간 창에서만 재현되므로 '지금'으로 재면
  // 낮에 돌린 검사는 영원히 초록이다 — 고정 입력으로만 판정하고, 되살아남은 정적 가드로 막는다.
  { name: 'KST 날짜 변환(소방계획서_36)', cmd: 'npx tsx scripts/test-kst-date.mts' },
  // revalidate 축이 헬퍼 한 곳에 모여 있는가(S2-7). 가드를 9곳에 복붙하면 8곳이 깨지므로(F-1)
  // '가드 생략은 정확히 2곳'을 수로 고정한다 — 늘면 단계 외 서버 prop이 안 갱신된다.
  { name: 'revalidate 축(소방계획서_36)', cmd: 'npx tsx scripts/test-36-revalidate-axis.mts' },
  // 갑지 워크북(소방계획서_27) — 템플릿 지문·앵커 라벨·완전 덮어쓰기 불변식(실고객 흔적 0).
  // 여기가 붉으면 갑지 서식이 갱신된 것 — build-workbook-template 재실행 + 앵커 재실측(Q-4)
  { name: '갑지 워크북 앵커·템플릿',    cmd: 'npx tsx scripts/test-xlsx-anchors.mts' },
  // 주입 후 서식 무손상(styles.xml 바이트 동일·병합 불변)·값 정확성·폐포 전파.
  // 폐포가 깨지면 옛 값이 스포크에 남는다 — 다른 고객 문서에 남의 상호가 인쇄되는 부류의 결함
  { name: '갑지 워크북 주입',          cmd: 'npx tsx scripts/test-xlsx-inject.mts' },
  // 설비별 점검표 동봉 자산(Phase 5) — 지문·매핑·표본 흔적 0·제거 수술·선별 규칙.
  // 여기가 붉으면 갑지 또는 전체 보고서가 갱신된 것 — build-workbook-full 재실행(Q-4)
  { name: '갑지 워크북 도너 자산',      cmd: 'npx tsx scripts/test-xlsx-donors.mts' },
  // 점검표 응답이 엑셀에 **하나도 안 실리는데 위 검사들이 전부 초록**이었다(2026-08-29 신고).
  // 원인은 축의 부재 — 기존 검사는 '넣은 것이 들어갔나'만 보고 '넣었어야 할 것이 빠졌나'를
  // 본 적이 없었다. 이 검사가 그 역방향(자산에 줄이 없는 항목 수)을 핀으로 붙든다.
  // 결과열을 C로 고정하면 넓은 서식 4시트의 점검항목 문구를 덮어쓰므로 J열 시트를 이름으로 단언한다.
  { name: '갑지 점검표 항목 좌표',      cmd: 'npx tsx scripts/test-xlsx-itemmap.mts' },
  // 서버 불필요 — 순수 렌더 함수 대조. 중복 입력 제거(대장 파생·미러)가 문서에 반영되는지 고정
  { name: '세부제원 파생·미러 렌더',    cmd: 'npx tsx scripts/test-spec-derive.mts' },
  // 인쇄 번들 셀 오버라이드(lib/doc-overrides) — 파서 없이 문자열을 훑어 법정 서식의 특정 칸을
  // 덮어쓰는 층이다. 두 가지가 조용히 깨질 수 있어 상시 고정한다:
  //   ① 템플릿의 태그 열기·닫기 균형 — 깨지면 오버라이드가 엉뚱한 범위를 덮어써 서식이 망가진다
  //   ② highlight on/off 앵커 동일성 — 갈리면 미리보기에서 고친 칸과 인쇄되는 칸이 어긋난다
  // 그리고 점검결과 마크 칸에 키가 새면 자체점검 결과 위조 통로가 된다.
  { name: '별지 셀 오버라이드',         cmd: 'npx tsx scripts/test-annex-overrides.mts' },
  // 3쪽 1절 두 축(설치 √ / 점검결과 ○×)의 귀속 — 양방향으로 조용히 틀릴 수 있는 자리다.
  // 번짐을 안 막으면 설치도 안 한 설비에 ○가 찍히고(위조), 과하게 막으면 대장에 체크를
  // 빠뜨렸을 뿐인 실점검이 해당없음 ／로 지워진다. 두 실패 모두 인쇄물만 보면 멀쩡하다.
  { name: '3쪽 설치·결과 축 귀속',      cmd: 'npx tsx scripts/test-form3-axis.mts' },
  // 1.4 설비별 결과 입력(소방계획서_26) — 배지·패널 배선 + 쓰기 경로(일괄 ○·항목 ✕→불량 자동 등록).
  // 결과의 단일 원천은 점검표 응답인데 입력 자리가 둘이 됐다. 배선이 끊기면 화면은 멀쩡한데
  // 기록이 안 남거나(배지 그대로) 엉뚱한 회차에 쓰인다 — 둘 다 인쇄물을 봐야 알게 된다.
  { name: '1.4 설비별 결과 입력(E2E)',   cmd: 'npx tsx scripts/_probe-form14-result-badge.mts', needServer: true },
  // 점검표 입력 전용 페이지(소방계획서_28) — 입력의 정본. ★ 설치인데 응답 0건인 설비가
  // 화면에 ⚠로 드러나는지가 핵심(2026-08-24 물분무 공란 사고의 회귀 방어).
  { name: '점검표 입력 전용 페이지(E2E)', cmd: 'npx tsx scripts/test-sheet-entry-page.mts', needServer: true },
  // 같은 페이지의 **동시 편집 보호** — 두 사람이 같은 점검을 열면 전용 페이지가 조용히 덮어쓰던 것을
  // 드로어와 같은 규약(Realtime + 훅 계약 ③ pause/resume)으로 막았다. 코드 존재로는 증명되지 않는
  // 축이라(이식 전 대조군에서 '차단' 검사가 itemC=O로 붉었다) 브라우저 + DB 실측으로 고정한다
  { name: '점검표 동시 편집 보호(E2E)',   cmd: 'npx tsx scripts/test-sheet-entry-concurrent.mts', needServer: true },
  // S9-1 재생성 차단 — 규약 버전 축(149). 날짜 상수(CUTOFF)의 부활, 스탬프 배선 유실,
  // 미상+응답 차단 규칙의 완화를 전부 여기서 잡는다 — 종전 날짜 축은 기입 즉시 전건 차단 사고를 냈다.
  { name: 'S9-1 재생성 규약 축',         cmd: 'npx tsx scripts/test-regen-protocol.mts' },
  // 공휴일은 영업일 → 6단계 마감일을 결정한다. 하나만 틀려도 법정 제출기한이 밀리는데
  // 화면 어디에도 안 드러난다 — 순수 산출을 공공API 확정본과 대조해 상시 고정 (소방계획서_25)
  { name: '공휴일 대체 규칙',          cmd: 'npx tsx scripts/test-holiday-rules.mts' },
  // SMS는 돈이 나가고 되돌릴 수 없다. 수신자 선정·중복 접기·응답 판정이 틀려도 화면은 멀쩡해 보이므로
  // (실패를 '발송됨'으로 보이게 한 P-1·P-2가 정확히 그랬다) 순수 함수 단계에서 결정적으로 고정한다
  { name: 'SMS 순수 함수',             cmd: 'npx tsx scripts/test-sms-pure.mts' },
  // 단계 [입력] 링크 — 서버 불필요(순수 함수 + 소스 배선). 6단계는 증거가 등록되면 자동 완료되는데
  // 그 자리로 가는 링크가 없어 사용자가 [사유 완료](증거 없는 예외)밖에 못 누르던 것을 이은 기능.
  // 링크가 조용히 끊기면 다시 그 상태로 돌아가므로 목적지·배선을 함께 고정한다
  { name: '단계 입력 링크(순수·배선)',  cmd: 'npx tsx scripts/test-step-input-link.mts' },
  { name: '게이트 정합성(E2E)',        cmd: 'npx tsx scripts/test-gate-consistency.mts', needServer: true },
  { name: '일반관리 자체점검 통주행(E2E)', cmd: 'npx tsx scripts/test-general-selfinspection.mts', needServer: true },
  { name: '문서 생성 회귀(E2E)',           cmd: 'npx tsx scripts/test-doc-generation.mts', needServer: true },
  // 갑지 워크북 실주행 — 라우트는 공개 엔드포인트라 인증 차단·실바이트·주입 값까지 실제로 태운다
  { name: '갑지 워크북 다운로드(E2E)',      cmd: 'npx tsx scripts/test-workbook-e2e.mts',   needServer: true },
  { name: '클릭 예산(E2E)',           cmd: 'npx tsx scripts/test-click-budget.mts',     needServer: true },
  { name: 'EX-V1 음수전표(E2E)',      cmd: 'npx tsx scripts/test-ex-v1.mts',            needServer: true },
  // 소방계획서_16 S6-4 — 점검표 축·트리 인라인 입력(Realtime 포함) 상시 회귀
  { name: '점검표 범위 축(E2E)',        cmd: 'npx tsx scripts/test-sheet-scope-axis.mts',    needServer: true },
  { name: '점검표 트리 인라인(E2E)',    cmd: 'npx tsx scripts/test-annex-sheet-inline.mts',  needServer: true },
  // 별지 서식이 소방계획서 탭 **안**에서 최상위 탭으로 갈라졌다(소방계획서_34). 4종을 함께 등재한다.
  //   앞의 둘은 34 이전부터 미등재라 조용히 썩고 있던 것 — 등재하지 않으면 아무도 안 돌린다(드로어 2종의 전례).
  //   신규 둘은 갈라진 탭이 소리 없이 무너지는 자리를 붙든다:
  //     ① 하위호환 정규화(?tab=plan&form=annex → 별지 탭)를 누가 지우면 사용자 북마크와 무수정 통과
  //        프로브 11종이 **함께** 죽는데, 그 11종은 goto만 하므로 스스로는 초록으로 죽는다
  //     ② lazyKeys가 끊기면 기본정보만 열어도 별지 회차 조회가 돌아 모든 고객 상세가 왕복 하나씩 늘어난다 —
  //        증상이 '좀 느려졌다'뿐이라 화면으로는 영영 모른다
  //     ③ 같은 pathname으로 ?tab=만 바꾸는 이동은 서버를 재렌더하지 않는다. 실패하면 사용자는 화면에
  //        그대로 남고 **아무 일도 안 일어난 것처럼 보인다**(에러도 로그도 없다)
  { name: '소방계획서 탭(E2E)',         cmd: 'npx tsx scripts/test-plan-tab.mts',             needServer: true },
  { name: '별지 상호작용(E2E)',         cmd: 'npx tsx scripts/test-annex-interaction.mts',    needServer: true },
  { name: '별지 탭 승격(프로브)',        cmd: 'npx tsx scripts/_probe-annex-tab.mts',          needServer: true },
  { name: '별지 같은경로 이동(프로브)',   cmd: 'npx tsx scripts/_probe-annex-samepath-nav.mts', needServer: true },
  // 드로어(B) — 사용자 결정으로 현장용 입력구를 유지한다(소방계획서_28 D-5). 유지하는 이상 회귀도 막아야
  // 하는데 이 두 스위트가 **미등록이라 썩어 있었다**: mu-sheet는 `9b43cc0`에서 사라진 [저장] 버튼을
  // 눌러 15초 타임아웃으로 죽었고(3/1), mother-drawer(67단언)는 아무도 안 돌렸다.
  // 등재하지 않으면 A만 초록인 채 B가 조용히 썩는다 — 그게 애초에 A에 보호가 빠졌던 경위다.
  { name: 'MU 시트 드로어(E2E)',        cmd: 'npx tsx scripts/test-mu-sheet.mts',            needServer: true },
  { name: '머더 카드·드로어(E2E)',      cmd: 'npx tsx scripts/test-sheet-mother-drawer.mts', needServer: true },
  // 고객명 검색은 목록을 거르는 축이라 조용히 깨지면 '검색해도 안 나온다'로만 드러난다
  { name: '점검 고객명 검색(E2E)',      cmd: 'npx tsx scripts/test-inspection-customer-search.mts', needServer: true },
  // 최근 본 고객 스트립 — '기본 정렬은 그대로 둔다'가 이 기능의 설계 전제라 그것까지 고정한다
  { name: '최근 본 고객(E2E)',          cmd: 'npx tsx scripts/test-recent-customers.mts',           needServer: true },
  // 불량 전/후 사진 — 비공개 버킷에 public URL을 저장해 사진이 전부 안 뜨던 결함의 회귀 방어.
  // src만 보면 통과하므로 naturalWidth로 '실제로 그려졌는지'까지 본다
  { name: '불량 전/후 사진(E2E)',       cmd: 'npx tsx scripts/test-defect-photos.mts',              needServer: true },
  // ④⑥ 제출일 — 화면 반영이 느려지면 '눌러도 반응이 없다'로 읽힌다(실측 5초 → 2초로 고친 건).
  // 눈에 안 보이는 회귀라 시간 예산을 테스트로 고정한다
  { name: '제출일 즉시 피드백(E2E)',    cmd: 'npx tsx scripts/test-step-submit-feedback.mts',       needServer: true },
  // 보관함 과거본 정리(소방계획서_18)는 폐기됨(2026-08-18) — 관련 E2E·프로브 2건도 함께 삭제.
  // 마커 보존 프로브는 남긴다: 정리 기능은 없어져도 **과거 마커를 읽는 판정**은 그대로 살아 있고,
  // 오프라인 보고·사유 완료 마커까지 보존 대상이라 크론이 지우면 그 단계들이 되살아난다.
  { name: '로그 보존 마커 제외(프로브)', cmd: 'npx tsx --conditions=react-server scripts/_probe-purge-marker.mts' },
  // ② 배치확인서 — 종이 보관 기록 + 업로드 파일 삭제(제안1·2)
  { name: '배치확인서 종이·삭제(E2E)',   cmd: 'npx tsx scripts/test-cert-paper-delete.mts',   needServer: true },
  // ★ 기간 입력 — 종료일이 시작일보다 빨라도 "저장했습니다"가 뜨고 그대로 들어가던 결함(2026-08-19).
  // 조용히 틀린 값이 남는 종류라 화면만 봐서는 영영 모른다. 저장 액션 5곳의 방어를 함께 고정한다 —
  // 'use server' export는 공개 엔드포인트라 화면 검사만 남으면 우회된다
  { name: '기간 입력 검증(E2E)',         cmd: 'npx tsx scripts/test-date-range.mts',          needServer: true },
  // 단계 [입력] 링크 실주행 — 드로어 자동 오픈은 마운트 타이밍·RSC 커밋에 걸리기 쉬워
  // 소스 검사(위 순수·배선)로는 증명되지 않는다. 클릭해서 실제로 열리는지까지 본다
  { name: '단계 입력 링크(E2E)',         cmd: 'npx tsx scripts/test-step-input-link-e2e.mts', needServer: true },
  // 별지 미리보기 칸 — Pane이 높이를 자식에게 안 물려줘 iframe이 min-h(224px)에 갇히고
  // 칸 594px 중 322px이 죽어 있던 결함. 레이아웃 회귀는 눈으로만 알 수 있어 수치로 못 박는다
  { name: '미리보기 칸 높이·확대(E2E)',  cmd: 'npx tsx scripts/test-preview-pane.mts',        needServer: true },
  // 건물용도 콤보 — datalist는 타이핑 전엔 목록이 안 떠서 "선택하거나"가 거짓말이었다.
  // 되돌려 select로 바꾸면 대장이 넣는 목록 밖 용도가 잘리므로 '자유 입력 보존'까지 함께 고정한다
  { name: '건물용도 콤보(E2E)',          cmd: 'npx tsx scripts/test-purpose-combo.mts',       needServer: true },
  // 점검일은 계획·체크리스트·서류가 같이 봐야 하는 값인데 축이 넷이라 한 경로만 빠져도 조용히 갈라진다
  // (소방계획서_24 P-19: 인라인 달력이 inspections.inspection_start_date를 안 고쳐 별지 9호 점검기간이
  //  옛 날짜로 인쇄될 수 있었다). 다섯 경로 × 네 축을 상시 고정한다
  { name: '점검일 동기화 5경로(E2E)',    cmd: 'npx tsx scripts/test-plan-date-sync.mts',      needServer: true },
  // 사전 안내 SMS — 서버 로직은 _probe-sms-send가 덮고, 여기서는 **화면 배선**을 고정한다:
  // 모니터링 폐지 후 링크가 살아 있는지 · 달력에서 열어도 자체점검이 목록에 드는지(Q-14의 핵심) ·
  // 미확정 건이 조용히 빠지지 않는지 · 수신 미지정 시 폴백 1명인지(문자량이 몇 배가 되지 않게)
  { name: '사전 안내 SMS 배선(E2E)',     cmd: 'npx tsx scripts/test-inspection-sms.mts',      needServer: true },
  // 지역 일괄 이동 — 건별 실패를 삼키면 담당자는 5건이 다 옮겨진 줄 알고 **안 옮겨진 곳에 안 간다**.
  // 실제로 정기의 '같은 달' 가드가 이 경로에서만 새고 있었다(S11-9 E2E가 잡아냄: moved:2·failed:[]).
  // 반환값과 DB를 함께 대조한다 — 응답과 데이터가 갈라지는 것이 이 기능의 최악 시나리오다
  { name: '지역 일괄 이동(E2E)',         cmd: 'npx tsx scripts/test-sms-bulk-move.mts',       needServer: true },
  { name: 'SMS 발송 모듈(프로브)',       cmd: 'npx tsx --conditions=react-server scripts/_probe-sms-send.mts' },
  // ★ 독립 검증 J24-B1 — 발송 이력 기록이 실패하면 **보내지 않는다**. 종전엔 insert 오류를 버리고
  // 그대로 발송해 '돈은 나갔는데 기록이 없는' 건이 생길 수 있었다(→ 화면은 미발송 → 재발송·이중 과금).
  // 자격증명을 넣은 상태로 시험해야 변별력이 생긴다 — 키가 없으면 어차피 안 나가기 때문
  { name: 'SMS 기록 실패 시 발송 중단(프로브)', cmd: 'npx tsx --conditions=react-server scripts/_probe-sms-claim-fail.mts' },
]

let serverUp = false
try { const r = await fetch('http://localhost:3000/login', { method: 'HEAD' }); serverUp = r.ok } catch { serverUp = false }
if (!serverUp) console.log('ℹ localhost:3000 미기동 — E2E 단계는 건너뜁니다(무서버 게이트만 실행). 전체 실행하려면 먼저 `npm run dev` 또는 `npm start`.\n')

// ── 시작 전에 **환경**부터 본다 (2026-08-19) ────────────────────────────────
// dev 서버는 회귀 한 번에 수 GB를 먹는다(재기동 30분 만에 26MB → 4.2GB 실측).
// 여유 메모리가 마르면 page.goto가 타임아웃하는데, 그 증상이 하필
// "실행마다 다른 테스트가 실패하고 단독 실행은 통과"로 나타나 코드를 의심하게 만든다.
// 여기서 미리 경고해 두면, 뒤에 실패가 나왔을 때 로그 맨 위를 보고 원인을 바로 안다.
if (serverUp) {
  try { execSync('node scripts/check-dev-memory.mjs', { stdio: 'inherit' }) } catch { /* 진단 실패는 무시 */ }
}

const results: Array<{ name: string; status: 'PASS' | 'FAIL' | 'SKIP' }> = []
for (const s of steps) {
  if (s.needServer && !serverUp) { results.push({ name: s.name, status: 'SKIP' }); console.log(`⏭  ${s.name} — 건너뜀(서버 없음)`); continue }
  console.log(`\n▶ ${s.name} …`)
  try {
    execSync(s.cmd, { stdio: 'inherit' })
    results.push({ name: s.name, status: 'PASS' })
  } catch {
    results.push({ name: s.name, status: 'FAIL' })
  }
}

console.log('\n──────── 전체 테스트 요약 ────────')
for (const r of results) console.log(`  ${r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭'} ${r.name} — ${r.status}`)
const failed = results.filter(r => r.status === 'FAIL').length
console.log(failed === 0 ? '\n✅ 실패 0건' : `\n❌ 실패 ${failed}건`)
process.exit(failed > 0 ? 1 : 0)
