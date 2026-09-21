#!/usr/bin/env bash
# 93회차 운영 배포 — f781ccb8 → origin/main(e99941f, 2커밋 · 마이그 0)
#   8102895 feat(점검): 점검표 입력의 [←]가 달력의 그 사이드 패널로 되돌린다   ← 내 것
#   e99941f chore(배포): 92회차 up 스크립트를 기록으로 싣는다                  ← 문서 전용(남의 것)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 착수 실측(2026-09-21):
#   92회차가 **8분 전에 타 세션 손으로 이미 나갔다**(서버 HEAD=f781ccb · rollback-f781ccb8 존재).
#   그래서 이번이 93이고, 구간은 **내 커밋 하나 + 기록 커밋 하나**뿐이다.
# 🚨 마이그레이션 없음(supabase/migrations 변경 0건 — 착수 실측).
# 🚨 템플릿(xlsx)은 **바뀌지 않는다**. 서버·로컬 sha가 이미 5dc767d1a9101aa9로 같다
#   (표지 제목 54pt·사진 400pt·중앙 정렬은 91·92회차로 나갔다).
#   → 이 회차에서 sha가 **변하면 오히려 이상**이다. 그 방향으로 단언한다.
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다):
#   신규  calendar-step-input      0 → N   (달력 단계 [입력] testid — 내 커밋이 붙였다)
#   확대  "insp"                   5 → ≥5  (⚠ **0이 아니다** — 다른 곳이 이미 쓴다.
#                                           0을 기대하면 잘못된 빨강이 된다)
#   존속  설비 확인 → 점검표        4 = 4   (91·92회차로 나간 타 세션 축이 살아 있는가)
#   존속  배치확인서를 올리거나      4 = 4   (6단계 확장 축)
#   존속  data-detail-panel        2 = 2   (87회차 내 축)
#   존속  표지 제목 크기 조정 불발   1 = 1   (87회차 내 축)
#   존속  sheet-entry-back         2 = 2   (점검표 [←] 자체는 원래 있다)
#   자산  templates xlsx sha  5dc767d1a9101aa9 = 그대로
#   음성  zzzNoSuchMarker93        0 = 0
#
# ⚠ **이 회차의 알맹이 둘은 문자열 마커가 없다**(숫자·호출 인자만 바뀐다):
#     · `replaceState(null→window.history.state)` — 브라우저 뒤로가기 복원
#     · 늦게 온 replaceState가 진행 중 이동을 덮지 않게 하는 가드
#   그 축의 정본은 로컬 게이트다: 프로브 12/0 · 변이 5/5 빨강 · 타 세션 왕복 12/0 ·
#   점검표 전용 28/0 · 키보드 28/0 · 표지 44/0 · tsc 0. 마커로 지어내지 않는다.
set -u

EXPECT_HEAD=f781ccb
EXPECT_IMG=0f4b3b908603
ROLLBACK_TAG=erp-app:rollback-f781ccb8

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
git -C /home/ubuntu/woni merge-base --is-ancestor 81028958 origin/main || { echo MINE_NOT_IN_TARGET; exit 32; }
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
