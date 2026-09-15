#!/usr/bin/env bash
# 52회차 운영 배포 — 762c8bf -> 4d19849 (1커밋 = 내 것뿐)
#   4d19849 fix(작업대 ⑤): 보수·증빙을 닫을 수단이 그 칸에 없었다 — 완료 체크·[전건 완료]를 ⑤에도
#
# 🚨 회차는 **이미지 교체 수**로 셌다. 50회차(8a889b5) 뒤로 rollback 태그가 끊겼다 —
#    51회차(→762c8bf)가 복귀점을 안 남겼다. 그래서 이 스크립트가 먼저 만든다(50회차와 같은 상황).
# 🚨 이번 변경은 **새 문자열이 없다**(조건·클래스만 바뀜) — 그래서 주 마커가 **역방향**이다:
#    ⑤ 서술 칸이 w-[64%]에서 w-[32%]로 바뀌며 `w-[64%]`가 저장소에서 사라졌다(소스 0건 실측).
#    Tailwind는 쓰이는 클래스만 내보내므로 번들·CSS에서도 사라져야 한다.
set -u

EXPECT_HEAD=762c8bff634e2b7476cc6a337e493f3d1df1004c
EXPECT_IMG=c21e68a527a6
TARGET=4d19849ce5f9e3a090ab5649466fcf9b1306cd01
ROLLBACK_TAG=erp-app:rollback-762c8bf
NEXT_ROLLBACK=erp-app:rollback-4d19849

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }

echo "=== 복귀점 만들기(51회차가 안 남겼다) ==="
sudo docker tag "$EXPECT_IMG" "$ROLLBACK_TAG" || { echo TAG_FAIL; exit 28; }
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "ROLLBACK=$T"
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 29; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE (구 이미지 실물에서 잰다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  before 역방향(w-[64%] — 사라져야 한다)=$(grep -rlF "w-[64%]" /app/.next 2>/dev/null | wc -l)"
  echo "  before 양성(complete-all-defects — 유지)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "  before 존속(legalActionRange · 51회차 남의 축)=$(grep -rlF "legalActionRange" /app/.next 2>/dev/null | wc -l)"
  echo "  before 음성(zzzNoSuchMarker52)=$(grep -rlF "zzzNoSuchMarker52" /app/.next 2>/dev/null | wc -l)"
'

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD)
echo "NEW_HEAD=$NEW"
[ "$NEW" = "$TARGET" ] || { echo GUARD_FAIL_TARGET; exit 32; }

echo "=== BUILD & UP ==="
BEFORE_START=$(sudo docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)
echo "BEFORE_START=$BEFORE_START"
T0=$(date +%s)
sudo docker compose -f docker-compose.prod.yml up -d --build >up.log 2>&1
UP_RC=$?
echo "UP_RC=$UP_RC  ELAPSED=$(( $(date +%s) - T0 ))s"
tail -6 up.log
[ "$UP_RC" = "0" ] || { echo UP_FAILED; exit 41; }

echo "=== POST (삼측) ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
S2=$(sudo docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)
echo "NEW_RUNNING=$R2"; echo "NEW_LATEST=$L2"; echo "NEW_START=$S2"
[ "$R2" = "$L2" ]            || { echo GUARD_FAIL_POST_MISMATCH; exit 45; }
[ "$R2" != "$EXPECT_IMG" ]   || { echo GUARD_FAIL_NOT_REPLACED; exit 46; }
[ "$S2" != "$BEFORE_START" ] || { echo GUARD_FAIL_NOT_RESTARTED; exit 47; }

echo "=== MARKER AFTER (역방향 n->0 · 양성 유지 · 존속 유지 · 음성 0) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  after  역방향(w-[64%])=$(grep -rlF "w-[64%]" /app/.next 2>/dev/null | wc -l)"
  echo "  after  양성(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "  after  존속(legalActionRange · 51회차 남의 축)=$(grep -rlF "legalActionRange" /app/.next 2>/dev/null | wc -l)"
  echo "  after  음성(zzzNoSuchMarker52)=$(grep -rlF "zzzNoSuchMarker52" /app/.next 2>/dev/null | wc -l)"
'

echo "=== 다음 복귀점 ==="
sudo docker tag "$L2" "$NEXT_ROLLBACK" && echo "TAGGED $NEXT_ROLLBACK = $L2"
echo "=== UP_DONE ==="
