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
  // S2 코드모드가 **전단사였다**는 정적 재증명(소방계획서_35 S2-7). 서버가 필요 없다.
  //   독립 판정은 구현자의 "항등은 이제 재현 불가"를 반박했고 그 반박이 옳았다 — 코드모드 커밋
  //   4ccda41과 그 부모가 저장소에 있으므로 언제든 다시 증명된다. 기준 sha를 **상수로 박아**
  //   뒤 커밋이 16파일을 건드려도 썩지 않게 했다(feedback_probe_baseline_pin).
  //   줄 단위 diff가 아니라 **클래스 다중집합**을 본다 — 4ccda41은 클래스 말고도 세 가지를
  //   함께 해서(TableWrap·colgroup calc·배율 토글) 줄 오프셋이 밀리기 때문이다.
  { name: '서식 코드모드 전단사(정적)',  cmd: 'node scripts/codemod-35-font-tokens.mjs --verify-bijection' },
  { name: '서식 가독성 항등(E2E)',      cmd: 'npx tsx scripts/test-plan-readability.mts --identity', needServer: true },
  { name: '서식 표 넘침·배율(E2E)',     cmd: 'npx tsx scripts/test-plan-readability.mts --overflow', needServer: true },
  { name: '서식 인쇄 격리(E2E)',        cmd: 'npx tsx scripts/test-plan-readability.mts --print',    needServer: true },
  // FOUT 리플로우(S0-6 / W-7) — Pretendard가 늦게 도착하며 표 행이 위로 밀리는 양을 고정한다.
  //   ⚠ **차단 대조군과의 차이**로 폰트에 귀속시킨다. 대조군 없이 재면 로컬은 폰트가 즉시 와서
  //     0.008이 나오고 "양호(<0.1)"라는 거짓 초록이 된다 — 실제 값은 0.27이다(33배 차이).
  //   ⚠ 측정 화면이 1.4인 것도 조건이다. /customers에서 재면 노이즈에 묻혀 0이 나온다 —
  //     '쟀는데 0'은 문제 없음이 아니라 아픈 데를 안 본 것일 수 있다.
  //   이 단언은 '좋다'가 아니라 '**나빠지지 않았다**'이다(현재 값 자체가 개선 대상).
  { name: '서식 FOUT 리플로우(E2E)',    cmd: 'npx tsx scripts/test-plan-readability.mts --cls',      needServer: true },
  // 글자 배율 4경로 — 다크 모드(test-theme-settings)와 같은 구조. DB·쿠키·<html data-fs> **3축이
  // 함께** 맞아야 통과다. 한 축만 보면 '화면은 커졌는데 다른 기기엔 안 따라간다'를 못 잡는다.
  { name: '글자 배율 4경로(E2E)',       cmd: 'npx tsx scripts/test-font-scale.mts', needServer: true },
  // 변이 축(S35B·S4-13) — **검사의 검사**다. 부스트만 죽였을 때 B-10이 실제로 무너지는지 보고,
  //   무너지지 않으면 "B-10이 항진명제다"라고 빨갛게 만든다. 기대가 **반전**된 실행이라
  //   위 4경로와 같은 파일이어도 같은 것을 묻지 않는다.
  //   ⚠ 등재하는 이유: 종전에는 수동으로만 돌렸고, 그러면 판별자가 죽어도 아무도 모른다 —
  //     초록은 '기능이 산다'가 아니라 '검사가 산다'까지 말해야 한다(소방계획서_37 R-c).
  { name: '글자 배율 변이축(E2E)',      cmd: 'npx tsx scripts/test-font-scale.mts --mutate', needServer: true },
  // 점검표 진행률 집계 — 분모(시트 항목 수)·O/X/N·범위 판정을 독립 재계산과 대조한다.
  // 서버는 필요 없지만 Next 런타임 밖이라 --conditions=react-server가 필수다(server-only 패키지).
  { name: '점검표 진행률 집계',        cmd: 'npx tsx --conditions=react-server scripts/test-sheet-overview.mts' },
  // 별지·소방계획서 미리보기 다크 모드 판독성(2026-09-03) — 문서 골격이 흰 배경을 스스로 선언하는가.
  // 배경 선언이 빠지면 iframe이 투명해져 다크 모드에서 검은 글자가 어두운 배경 위에 얹힌다
  // (별지 9호·10호 실사용자 신고). 같은 HTML에서 선언만 벗긴 대조군과 픽셀 밝기로 대조 — 무DB·무서버.
  { name: '미리보기 다크 판독성',      cmd: 'npx tsx scripts/_probe-preview-dark.mts' },
  // 소방계획서_39 — 완료 보류(3층 하드)의 **실패 방향**. 이 가드는 틀려도 화면이 붉어지지 않는다:
  // 응답 조회가 실패하면 전 항목이 무응답으로 보여 완료가 조용히 전건 차단되고(판정자 실측 57→195),
  // 카탈로그가 죽으면 반대로 가드가 조용히 해제된다. 주입 실패로만 잡히므로 등재한다.
  // 보류 판정 축 == 화면 카운터 축(실데이터 전수)과 미비 문구 ↔ [고치기] 딥링크 접두도 같이 고정.
  { name: '완료 보류 가드 실패방향(39)', cmd: 'npx tsx --conditions=react-server scripts/_probe-39-guards.mts' },
  // 39 S3 보류 왕복(hold→해소→completed·scheduled 강등·completed 소급 없음) — 픽스처 자체 생성·정리.
  { name: '완료 보류 왕복(39)',        cmd: 'npx tsx --conditions=react-server scripts/_probe-39-hold.mts' },
  // 소방계획서_45 — 6단계 판정(⑤⑥ 해당없음 축)의 순수 단언 + 스테이징 실주행.
  // ⚠ 3차 독립 판정(2026-09-09)이 **이 스위트가 게이트에 없다**는 것을 잡았다: 76단언이 초록인데
  // 아무도 안 돌리고 있었다. 이 축은 `inspections.status='completed'`를 DB에 쓰는 데까지 가므로
  // (applyStepSideEffects) 틀리면 「하지 않은 일이 완료로 남는다」(D34-2). 반드시 등재 상태로 둔다.
  { name: '6단계 판정·모두합격 축(45)',  cmd: 'npx tsx --conditions=react-server scripts/test-inspection-steps-sync.mts' },
  // 45 §S10~S12 정적 규약 — 판정 3회가 같은 형태로 반복해서 잡은 것들이 되돌아오지 않게 고정한다
  // (「셋 중 둘」 포장 · 조용한 폴백 · 화면 쌍둥이 · `.in()` URL 쪼개기).
  { name: '모두합격 축 이웃 규약(45)',   cmd: 'node scripts/_probe-45-neighbors.mjs' },
  // 소방계획서_33 — 종합 대상의 2차는 작동점검. 생성 3축·가드 3케이스(축은 옮기되 없애지 않는다)·
  // 인쇄물 라벨·점검표 범위·재생성 멱등을 한 번에 고정한다. 2차를 종합으로 되돌리는 경로가
  // 5개(생성기·수동추가·초과해결·고객동기화·수동등록)라 결과 축에서 감시하는 편이 싸다.
  { name: '2차=작동 규약(소방계획서_33)', cmd: 'npx tsx scripts/test-second-round-operational.mts' },
  // 법정 최초점검(사용승인일+60일)과 별지 3분기 체크. **순수·무DB**라 가장 싸다.
  // 종전 판정은 "우리 DB에 종합점검 이력이 없으면 최초"였고, 별지 9호 3분기는 라벨 축과 다른
  // 컬럼을 봐서 일반관리 고객이면 세 칸이 모두 빈칸으로 인쇄됐다. 두 축이 다시 갈라지면
  // '라벨 축과 체크박스 축이 전 조합에서 일치' 단언이 즉시 빨개진다.
  { name: '최초점검·3분기 축(법령)',     cmd: 'npx tsx scripts/test-initial-inspection.mts' },
  // 기산점 축 — 사용승인일/점검계획일 우선순위. **가장 중요한 단언은 마이그레이션 155 적용 전
  // 동작이 종전과 같다는 것**이다(레거시 폴백). 그게 깨지면 코드 배포만으로 전 고객 일정이 재배치된다.
  { name: '점검계획 기산점 축',          cmd: 'npx tsx scripts/test-plan-anchor-axis.mts' },
  // 변동 = 재계산 — 기산월이 바뀌면 특별점검이 법정 달에 앉아야 한다. 종전엔 어느 경로로도
  // **달이 안 옮겨졌다**(재계산은 plan_id를 안 건드리고, 생성기는 정기가 seq=1로 자리를 점유하면
  // UNIQUE 충돌로 조용히 스킵). 시작된 점검 불가침·멱등·다른 해 불간섭까지 함께 고정한다.
  { name: '특별점검 자리 재배치',        cmd: 'npx tsx scripts/test-special-slot.mts' },
  // 위 검사는 **함수가 뭘 계획했나**(경로 축)만 본다 — 경로가 하나 빠지면 못 본다. 실제로 그렇게
  // 빠졌다: 순수 함수는 create 요청서를 옳게 냈는데 집행부가 읽지 않아 법정 2차가 사라졌고
  // 그때도 경로 검사는 전부 초록이었다. 이 검사는 **재계산을 돌린 뒤 최종 모양**만 묻는다 —
  // 교체로 됐든 생성으로 됐든 무관해서 **어느 경로가 빠져도 빨강**이 된다.
  { name: '재계산 최종 상태',            cmd: 'npx tsx --conditions=react-server scripts/test-reconcile-endstate.mts' },
  // 일반관리 종합 = 소방안전관리 종합 (사용승인일 축) — 화면이 "정기 매월 유무만 다르다"고
  // 약속하는데, 이 축의 결함은 늘 관리유형 분기에서 났다(F-1·F-3·재계산 비대칭·toSpecial
  // 예정일). 같은 승인일의 쌍둥이를 나란히 돌려 특별점검 최종 상태가 문자열까지 같은지 묻는다.
  // A는 승격/강등, B는 생성/삭제로 **경로가 다른데 결과가 같아야** 한다. --with-start(수동)는
  // is_initial 실측까지 — activity_logs가 남아 상시 등재에서는 뺐다.
  { name: '종합 대상 동등성(관리유형)',   cmd: 'npx tsx --conditions=react-server scripts/test-jonghap-parity.mts' },
  // 위 검사들은 전부 **서버 쪽 판단**만 본다. 사용자가 값을 고치기 전에 무엇이 바뀌는지 보는
  // 미리보기는 화면 축이라 하나도 안 걸린다 — 실제로 점검종류 인라인은 setPreview까지 해 놓고
  // **팝업을 그릴 자리가 그 분기에 없어서** 아무 일도 안 일어났는데 서버 검사는 전부 초록이었다.
  // 그래서 이 검사는 DOM에 팝업이 뜨는지, 그리고 취소하면 DB가 그대로인지만 묻는다.
  { name: '기산점 변경 미리보기(E2E)',   cmd: 'npx tsx scripts/_probe-inline-preview.mts', needServer: true },
  // 소방계획서_36 — 단계 완료일·제출일이 UTC로 찍히던 결함(F-14). KST는 UTC+9라 00:00~09:00에
  // 완료한 건이 **어제 날짜**로 보였다. ⚠ 하루 중 9시간 창에서만 재현되므로 '지금'으로 재면
  // 낮에 돌린 검사는 영원히 초록이다 — 고정 입력으로만 판정하고, 되살아남은 정적 가드로 막는다.
  { name: 'KST 날짜 변환(소방계획서_36)', cmd: 'npx tsx scripts/test-kst-date.mts' },
  // revalidate 축이 헬퍼 한 곳에 모여 있는가(S2-7). 가드를 9곳에 복붙하면 8곳이 깨지므로(F-1)
  // '가드 생략은 정확히 2곳'을 수로 고정한다 — 늘면 단계 외 서버 prop이 안 갱신된다.
  { name: 'revalidate 축(소방계획서_36)', cmd: 'npx tsx scripts/test-36-revalidate-axis.mts' },
  // S7-3·S7-4 — 대비 축의 **정적** 규약(print: 불간섭 · 신규 hex 0 · 토큰 두 모드 정의).
  // 래칫(아래 E2E)은 서버가 있어야 도는데 이 규약들은 소스만 보면 판정되므로 여기서 상시로 건다.
  // 독립 판정이 "규약은 있는데 고정하는 검사가 없다"고 지적한 자리다.
  { name: '대비 정적 규약(소방계획서_36)', cmd: 'npx tsx scripts/test-36-contrast-static.mts' },
  // 소방계획서_35 DEF-D3 — 인쇄 소스가 **화면 배율 축과 분리돼 있는가**(S0-3). 35가 화면에
  // --fs-*/text-form-* 토큰을 깔았으므로 인쇄물이 그걸 물면 법정 서식이 사용자 배율에 흔들린다.
  // ⚠ 기준 sha는 **상수로 박혀 있다** — '지금 값'으로 매번 다시 잡으면 무엇을 해도 통과한다
  //   ([[feedback_probe_baseline_pin]]). 검사 자체는 7/0이었는데 **untracked라 아무도 안 돌렸다**.
  // ⚠ Next 런타임 밖이라 --conditions=react-server 필수(server-only 패키지) — 빼면 멀쩡한 검사가
  //   '깨진 것'으로 보인다([[feedback_test_suite_run_flags]]).
  { name: '인쇄 소스 배율 비의존(소방계획서_35)', cmd: 'npx tsx --conditions=react-server scripts/test-print-source-pin.mts' },
  // 소방계획서_35 DEF-B3 — 한 화면이 두 축으로 갈라지지 않는가. text-form-*을 쓰는 파일에
  // 하드코딩 크기가 섞이면 사용자가 배율을 올렸을 때 **화면의 절반만 커진다**.
  // 범위를 파일 목록으로 박지 않고 '토큰을 쓰는가'로 자기정의해 확산을 자동으로 따라간다.
  { name: '배율 축 정합(소방계획서_35)',  cmd: 'npx tsx scripts/test-35-scale-axis.mts' },
  // S4-2 — 불량표 입력이 **새로고침 없이** 칸 제목에 반영되는가 + reload 후 DB 대조.
  // 위험 ①(미리보기만 갱신되고 칸 제목이 굳어 '데이터가 갈라진 것처럼' 보이는 것)의 방어선.
  // S3 착수 **전에** 7/0을 확인하고 들어갔다 — 그래야 붉어진 것이 S3 탓이라고 말할 수 있다.
  { name: '불량표 실시간 집계(E2E)',     cmd: 'npx tsx scripts/test-workbench-defect-live.mts', needServer: true },
  // F-21 — 불량표 입력이 **단계(pane) 전환을 살아남는가**. ⑤·⑥은 조건부 렌더라 전환하면
  // DefectGrid가 언마운트되는데, S3-7이 셀 저장마다 돌던 router.refresh()를 걷어낸 뒤로
  // 서버 prop이 세션 내내 갱신되지 않아 **방금 저장한 값이 사라졌다**(예고가 아니라 실사고).
  // 새로고침하면 어떤 구현이든 통과하므로 **새로고침 없이** 전환만으로 판정한다(항진명제 회피).
  { name: '불량표 단계전환 보존(E2E)',   cmd: 'npx tsx scripts/test-workbench-defect-pane-switch.mts', needServer: true },
  // F-24 — 위 검사는 ⑤↔⑥만 오간다(둘은 부모의 미러를 공유하므로 클라이언트 안에서 값이 이어진다).
  // ① '불량 내역' 칸은 **서버가 그려 준 노드**라 그 미러가 안 닿는다 — 독립 판정이 라이브로
  // 잡은 회귀다. 지적받은 표면만 고치면 이웃이 남는다([[feedback_fix_the_sibling_too]]).
  { name: '불량표 → ① 칸 반영(E2E)',     cmd: 'npx tsx scripts/test-workbench-defect-pane1.mts', needServer: true },
  // ⑥ 완료 체크·⑤ 기간 일괄 적용(2026-09-10) — **구조 검사로는 닿지 않는 축**이라 따로 둔다.
  // 같은 차수의 test-action-period-derive는 "체크박스가 그려져 있다"까지만 말한다. 실제로 이
  // 프로브가 제품 결함을 하나 잡았다: 제어 컴포넌트라 **누른 직후 체크가 그대로 풀렸다**(날짜를
  // 서버가 정하므로 왕복 전에는 화면에 값이 없다) — 낙관 반영으로 고쳤고 그 회귀를 여기서 막는다.
  { name: '⑥ 완료 체크·⑤ 일괄(E2E)',    cmd: 'npx tsx scripts/test-defect-completion-checkbox.mts', needServer: true },
  // ⑥ 불량 조치 **전건 완료**(2026-09-11) — 위 스위트의 단순 반복이 아니라 **다중 행** 축이다.
  // 등재 이유: 한 번의 왕복이 여러 행을 바꾸는데, 제어 컴포넌트의 편집분은 **한 번의 갱신**으로
  // 얹어야 한다. 행마다 set()을 부르면 마지막 한 행만 남아 **DB는 초록인데 화면만 틀리다** —
  // 직접 변이로 확인했다: 그때 집계(3/3)는 **그대로 초록**이었고 행 단위 체크 단언만이 잡았다.
  { name: '⑥ 불량 전건 완료(E2E)',      cmd: 'npx tsx scripts/test-defect-complete-all.mts', needServer: true },
  // S4-1 — 저장 속도 회귀 예산. 임의 상수가 아니라 S1 대조군 관측 최댓값(21,918ms)×0.5다.
  // ⚠ 연속 2셀을 잰다: 종전 결함은 셀마다 **누적**되는 종류라 1회만 재면 못 잡는다(F-11).
  { name: '작업대 저장 예산(E2E)',       cmd: 'npx tsx scripts/test-workbench-save-budget.mts', needServer: true },
  // S6 — 텍스트 대비(WCAG 2.1 정식식). 래칫이라 **악화만** 막는다.
  // ⚠ FAIL 수만 보면 '안 그려져서 초록'을 못 잡으므로 라우트별 검사 대상 수 하한을 함께 단언한다
  //   (실제로 최초 baseline의 다크 드로어가 215칸만 걷혀 거짓으로 낮았다).
  { name: '텍스트 대비 래칫(E2E)',       cmd: 'npx tsx scripts/_probe-36-contrast.mts', needServer: true },
  // 갑지 워크북(소방계획서_27) — 템플릿 지문·앵커 라벨·완전 덮어쓰기 불변식(실고객 흔적 0).
  // 여기가 붉으면 갑지 서식이 갱신된 것 — build-workbook-template 재실행 + 앵커 재실측(Q-4)
  { name: '갑지 워크북 앵커·템플릿',    cmd: 'npx tsx scripts/test-xlsx-anchors.mts' },
  // 별지 9호 다수동(동별 인쇄) — 작성요령 10 「동별로 나누어 작성」. PDF 「동별」 쪽과 갑지
  // 「다수동일때」 3블록(2·3·4동)이 **같은 조립본**에서 나오는지 본다.
  // 🚨 등재 이유: 종전 ERP는 1동만 읽어 2동을 등록해도 어느 문서에도 안 실렸는데, 그 축을
  //   단언하는 검사가 하나도 없어 전 스위트가 초록이었다. 1동 고객(현재 전원) 무회귀도 여기서 본다.
  { name: '별지 9호 다수동(동별 인쇄)', cmd: 'npx tsx --conditions=react-server scripts/test-multi-building-form9.mts' },
  // 대표동 규칙·승계 — 「어느 동이 인쇄되는가」와 「지우면 누가 승계하는가」.
  // 🚨 등재 이유: `lib/primary-building`에 검사가 **하나도 없었다**. 별지 9호 2쪽·소방계획서 1.1·
  //   갑지 개요가 전부 여기서 고른 한 동을 인쇄하는데 규칙이 바뀌어도 잡아 줄 그물이 없었다.
  //   [B]가 160 백필 무회귀(표식 없으면 종전 최고참)를, [D]가 과잉 수리 금지를,
  //   [E]가 **액션이 그 규칙을 실제로 부르는지**(규칙만 옳고 아무도 안 부르는 경우)를 본다.
  { name: '대표동 규칙·승계',           cmd: 'npx tsx scripts/test-primary-building.mts' },
  // 점검표 → 1.4 자동 체크 판정(소방계획서_49 §9) — **시스템이 법정 대장에 쓰는** 자리다.
  // 🚨 등재 이유: 이 축 검사가 0건이라 어느 쪽으로 고쳐도 초록이었다. 핵심은 「켜는가」가 아니라
  //   **「켜면 안 될 때 안 켜는가」** — [B] ／는 트리거 아님 · [C] 후보가 둘 이상이면 안 켬
  //   (「스프링클러설비」 ○ 하나로 화재조기진압용스프링클러까지 켜지던 것) · [D] 이미 설치면 안 씀.
  //   [F]가 설계서 원안과 구·신이 갈리는지 대조한다 — 같으면 아무것도 안 고친 것이다.
  { name: '1.4 자동 체크 판정',         cmd: 'npx tsx --conditions=react-server scripts/test-facility-autocheck.mts' },
  // 작업대 칸 폭 계산 + ④ 2칸 구조(2026-09-11 사용자 A안).
  // 🚨 등재 이유: `pane-width.ts` 주석이 "회귀 고정은 _probe-pane-width"라고 적어 두고도
  //   **test-all에는 없었다** — 그래서 3칸을 타입으로 못 박은 채 아무도 안 재고 있었다.
  //   합 보존(전체 폭 불변)·최소폭·저장값 검증에 더해, ④가 duo를 고르는지와
  //   **칸을 없애며 [종료일 고치기]를 잃지 않았는지**를 소스로 센다(유일한 입구라 잃으면 기한을 못 고친다).
  { name: '작업대 칸 폭·④ 2칸 구조',    cmd: 'npx tsx --conditions=react-server scripts/_probe-pane-width.mts' },
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
  // 위 셋은 **자산·좌표** 축이다 — "앵커가 제자리인가". 이건 **실데이터 왕복**이다:
  // 실제 점검의 응답 243건이 산출 워크북의 같은 칸에 같은 마크로 실리는가(30 S5-5 · 32 D11).
  // 좌표가 맞아도 주입 파이프라인 한 단계가 빠지면 칸이 조용히 비고, 그건 인쇄물을 열어야 보인다.
  // ⚠ 2026-09-08까지 **미등재였다** — 30 S5-5가 "정식 승격·test:all 등록은 미실행"이라고
  //   스스로 적어 둔 채였다. 근거로 인용되는 검사가 회귀에서 안 돌면 그 근거는 시간이 지나며
  //   조용히 거짓이 된다(같은 형태를 이번 정리에서 다섯 번 만났다).
  { name: '갑지 실데이터 왕복(243칸)',  cmd: 'npx tsx --conditions=react-server scripts/_probe-d5-roundtrip.mts' },
  // 「불량사진」 시트(소방계획서_46) — 이 저장소에서 엑셀에 이미지를 넣는 유일한 코드다.
  // 조용히 깨지는 축이 셋 있어 상시 고정한다: ① localSheetId 재번호(틀리면 남의 인쇄영역이
  // 적용되는데 파일은 정상 개봉된다) ② 워크시트 요소 순서(LO는 통과·Excel만 복구) ③ 종횡비.
  // ⚠ server-only 패키지를 물어 --conditions=react-server 필수. A4 쪽수 축(--lo)은 LibreOffice가
  //    필요해 기본 실행에서 뺐다 — 행 높이·열 폭을 건드리면 그때는 반드시 --lo로 재확인할 것.
  { name: '갑지 불량사진 시트',        cmd: 'npx tsx --conditions=react-server scripts/test-photo-sheet.mts' },
  // 소방계획서 워크북(소방계획서_42 S7-2 · 미세 격자) — 지문·앵커·백지 불변식·무수식·행 삽입
  // 안전성·값 착지·정렬 축(47 B-12)을 자산 파일만으로 판정하는 **유일한 무서버 문지기**다.
  // ⚠ 2026-09-09까지 미등재였다(47 B-13) — 그래서 미세 격자 전환 커밋이 검증 스크립트를 안
  //   데려간 채 HEAD에 실렸어도(42 R-7 실사고) 회귀 그물이 조용했다. 여기가 붉으면 자산·앵커·
  //   manifest 셋 중 하나가 갈라진 것 — build-fire-plan-template 재실행부터 볼 것.
  { name: '소방계획서 워크북 자산',    cmd: 'npx tsx scripts/test-fire-plan-xlsx.mts' },
  // 건물 이름 중복 확인(2026-09-09) — 같은 고객에 같은 이름 동이 조용히 두 번 등록된 실사고.
  // ⚠ 핵심은 「막는가」가 아니라 **「다동을 안 막는가」**다 — 이름이 다르면 통과해야 한다.
  { name: '건물 이름 중복 판정',        cmd: 'npx tsx scripts/test-building-dup.mts' },
  // 건물 패널 초기 열림(2026-09-10 사용자 신고) — 위 중복 수리의 **그림자**를 고정한다.
  // 🚨 등재 이유: 폼을 접자 건축허가일·주차장을 **볼 방법이 사라졌다**(그 칸들은 목록 표에 없고
  //   수정 폼 안에만 있다). 사고는 막고 조회를 잃었는데 전 스위트가 초록이었고, 사용자가
  //   신고할 때까지 아무도 몰랐다. [C]가 `canManage` 게이트 부활을, [F]가 「1동에서 구·신 규칙이
  //   갈리는가」를 본다 — 대조군이 없으면 이 검사도 아무것도 안 지킨다.
  { name: '건물 패널 초기 열림(조회 경로)', cmd: 'npx tsx scripts/test-building-panel-open.mts' },
  // 용도 표기 축(소방계획서_47 B-15) — 한 값이 산출물마다 다르게 인쇄된다: PDF 세 자리와 엑셀
  // 표지·3.1·1.11.4는 「근린생활시설」, 엑셀 1.1·1.2.1은 「근생」(칸이 좁다). 규칙이 세 파일에
  // 흩어져 있어 한쪽만 고치면 조용히 갈라진다.
  // ⚠ 2026-09-09까지 이 축을 단언하는 검사가 **하나도 없었다** — 기존 픽스처의 용도가 갈래를
  //   타지 않는 값(업무시설·공동주택)이라 어느 쪽으로 고쳐도 전 스위트가 초록이었다.
  //   그래서 여기 픽스처는 「제2종근린생활시설」이고, 음성 대조(업무시설=원값)를 함께 든다.
  { name: '용도 표기 두 갈래(PDF·엑셀)', cmd: 'npx tsx --conditions=react-server scripts/test-purpose-label.mts' },
  // 주차장 축(2026-09-09) — 건물 폼에 저장한 값이 소방계획서 두 표면에 도달하는가.
  // ⚠ 종전엔 **조립기 select 목록에 컬럼이 없어** 어떤 산출물에도 안 나왔는데(사용자 지적으로
  //   드러났다) 이 축을 보는 검사가 하나도 없어 전 스위트가 초록이었다. 층이 넷(select→타입→
  //   앵커→값)이라 한 층만 봐서는 안 보인다. 음성 대조(빈 값이면 어느 상자도 안 켜짐) 포함.
  { name: '주차장 저장→문서 도달',      cmd: 'npx tsx --conditions=react-server scripts/test-parking-surface.mts' },
  // 서버 불필요 — 순수 렌더 함수 대조. 중복 입력 제거(대장 파생·미러)가 문서에 반영되는지 고정
  { name: '세부제원 파생·미러 렌더',    cmd: 'npx tsx scripts/test-spec-derive.mts' },
  // 인쇄 번들 셀 오버라이드(lib/doc-overrides) — 파서 없이 문자열을 훑어 법정 서식의 특정 칸을
  // 덮어쓰는 층이다. 두 가지가 조용히 깨질 수 있어 상시 고정한다:
  //   ① 템플릿의 태그 열기·닫기 균형 — 깨지면 오버라이드가 엉뚱한 범위를 덮어써 서식이 망가진다
  //   ② highlight on/off 앵커 동일성 — 갈리면 미리보기에서 고친 칸과 인쇄되는 칸이 어긋난다
  // 그리고 점검결과 마크 칸에 키가 새면 자체점검 결과 위조 통로가 된다.
  { name: '별지 셀 오버라이드',         cmd: 'npx tsx scripts/test-annex-overrides.mts' },
  // 별지 9호 2쪽 3행의 확정 해석(소방계획서_44) — 확정 창구는 소방계획서 1.10 하나뿐이고,
  // 그 값이 PDF·엑셀 두 산출물로 같이 나간다. 조용히 갈라지는 축이 셋이라 상시 고정한다:
  //   ① 자동 판정이 **부정을 단정**하기 시작하면 「미실시 √」가 근거 없이 인쇄된다(A9-6)
  //   ② 「보관」 폴백이 되살아나면 작성=보관으로 √가 찍힌다(Q-4 회귀 — 종전 동작이다)
  //   ③ 「작성」 판정이 다시 **키 개수**로 돌아가면 전년도 칸을 고르는 행위가 작성 √를 켠다(D-5)
  // 2026-09-08까지 게이트 밖이라 사람이 손으로 돌 때만 지켜졌다(독립 판정 적발).
  { name: '별지9호 전년도 실시사항',    cmd: 'npx tsx --conditions=react-server scripts/_probe-44-prev-year-duty.mts' },
  // 별지 10호 「이행조치 계획사항」 7행(2026-09-07) — 서식 원문·갑지 계획서 시트와 같은 구조다.
  // 두 가지가 조용히 갈라질 수 있어 고정한다: ① 문구가 8쪽 fold(결과참조/이상없음/해당없음)를
  // 안 타면 엑셀 현5와 다른 말이 인쇄된다 ② 일자가 **그룹별**이 아니라 총 기간 복제로 돌아가면
  // 불량이 흩어진 건에서 전 행이 같은 최장 기간으로 찍힌다(2026-09-07 이전의 실동작).
  { name: '별지 10호 계획사항 7행',     cmd: 'npx tsx --conditions=react-server scripts/test-report10-plan-rows.mts' },
  // 8쪽 「불량내용」 4상태 접기(소방계획서_41) — PDF 8쪽·갑지 현5·별지 10호 7행이 같은 fold를 탄다.
  // ⚠ 등록이 늦어(2026-09-08) 한동안 회귀 그물 밖이었다. 그 사이 스탬프 규칙 결함이 배포됐다:
  // 쓰기 경로가 메모 없는 X행에 항목명(질문문)을 굳히는데 조립은 「이름≠코드」만 봐서 사람 입력으로
  // 셌고, 「결과참조」가 사실상 발화하지 않았다 — 픽스처에 userEntered를 손으로 박은 검사는
  // 조립 규칙을 안 타므로 초록이었다. 지금은 [5]가 isUserEnteredDefectName을 직접 부른다.
  { name: '8쪽 불량내용 4상태 접기',    cmd: 'npx tsx --conditions=react-server scripts/test-defect-fold.mts' },
  // 별지 11호 완료 축(소방계획서_43) — PDF 11호와 갑지 엑셀 `완료보고서`가 같은 `annexDoneRows()`를
  // 탄다. 갑지 4행은 2026-09-08까지 **통째로 미배선**이었다: PDF는 건별로 찍는데 엑셀은 공란이라
  // 두 표면이 갈라져 있었다(D-1). 등재 이유는 그 재발이 **인쇄물만 보면 안 보이기** 때문이다 —
  // 엑셀 4칸이 비어도 서식은 멀쩡해 보이고, 일자는 틀린 값(계획 종료일)이 그럴듯하게 찍힌다.
  { name: '별지 11호 완료 축',         cmd: 'npx tsx --conditions=react-server scripts/test-annex-done-rows.mts' },
  // 같은 축의 **서식 실물** 왕복 — 앵커 라벨 대조 + I20의 `=개요!G10` 절단을 실제 xlsx에서 본다.
  // 수식이 살아 있으면 Excel이 열면서 실제 완료일을 계획 종료일로 되돌린다(D-2) — 값맵 검사로는
  // 절대 안 잡히는 축이라 별도 스위트로 둔다.
  { name: '완료보고서 8칸 주입 왕복',   cmd: 'npx tsx --conditions=react-server scripts/test-done-sheet-inject.mts' },
  // ⑥ 완료일을 **손으로 치지 않게** 한 뒤(2026-09-10 사용자 결정) 그 파생 규칙을 고정한다.
  // 등재 이유: 이 축의 회귀는 **화면상 아무 문제가 없어 보인다** — 폴백이 오늘로 떨어져도 체크는
  // 잘 되고, 근거 없는 날짜가 별지 11호 「이행조치 일자」에 그럴듯하게 찍힐 뿐이다. 그리고 위 두
  // 스위트는 값이 **들어가기만 하면** 초록이라 이 변경을 한 건도 보지 않는다(직접 변이로 확인했다).
  { name: '이행기간 파생(완료일·일괄)',  cmd: 'npx tsx --conditions=react-server scripts/test-action-period-derive.mts' },
  // ④ 「총 이행기간(수동 보정)」이 **갑지 엑셀까지** 닿는가 + 11호 완료 일자 통일(2026-09-10 사용자 지시).
  // 🚨 등재 이유: 이 축을 단언하는 검사가 **하나도 없었다**. 라우트가 annex_inputs의 report11만
  //   읽고 report10을 안 읽어서, 사용자가 기간을 고치면 PDF 10호만 바뀌고 엑셀은 자동 산출값을
  //   찍었다 — 개요!G9·I9·J9·**G10(이행조치일자)**과 계획서 21칸이 통째로 PDF와 다른 날짜였다.
  //   그런데 `test-report10-plan-rows`는 PDF HTML만 보고 `test-xlsx-anchors`는 칸의 존재만 봐서
  //   두 스위트 모두 초록이었다.
  // ⚠ [G][H]가 **두 라우트/액션 소스의 배선**을 따로 센다 — 값 단언만으로는 "포장은 옳은데 요청이
  //   안 나가는" 형태를 못 본다(직접 변이 3건으로 확인).
  // ⚠ 위 `별지 11호 완료 축`의 「PDF 무손상」 대조군은 **순수층만** 덮는다(내 변경은 조립 오버레이다) —
  //   그 초록을 「PDF가 안 바뀌었다」의 근거로 읽으면 틀린다. 조립층은 여기 [H]가 본다.
  { name: '총 이행기간 → 엑셀·11호 착지', cmd: 'npx tsx --conditions=react-server scripts/test-annex-total-period.mts' },
  // 펌프성능시험 실측치(소방계획서_21 R5-9) — 판정자 3인까지 거쳤는데 **등재만 빠져 있었다**
  // (2026-09-08 발견). 이 값은 엑셀 폐지(R5-6) 뒤 **유일한 기록처**라 조용히 깨지면 대안이 없다.
  // 표가 붙는 설비 목록(고시 8개: 2·3·4·5·6·7·8·13)·자동 판정 대상과 비대상(②'규정치'는
  // 명판 값이라 시스템에 없다 — 없는 근거로 O를 찍지 않는다)·수동 보정 우선·별지 4호 도달까지 본다.
  { name: '펌프성능시험 실측치',        cmd: 'npx tsx --conditions=react-server scripts/test-pump-test.mts' },
  // 설비 구분 fold를 읽는 표면이 셋인데(8쪽·10호 7행·현5) 원천은 `foldDefectGroups` 하나다.
  // 원천이 하나여도 **표면마다 부르는 조건이 다르면** 갈라진다 — 실제로 10호가 미공급을
  // '전 구분 미해당'으로 읽어 7행을 전부 「해당없음」으로 단정한 적이 있다(2026-09-08 정정).
  // 그래서 값이 아니라 **세 표면의 일치**를 묻고, 추출기가 상수를 돌려주는 공허 초록을 막으려
  // '판별자가 5종을 실제로 구별했다'를 함께 단언한다.
  { name: '설비구분 fold 3표면 일치',  cmd: 'npx tsx --conditions=react-server scripts/test-applicable-surfaces.mts' },
  // 자사 정보 4칸(43 D-8 부분 배선) — 이 배선의 전제는 **출력이 한 글자도 안 바뀐다**는 것이다.
  // DB 값이 서식 리터럴과 글자까지 같은 칸만 열었기 때문인데, 그 동일성이 깨지면 계약서·완료보고서의
  // 인쇄값이 조용히 바뀐다. 나머지 14칸(상호·주소·등록번호)이 **무심코 열리는 것**도 함께 막는다 —
  // 지금 열면 계약서에서 `㈜`가 사라지고 등록번호가 더미 `1234567`로 덮인다(실측 M-19).
  { name: '자사 정보 앵커(무변화)',    cmd: 'npx tsx --conditions=react-server scripts/test-company-anchors.mts' },
  // 3쪽 1절 두 축(설치 √ / 점검결과 ○×)의 귀속 — 양방향으로 조용히 틀릴 수 있는 자리다.
  // 번짐을 안 막으면 설치도 안 한 설비에 ○가 찍히고(위조), 과하게 막으면 대장에 체크를
  // 빠뜨렸을 뿐인 실점검이 해당없음 ／로 지워진다. 두 실패 모두 인쇄물만 보면 멀쩡하다.
  { name: '3쪽 설치·결과 축 귀속',      cmd: 'npx tsx scripts/test-form3-axis.mts' },
  // 다중이용업소 두 축(소방계획서_22 S14) — 2026-09-08까지 **둘 다 미등재**였다.
  //   ① 판정 단일화: 다중이용업 '해당 여부'의 원천은 1.10.3 하나뿐인데, 인쇄 지점이 4곳이라
  //      한 곳만 직접 `.applicable`을 읽어도 **한 문서 안에서 2쪽과 3쪽이 서로 다른 소리를 한다**
  //      (2026-08-20 실사고). 소스 가드로 그 재발을 막는다.
  //      ⚠ 등재 시점에 이 프로브는 **빨간 채로 방치돼 있었다**(26/27) — 별지 11호가 도입한
  //      무관한 `ctx.applicable`을 이름만 보고 잡은 오탐이었다. 패턴을 다중이용업 문맥으로
  //      좁히고 판별자 생존 단언(D2·D3)을 함께 넣었다. 등재가 없으면 빨강도 오탐도 아무도 모른다.
  //   ② MU 16칸 ↔ STD-32 44항목 매핑: 입력은 STD-32 하나이고 별지 4호 2쪽·9호 3쪽의 16칸은
  //      거기서 롤업 파생된다. 매핑이 틀어지면 법정 서식 칸이 조용히 빈다.
  { name: '다중이용업 판정 단일화',      cmd: 'npx tsx --conditions=react-server scripts/_probe-mu-applicable.mts' },
  { name: 'MU 16칸↔STD-32 매핑',       cmd: 'npx tsx --conditions=react-server scripts/_probe-mu-std32-map.mts' },
  //   ③ 합격선 실데이터(S14-5 ①) — 위 둘은 순수·소스 축이라 "화면에 시트가 몇 개 뜨나"를 못 본다.
  //      buildSheetOverviews가 DB에서 직접 읽어서 자기 픽스처를 만들고 지운다.
  //      **B 대조군이 핵심**이다 — 레거시 MU 응답이 있으면 MU-01이 살아남아 2개가 된다.
  //      그게 없으면 A의 '1개'는 "MU-01이 늘 사라져서" 나온 값일 수도 있어 공허하다.
  { name: '다중이용 입력 단일화(실데이터)', cmd: 'npx tsx --conditions=react-server scripts/test-mu-single-sheet.mts' },
  // 같은 3쪽의 **폴백** 축(2026-09-08) — 위 스위트가 "값이 있을 때 어디에 귀속되나"를 본다면
  // 이쪽은 "값이 없을 때 무엇을 찍나"를 본다. 기타 3항목·주차 옥내 하위·설치+무응답 ○ 셋 다
  // 한 번씩 조용히 빈칸을 제출한 전력이 있는데, 등재 시점까지 parseParkingSummary·etcMarks를
  // 단언하는 test-* 스위트가 0건이었다. 판정이 "실측 0건이라 인쇄물은 전부 ☐"에서 멈춰 있었던
  // 이유가 그것 — 데이터가 비면 검사도 함께 눈이 먼다. 여기선 응답을 주입해 델타로 가른다.
  { name: '3쪽 폴백 3축(기타·주차·무응답)', cmd: 'npx tsx --conditions=react-server scripts/test-form3-fallbacks.mts' },
  // 1.4 설비별 결과 입력(소방계획서_26) — 배지·패널 배선 + 쓰기 경로(일괄 ○·항목 ✕→불량 자동 등록).
  // 결과의 단일 원천은 점검표 응답인데 입력 자리가 둘이 됐다. 배선이 끊기면 화면은 멀쩡한데
  // 기록이 안 남거나(배지 그대로) 엉뚱한 회차에 쓰인다 — 둘 다 인쇄물을 봐야 알게 된다.
  { name: '1.4 설비별 결과 입력(E2E)',   cmd: 'npx tsx scripts/_probe-form14-result-badge.mts', needServer: true },
  // 1.4 「기타」 축(2026-09-03) — 방화문·비상구·방염·위험물·화기·가스·전기. 이 7종은 소방시설 42종이
  // 아니라 법정 범주가 다르고, 체크가 STD-31·EXT-10~14의 **설치 축**이 된다(체크하면 39 강제가 붙는다).
  // ⚠ 위험은 퍼지 폴백이다 — '방염' 같은 짧은 어휘가 미등재 시트명에 우연히 걸리면 필수 강제가
  //   엉뚱한 시트에 붙는다. 축 프로브가 **적대적 이름으로 델타를 고정**하고(무DB, 싸다),
  //   E2E가 체크→저장→딥링크 왕복을 본다.
  { name: '1.4 기타 축(무DB)',          cmd: 'npx tsx --conditions=react-server scripts/_probe-etc-axis.mts' },
  { name: '1.4 기타 체크·딥링크(E2E)',   cmd: 'npx tsx scripts/_probe-form14-etc.mts', needServer: true },
  // 점검표 입력 전용 페이지(소방계획서_28) — 입력의 정본. ★ 설치인데 응답 0건인 설비가
  // 화면에 ⚠로 드러나는지가 핵심(2026-08-24 물분무 공란 사고의 회귀 방어).
  { name: '점검표 입력 전용 페이지(E2E)', cmd: 'npx tsx scripts/test-sheet-entry-page.mts', needServer: true },
  // 중분류 회색 축(2026-09-03, image-55) — 설치 시트 안의 미설치 형제 중분류는 회색+／ 자동:
  // 분모·필수에서 빠지고, 서버 일괄(○/／)이 거기에 **저장하지 않으며**, 1.4 대장 체크로 되살아난다.
  // 판정 축이 셋(화면 회색·집계 분모·일괄 쓰기)이라 하나만 풀려도 화면과 문서가 갈라진다.
  { name: '점검표 중분류 회색 축(E2E)',   cmd: 'npx tsx scripts/test-sheet-group-gray.mts', needServer: true },
  // 세부제원 조건부 자동 ／(2026-09-07) — 「(폐쇄형 헤드의 경우)」류 항목을 1.4 세부제원으로 판정.
  // 규칙 표는 **코드가 실재해야** 발화한다(오타 하나면 조용히 무발화) → 카탈로그·스키마·선택지 3중 대조.
  // ⚠ 이 프로브 자신이 첫 실행에서 1000행 상한에 잘려 멀쩡한 규칙 6건을 '없는 코드'로 오보했다.
  { name: '세부제원 자동 ／ 규칙(무DB+카탈로그)', cmd: 'npx tsx scripts/_probe-spec-na-unit.mts' },
  // 판정 전용 칸이 **법정 서식에 새지 않는가** — 지금은 인쇄가 손으로 쓴 원문 재현이라 안전하지만,
  // 그 안전성은 주석이 아니라 검사로 지킨다(카탈로그 순회로 리팩터하면 조용히 새어 나간다).
  { name: '판정 전용 칸 인쇄 누출 없음', cmd: 'npx tsx --conditions=react-server scripts/_probe-judge-only-not-printed.mts' },
  // 인쇄 축 — 화면이 ／인데 문서가 빈칸이면 실패다. 대조군→개방형→폐쇄형 3상태 델타 + 응답 우선순위.
  { name: '세부제원 자동 ／ 인쇄', cmd: 'npx tsx --conditions=react-server scripts/_probe-spec-na-print.mts' },
  // 화면·저장 왕복 — 잠긴 칸에 일괄 ○가 저장되지 않고, 이미 응답이 있으면 잠기지 않는다(유령 입력 금지)
  { name: '세부제원 자동 ／ 화면(E2E)', cmd: 'npx tsx scripts/_probe-spec-na-e2e.mts', needServer: true },
  // 미입력 행 강조·카운터 점프(2026-09-07) — 개수만 알려주고 위치는 안 알려주던 자리
  { name: '미입력 강조·점프(E2E)', cmd: 'npx tsx scripts/_probe-blank-jump.mts', needServer: true },
  // 소방시설(1.4) ↔ 점검표 왕래(소방계획서_40) — ★ 고치고 **돌아왔을 때 설치 축이 갱신되는가**가 핵심.
  // 링크 존재는 grep으로도 보이지만, revalidate가 안 뚫리면 사용자는 고쳤는데도 안 고쳐진 화면을 본다.
  // 다건물 union·비담당 직원의 두 권한 축(대장은 되고 결과 배지는 안 됨)도 여기서만 갈린다.
  { name: '설비↔점검표 왕래(E2E)',       cmd: 'npx tsx scripts/test-facility-roundtrip.mts', needServer: true },
  // 설비 대장 패널 뒤로가기(2026-09-11) — 패널 열림이 URL에 없어, 화면을 덮은 채 뒤로가기를 누르면
  // 패널이 아니라 **고객 상세를 통째로 떠나 고객 목록으로 나갔다**(사용자 보고). 이 축은 코드로는
  // 안 보인다 — pushState/popstate/back이 다 제자리에 있어도 셋의 **짝**이 어긋나면 조용히 깨지고,
  // 증상은 '뒤로가기를 눌렀더니 딴 데로 갔다'뿐이라 화면 검사로도 안 잡힌다. 그래서 브라우저
  // 히스토리 실측으로 고정한다. ⚠ 대조군(패널을 안 열면 뒤로가기가 실제로 나간다)이 한 벌이다 —
  // 없으면 '뒤로가기가 원래 아무 일도 안 한다'와 구별되지 않아 통째로 공허해진다.
  { name: '설비 대장 뒤로가기(E2E)',     cmd: 'npx tsx scripts/test-specs-panel-back.mts', needServer: true },
  // 같은 페이지의 **동시 편집 보호** — 두 사람이 같은 점검을 열면 전용 페이지가 조용히 덮어쓰던 것을
  // 드로어와 같은 규약(Realtime + 훅 계약 ③ pause/resume)으로 막았다. 코드 존재로는 증명되지 않는
  // 축이라(이식 전 대조군에서 '차단' 검사가 itemC=O로 붉었다) 브라우저 + DB 실측으로 고정한다
  { name: '점검표 동시 편집 보호(E2E)',   cmd: 'npx tsx scripts/test-sheet-entry-concurrent.mts', needServer: true },
  // 지난 회차 제안 배너(2026-09-07) — 새 회차는 항상 빈 상태로 시작한다(자동 승계는 §6-6 때문에
  // 일부러 안 만들었다). 그래서 [지난 회차 결과 불러오기]를 모르면 605항목을 처음부터 찍는다.
  // ★ '배너가 뜬다'가 아니라 **권한 회차 = 복사가 집는 회차**임을 감사 로그로 대조하는 것이 핵심 —
  // 갈리면 권해놓고 실패하는 버튼이 된다. 복사 결과 안내의 조용한 소멸도 여기서 고정한다.
  { name: '지난 회차 제안 배너(E2E)',     cmd: 'npx tsx scripts/test-prev-round-hint.mts', needServer: true },
  // S9-1 재생성 차단 — 규약 버전 축(149). 날짜 상수(CUTOFF)의 부활, 스탬프 배선 유실,
  // 미상+응답 차단 규칙의 완화를 전부 여기서 잡는다 — 종전 날짜 축은 기입 즉시 전건 차단 사고를 냈다.
  { name: 'S9-1 재생성 규약 축',         cmd: 'npx tsx scripts/test-regen-protocol.mts' },
  // 공휴일은 영업일 → 6단계 마감일을 결정한다. 하나만 틀려도 법정 제출기한이 밀리는데
  // 화면 어디에도 안 드러난다 — 순수 산출을 공공API 확정본과 대조해 상시 고정 (소방계획서_25)
  { name: '공휴일 대체 규칙',          cmd: 'npx tsx scripts/test-holiday-rules.mts' },
  // 위 검사의 **대조군**(2026-09-08) — date-holidays 응답을 얼려 두고 우리 산출만 판정한다.
  // 위 검사는 살아 있는 라이브러리를 쓰므로 빨개져도 원인을 못 가른다. 둘을 나란히 두면
  // '이건 초록 + 위가 빨강' = 라이브러리가 움직인 것이고, '이게 빨강' = 우리 코드가 깨진 것이다.
  // 라이브러리가 음력 계산을 바꾸면 설·추석이 통째로 틀어지는데, 그때 범인을 즉시 지목한다.
  { name: '공휴일 산출 대조군(fixture)', cmd: 'npx tsx --conditions=react-server scripts/test-holiday-fixture.mts' },
  // 공휴일 수정(R-4)이 기대는 DB 동작 — 자동→manual 승격은 되고, 되돌리기는 139 트리거가 막는다.
  // 액션은 requirePermission이라 스크립트가 못 부르므로 같은 순서의 DB 조작으로 가른다.
  // 승격이 안 되면 액션은 "성공"을 반환하고도 다음 동기화가 이름을 되돌린다 — 무증상 실패다.
  { name: '공휴일 수정 승격 축(DB)',    cmd: 'npx tsx --conditions=react-server scripts/test-holiday-edit.mts' },
  // SMS는 돈이 나가고 되돌릴 수 없다. 수신자 선정·중복 접기·응답 판정이 틀려도 화면은 멀쩡해 보이므로
  // (실패를 '발송됨'으로 보이게 한 P-1·P-2가 정확히 그랬다) 순수 함수 단계에서 결정적으로 고정한다
  { name: 'SMS 순수 함수',             cmd: 'npx tsx scripts/test-sms-pure.mts' },
  // 발송 결과 확인 동선(S8-10) — 달력에서 보내고 결과는 문자 발송 화면에서 본다(Q-14·Q-15).
  // 링크가 약속한 화면에 **도착하지 못하는** 실패 셋이 전부 조용하다: 도착 화면 기본 필터가
  // not_sent라 방금 보낸 건이 걸러지고, 기간이 없으면 오늘~+30일 밖은 안 보이며,
  // 같은 경로로 가는 <Link>는 서버를 안 깨워 필터가 통째로 무시된다(문자 발송 화면에서 누를 때).
  // 실발송 없이 볼 수 있는 축이 배선뿐이라 정적으로 고정한다.
  { name: 'SMS 결과 링크 배선(S8-10)',  cmd: 'npx tsx scripts/test-sms-result-link.mts' },
  // 단계 [입력] 링크 — 서버 불필요(순수 함수 + 소스 배선). 6단계는 증거가 등록되면 자동 완료되는데
  // 그 자리로 가는 링크가 없어 사용자가 [사유 완료](증거 없는 예외)밖에 못 누르던 것을 이은 기능.
  // 링크가 조용히 끊기면 다시 그 상태로 돌아가므로 목적지·배선을 함께 고정한다
  { name: '단계 입력 링크(순수·배선)',  cmd: 'npx tsx scripts/test-step-input-link.mts' },
  // 고객 완전 삭제의 동시성(소방계획서_32 T4) — 156은 무조건 삭제라 '함께 지워짐'이 의도된
  // 동작이 됐다. 금지되는 결과는 **고아**(고객은 없는데 자식 행이 남는 것) 하나뿐이다.
  // 변이 검사로 확인한 것(파일 머리 참조): 고아를 막는 건 우리 잠금이 아니라 FK 잠금이고,
  // advisory·FOR UPDATE는 **직렬화**를 지킨다(둘이 중복 — 하나만 남아도 동작한다).
  // 둘 다 사라지면 두 호출이 모두 ok=true를 반환해 감사 로그에 같은 삭제가 두 번 남는다.
  { name: '고객 완전삭제 동시성',       cmd: 'npx tsx scripts/test-hard-delete-race.mts' },
  // 같은 삭제의 **스토리지 축**(S8-3) — 버킷을 새로 만들고 삭제 경로에 안 넣으면 아무 오류도
  // 안 나고 파일만 남는다. DB 행은 156이 지우므로 어떤 FK로도 못 따라가는 고아가 된다.
  // 실측(2026-09-08)으로 실제 그랬다: 5개 중 inspection-reports가 빠져 있었고 그 버킷의
  // 파일 전부가 고아였다. 버킷 목록과 삭제 액션 소스를 대조해 배선을 고정한다.
  { name: '삭제 스토리지 버킷 커버리지', cmd: 'npx tsx scripts/test-storage-purge-coverage.mts' },
  { name: '게이트 정합성(E2E)',        cmd: 'npx tsx scripts/test-gate-consistency.mts', needServer: true },
  // 모두 합격 회차의 단계 접기·감추기(2026-09-10). 🚨 등재 이유: 형제인 「게이트 정합성」은
  // 「6단계가 그대로 보이는가」만 물어서 **줄어드는 쪽이 한 번도 실행되지 않았다** — 첫 구현이
  // 점검표를 안 채운 새 회차까지 4단계로 줄인 결함도, 분자·분모가 갈라져 「3/4」가 되던 결함도
  // 이 검사가 잡았다. 6 → 4 → 3을 **같은 회차를 굴리며** 차례로 단언한다.
  { name: '모두합격 단계 접기(E2E)',   cmd: 'npx tsx scripts/test-allpass-step-collapse.mts', needServer: true },
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
  // 1.10.3 다중이용업소가 1.10 → 1.4 「기타」 아래로 이사했다(43 S7, 2026-09-09 B안 확정).
  // 등재 이유는 이 이사가 **화면과 저장소를 어긋나게** 두기 때문이다: 카드는 1.4 안에 있는데 값은
  // 고객 단위 sections.multiUse라, 1.4의 [저장](건물별 fire_facilities)과 1.10의 [저장]이 각자
  // 상대의 값을 지울 수 있는 자리가 됐다. 지워져도 화면은 조용하다 — 다시 열어야 빈 칸이 보인다.
  // 그래서 '보이는가'보다 **양방향 무손상**을 묻고, 값이 애초에 없으면 늘 초록인 공허 통과를 막으려
  // 양성 표본이 실재했음을 먼저 단언한다.
  { name: '1.10.3 이사·저장 분리(E2E)', cmd: 'npx tsx scripts/test-s7-multi-use-move.mts',    needServer: true },
  { name: '별지 상호작용(E2E)',         cmd: 'npx tsx scripts/test-annex-interaction.mts',    needServer: true },
  { name: '별지 탭 승격(프로브)',        cmd: 'npx tsx scripts/_probe-annex-tab.mts',          needServer: true },
  { name: '별지 같은경로 이동(프로브)',   cmd: 'npx tsx scripts/_probe-annex-samepath-nav.mts', needServer: true },
  // 별지서식 직행 3동선(달력 데이 패널 · 최근 본 고객 칩 · 고객 상세 헤더) — 30 S4-4.
  // 종전 판정: "9/9는 **커버리지 구멍 위의 초록**이었다 — 목적지를 변조해도 초록이었다."
  // 지금은 세 동선 모두 href와 **클릭 후 활성 탭**을 함께 단언한다(변이 검증: 기대값을 뒤틀면
  // 정확히 3건이 빨개진다 — _mut-s44.mjs). 링크는 조용히 끊긴다: 눌러도 다른 탭이 열리면
  // 사용자는 '기능이 없다'고 읽지 오류로 읽지 않는다.
  { name: '별지 직행 3동선(프로브)',     cmd: 'npx tsx scripts/_probe-plan-access-paths.mts',  needServer: true },
  // S4-4 폴백 — [⑨ 9호로 돌아가기]는 history.length<=1이면 back 대신 goTab을 탄다. 그 분기는
  // 실사용의 ctrl-click 새 탭에서만 열리는데, 오래 '재현 불가'로 미검증이었다(2026-08-30 오판 정정:
  // window.open으로 연 팝업은 초기 about:blank가 **교체**돼 length===1이다). 여기가 끊기면 새 탭으로
  // 들어온 사용자만 버튼이 죽는다 — 화면엔 아무 일도 안 일어나고 다수 경로는 멀쩡해 영영 모른다.
  { name: '별지 복귀 폴백 분기(프로브)',  cmd: 'npx tsx scripts/_probe-annex-back-fallback.mts', needServer: true },
  // 드로어(B) — 사용자 결정으로 현장용 입력구를 유지한다(소방계획서_28 D-5). 유지하는 이상 회귀도 막아야
  // 하는데 이 두 스위트가 **미등록이라 썩어 있었다**: mu-sheet는 `9b43cc0`에서 사라진 [저장] 버튼을
  // 눌러 15초 타임아웃으로 죽었고(3/1), mother-drawer(67단언)는 아무도 안 돌렸다.
  // 등재하지 않으면 A만 초록인 채 B가 조용히 썩는다 — 그게 애초에 A에 보호가 빠졌던 경위다.
  { name: 'MU 시트 드로어(E2E)',        cmd: 'npx tsx scripts/test-mu-sheet.mts',            needServer: true },
  { name: '머더 카드·드로어(E2E)',      cmd: 'npx tsx scripts/test-sheet-mother-drawer.mts', needServer: true },
  // 드로어 전체화면·배율 연동(소방계획서_38). 위 두 스위트는 **배율 md 한 점에서만** 돌기 때문에
  // lg/xl에서 sticky 2층이 겹쳐 항목 첫 행이 가려져도 전부 초록이다. test-font-scale S-1은 CSS
  // 텍스트에서 '같은 변수를 읽는가'만 보는 정적 검사라 렌더 결과를 모른다 — 이 프로브만 실측한다.
  { name: '드로어 배율 기하(프로브)',    cmd: 'node scripts/_probe-38-drawer-scale.mjs',      needServer: true },
  // 다크·모바일은 종전에 '육안으로 본다'고 미뤄 두던 축이다 — 그래서 아무도 안 봤다.
  // 다크에서 sticky 배경이 반투명해지면 스크롤 중 아래 항목 글자가 헤더를 뚫고 비치는데
  // 라이트에서는 눈에 안 띈다. 모바일 바텀시트는 Tailwind v4의 단축 vs longhand 우선순위에
  // 기대는 구조라, 클래스 순서를 잘못 쓰면 조용히 데스크톱 모양으로 고착된다.
  { name: '드로어 다크·모바일(프로브)',  cmd: 'node scripts/_probe-38-dark-mobile.mjs',       needServer: true },
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
  // 고객 비활성 ↔ 재활성 왕복(FIRE-S4 · 30 S6) — 미완료 계획을 자동취소하되 **마커로 원상태를
  // 기억**했다가 되살린다. 되돌리기가 조용히 깨지면 재활성한 고객의 계획이 취소된 채 남고,
  // 그건 달력·목록 어디에도 오류로 안 뜬다(취소는 정상 상태처럼 보인다).
  // completed 불변 · 기존 수동취소에 마커 미부착 · 2회차 마커 중복 없음까지 함께 고정한다.
  // ⚠ 2026-09-08까지 **4/8로 영구 빨강 + 미등재**였다. 원인은 제품이 아니라 검사 부패 2종:
  //   ②정기는 생성 즉시 자동 확정이라 planned가 0건인데 셋업이 '나머지는 planned'에 기대고 있었고,
  //   ③getItems()에 안정 정렬이 없어 재조회 때 items[0..2]가 다른 행을 가리켰다(일괄 생성이라
  //   created_at이 동률). 기대를 생성기의 부산물이 아니라 **셋업이 직접 만들도록** 바꿔 12/0.
  { name: '고객 비활성 왕복(FIRE-S4)',   cmd: 'npx tsx scripts/test-fire-s4.mts',             needServer: true },
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
