#!/usr/bin/env bash
# 86회차 운영 배포 — acad464c → origin/main(f112ef1, 3커밋)
#   e8b1228 chore(배포): 85회차 up 스크립트를 기록으로 싣는다      (문서만 · 남의 것)
#   a7d26f0 feat(소방계획서): 엑셀 고지를 눌러서 그 칸으로 간다     (내 것 — ② 고지 칩)
#   f112ef1 feat(고객관리): 엑셀 가드가 보낸 사용자가 돌아오면 …    (남의 것)
#
# 🚨 회차는 **이미지 교체 수**로 센다(롤백 태그 개수가 아니다). 85→acad464c(6cccdffa0040), 이번이 86.
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다 — 2026-09-21):
#   신규  xlsx-notice-chip        0 → N   (고지 칩 testid)
#   신규  아래 칸이 비었거나        0 → N   (고지 머리글 — 한글이라 minify가 못 지운다)
#   감소  엑셀 고지:              10 → 9   (plan-tab-view의 옛 한 덩어리 문구가 빠진다.
#                                          ⚠ 0이 되지 않는다 — fire-plan-xlsx-button의 자체 렌더가
#                                            같은 글자를 쓴다. 0을 기대하면 잘못된 빨강이 된다)
#   존속  plan-bar-pdf             2 = 2   (83회차 내 축이 살아 있는가)
#   존속  reports-round-label      1 = 1   (85회차 내 축)
#   존속  fire-plan-xlsx          10 = 10  (남의 축 포함 전체)
#   음성  zzzNoSuchMarker86        0 = 0   (grep이 거짓 양성을 내지 않는가)
set -u

EXPECT_HEAD=acad464
EXPECT_IMG=6cccdffa0040
ROLLBACK_TAG=erp-app:rollback-acad464c

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
# 내 커밋이 그 안에 정말 있는지 — 배포하고도 안 나가는 일을 막는다
git -C /home/ubuntu/woni merge-base --is-ancestor a7d26f05 origin/main || { echo MINE_NOT_IN_TARGET; exit 32; }
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
