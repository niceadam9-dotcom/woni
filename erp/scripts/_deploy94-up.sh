#!/usr/bin/env bash
# 94회차 운영 배포 — e99941f → origin/main(37820ac, 4커밋 · 마이그 0)
#   352500c chore(배포): 93회차 up 스크립트를 기록으로 싣는다              ← 문서 전용(내 것)
#   6d63efd feat(점검): 회차 귀속 1.4의 「기타」 7종을 그 회차만 보인다    ← **타 세션**
#   55f3361 chore(소방계획서): 「기본 문구」 8섹션 등록 스크립트 기록      ← 문서 전용(내 것)
#   37820ac fix(소방계획서): 공통문구 목록 미리보기 대표 칸               ← 내 것(제품)
#
# 착수 실측(_deploy94-baseline.sh · 2026-09-21):
#   서버 HEAD=e99941f · img=e7f7ff7e5aef · dirty=0 · inflight=0 · 마이그 0건
#   내 커밋 37820ac7: 원격에 YES · 서버에 NO-미배포
#
# 🚨 **내 커밋에는 번들 문자열 마커가 원리적으로 없다.** 새 문자열을 하나도 만들지 않고
#   값을 집는 **순서**만 바꿨다(그리고 minify는 식별자를 지운다). 그래서 지어내지 않는다.
#   내 축의 판정은 세 가지로 한다:
#     ① 서버 HEAD가 37820ac7을 조상으로 포함  ② 이미지 교체(e7f7ff7e5aef → 다른 값)
#     ③ **동작 프로브** — 운영 DB의 plan_text_library에 「서버가 체크아웃한 소스의 함수」와
#        「수리본 함수」를 각각 걸어 비교한다. 배포 전 실측 **14건 중 2건 불일치**:
#          brigadeTeams 「기본 문구」   : 지휘통제가 아니라 **응급구조**가 떴다
#          constructionLog 「기본 문구」: 공사·정비 내용이 아니라 **비고**가 떴다
#        배포 후 같은 프로브가 **0건**이어야 한다(= 운영이 수리본을 돌고 있다).
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다):
#   신규  이 회차에 해당하는 기타 시설   0 → N   (타 세션 6d63efd — **구간 도달**의 증거)
#   확대  피난·방화시설·방염과 위험물    4 → ≥4  (⚠ **0이 아니다** — 이미 쓰는 곳이 있다.
#                                                 0을 기대했으면 잘못된 빨강이 됐다)
#   존속  공사·정비 내용               12 = 12  (내가 고친 모듈이 번들에 실려 있다는 증거.
#                                                 라벨은 안 건드렸으므로 **변하면 오히려 이상**)
#   존속  피난 방법 (유형 공통)          5 = 5
#   존속  calendar-step-input           2 = 2   (93회차 축)
#   존속  data-detail-panel             2 = 2   (87회차 축)
#   존속  sheet-entry-back              2 = 2
#   존속  설비 확인 → 점검표             4 = 4
#   자산  templates xlsx sha  5dc767d1a9101aa9 = 그대로 (이 구간엔 템플릿 변경이 없다)
#   음성  zzzNoSuchMarker94             0 = 0
#
# ── 판정 결과 (2026-09-21 · `_deploy94-verify.sh`) ───────────────────────────────
#   UP_RC=0 · HEAD e99941f → 37820ac · 이미지 e7f7ff7e5aef → **2a3f6ae58941**
#   복귀점 erp-app:rollback-37820ac 확보 · health=running · 기동 후 오류 0
#   마커 전건 통과: 신규 0→4 · 확대 4→4 · 존속 5축 전부 유지 · 음성 0 · 템플릿 sha 불변
#   조상 관계: 37820ac7 ✔ · 6d63efdc(타 세션) ✔ 함께 나갔다
#   ③ 동작 축(운영 DB 실측): **어긋남 2건 → 0건** — 운영 7건 전부 대표 칸을 띄운다
#      (before: brigadeTeams=응급구조 · constructionLog=비고)
#   https://sjfire.co.kr/login 200 · asset 200 · / 307(로그인 유도, 정상)
#
# 🚨 verify 첫 실행이 **거짓 빨강 1건**을 냈다 — `grep -c`는 0건일 때 exit 1이라
#   `|| echo 0`이 grep이 이미 찍은 "0" 뒤에 "0"을 더 붙여 V="0\n0"이 됐다. 값은 옳았다.
#   **빨강이면 계측기부터 의심한다**. verify 스크립트에 그 교훈을 주석으로 박아 두었다.
set -u

EXPECT_HEAD=e99941f
EXPECT_IMG=e7f7ff7e5aef
ROLLBACK_TAG=erp-app:rollback-e99941f

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD) · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]     || { echo GUARD_FAIL_INFLIGHT; exit 24; }

echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" \
  || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse --short origin/main)
echo "target = $TARGET"
# 내 커밋이 그 안에 정말 있는지 — 배포하고도 안 나가는 일을 막는다(회차마다 물린 적이 있다)
git -C /home/ubuntu/woni merge-base --is-ancestor 37820ac7 origin/main || { echo MINE_NOT_IN_TARGET; exit 32; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }

echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 다음 회차 복귀점 ==="
docker tag erp-app:latest "erp-app:rollback-$NEW" && echo "tagged erp-app:rollback-$NEW"

echo "=== UP DONE — 마커는 별도 verify로 잰다 ==="
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
