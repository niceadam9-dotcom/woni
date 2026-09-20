#!/usr/bin/env bash
# 74회차 운영 배포 — f4ffeae4 -> f294a345 (2커밋: 기록 chore 855464f2 + 수리 f294a345)
#   feat(별지 보고일): 소방서 제출 기록을 문서 날짜의 2순위로 — 수기 > 제출 기록 > 오늘 (f294a345)
#   구간에 실리는 남의 커밋은 73회차 기록 스크립트 1건(855464f2) — 런타임 의존 0·마이그 0.
#
# 마커 3분법 (로컬 워크트리 .next 선실측: 신규 5·5, 역방향 0):
#   신규A  9호 힌트 「④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력」 = 0 → 양수
#   신규B  11호 힌트 「미입력 시 ⑥ 소방서 제출 기록(그것도 없으면 오늘)으로 출력」 = 0 → 양수
#   역방향 옛 힌트 「미입력 시 생성일(오늘)로 출력」 = 양수 → 0
#     (⚠ 'report9_submitted_at, report11_submitted_at' select 리터럴은 마커 부적격 —
#      inspection-step-sync 두 곳이 종전부터 같은 문자열을 갖는다. 신규 축은 힌트 문자열로만 잰다)
#   존속   mgr171_ · evacmap15_zone · past-anchor-start-notice 유지
#   음성   zzzNoSuchMarker74 = 0
set -u

EXPECT_HEAD=f4ffeae411ee239403a239de547906de445d8aa8
EXPECT_IMG=ebe5996a6ac9
TARGET=f294a345
ROLLBACK_TAG=erp-app:rollback-f4ffeae4
NEXT_ROLLBACK=erp-app:rollback-f294a345

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK=$T"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

mark() { # $1=라벨 $2=이미지참조방식(run|exec)
  if [ "$2" = "run" ]; then RUNNER="sudo docker run --rm --entrypoint sh erp-app:latest -c"; else RUNNER="sudo docker exec erp-app-1 sh -c"; fi
  $RUNNER "
    echo \"  $1 신규A(9호 힌트 ④제출기록)=\$(grep -rlF '④ 소방서 제출 기록, 그것도 없으면 생성일(오늘)로 출력' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 신규B(11호 힌트 ⑥제출기록)=\$(grep -rlF '미입력 시 ⑥ 소방서 제출 기록(그것도 없으면 오늘)으로 출력' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 역방향(옛 힌트 오늘단독)=\$(grep -rlF '미입력 시 생성일(오늘)로 출력' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 존속(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | wc -l)\"
    echo \"  $1 음성(zzzNoSuchMarker74)=\$(grep -rlF 'zzzNoSuchMarker74' /app/.next 2>/dev/null | wc -l)\"
  "
}

echo "=== MARKER BEFORE ==="
mark before run

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -8
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
mark after exec

echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=f294a345 · 신규A/B 0→양수 · 역방향 양수→0 · 존속 유지 · 음성 0 · login=200"
echo "DONE74"
