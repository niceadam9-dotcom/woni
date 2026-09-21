#!/usr/bin/env bash
# 89회차 운영 배포 — 실행 중 이미지 96fba48c28ae → origin/main(beead875)
#   beead875 fix(고객관리): 헤더 화살표와 패널 [×]를 한 치수로 — 40px·굵기3   (내 것)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 88→e65df4ac(96fba48c28ae), 이번이 89.
#
# ⚠ HEAD를 문자열로 박지 않는다 — 착수 실측에서 HEAD 줄이 출력 잘림으로 유실됐다.
#   대신 **「지금 HEAD가 origin/main의 조상인가」**(= FF가 가능한가)로 묻는다. 더 정확하고,
#   내가 sha를 옮겨 적다 틀릴 여지가 없다(full sha 오기로 FF 가드가 선 전례가 있다).
#
# 마커 3분법 (배포 전 실행 중 컨테이너에서 실측한 before를 박아 둔다):
#   신규  justify-center size-12 rounded-lg border-2        0 → N  (페이저 새 상자)
#   신규  font-semibold text-ink-sub w-14 text-center       0 → N  (순번 새 글꼴)
#   역방향 justify-center size-7 rounded-lg border text-…    2 → 0  (페이저 옛 상자)
#   역방향 text-form-2xs text-ink-sub w-12 text-center       2 → 0  (순번 옛 글꼴)
#   존속  size-10                                          11 = 11 (88회차 내 축)
#   존속  specs-close                                       4 = 4
#   음성  zzzNoSuchMarker89                                 0 = 0
# ⚠ 이번 변경엔 **새 한글 문자열이 없다**(크기·굵기만 바뀐다). 그래서 마커가 className이다 —
#   Tailwind 클래스는 번들에 문자열로 남으므로 잰다. 한글이 없다고 마커를 포기하지 않는다.
set -u

EXPECT_IMG=96fba48c28ae

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
H=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
TARGET=$(git -C /home/ubuntu/woni rev-parse --short origin/main)
echo "HEAD=$H → TARGET=$TARGET · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
[ "$D" = "0" ]           || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]    || { echo GUARD_FAIL_INFLIGHT; exit 24; }
git -C /home/ubuntu/woni merge-base --is-ancestor HEAD origin/main || { echo GUARD_FAIL_NOT_FF; exit 25; }
# 내 커밋이 목표 안에 정말 있는가 — 배포하고도 안 나가는 일을 막는다
git -C /home/ubuntu/woni merge-base --is-ancestor beead875 origin/main || { echo MINE_NOT_IN_TARGET; exit 26; }

echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "erp-app:rollback-$H" \
  && echo "이미 있음: erp-app:rollback-$H" \
  || { docker tag erp-app:latest "erp-app:rollback-$H" && echo "tagged erp-app:rollback-$H"; }

echo "=== FF ==="
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "HEAD_NOW=$NEW"

echo "=== BUILD & UP ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -20
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

docker tag erp-app:latest "erp-app:rollback-$NEW" && echo "tagged erp-app:rollback-$NEW"
echo "=== UP DONE ==="
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
