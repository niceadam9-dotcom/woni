#!/usr/bin/env bash
# 57회차 운영 배포 — 51470e7 -> 9717e60 (2커밋)
#   5e44308 chore(배포): 54회차 up 스크립트를 기록으로 싣는다        (문서만 · 남의 것)
#   9717e60 feat(건물·시설): 별지 9호 2쪽 네 칸 라벨을 빨갛게 — 단, 「비었을 때만」  (내 것)
#
# 🚨 회차는 **이미지 교체 수**로 센다. 55→a963008, 56→51470e7(현재 실행 중 4f8da1099864),
#    이번이 57. 56회차 세션은 up 스크립트를 아직 안 실었다 — 그래서 `_deploy56-up.sh`가 없는
#    것이지 회차가 빈 게 아니다. **rollback 태그 개수는 회차가 아니다**(옛 태그가 섞여 있고,
#    56회차는 태그를 남기지 않아 `rollback-51470e7`이 없다 → 아래에서 지금 만든다).
#
# 마커 3분법:
#   신규  data-a9-blank   0 → N   (JSX 속성명이라 minify가 못 지운다 — 이 축의 유일한 증거)
#   존속  가스·분말·고체   before = after  (56회차 남의 축이 살아 있는가)
#   존속  complete-all-defects  before = after  (52회차 남의 축)
#   음성  zzzNoSuchMarker57 = 0  (grep 자체가 거짓 양성을 내지 않는가)
# ⚠ 역방향 마커는 두지 않았다 — 갈아낸 것이 `className={labelCls}`라 **minify가 식별자를
#   지우므로** 소스의 사라짐을 `.next`에서 셀 수 없다. 대신 신규 0→N이 전이를 증명한다.
set -u

EXPECT_HEAD=51470e706f60be18ad580d517f173089c1466283
EXPECT_IMG=4f8da1099864
TARGET=9717e60
ROLLBACK_TAG=erp-app:rollback-51470e7
NEXT_ROLLBACK=erp-app:rollback-9717e60

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }

echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "HEAD=$H"; echo "DIRTY=$D"; echo "RUNNING=$R"; echo "LATEST=$L"; echo "ROLLBACK($ROLLBACK_TAG)=$T"
[ "$H" = "$EXPECT_HEAD" ] || { echo GUARD_FAIL_HEAD; exit 21; }
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ -n "$R" ]               || { echo GUARD_FAIL_RUNNING_EMPTY; exit 23; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
# 남이 배포 중이면 얹지 않는다(16회차 사고 방지) — 4GB VPS에서 동시 빌드는 OOM이다
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
# 복귀점이 없으면 **지금 만든다**(56회차가 안 남겼다)
if [ -z "$T" ]; then
  echo "복귀점 없음 — 현재 latest를 $ROLLBACK_TAG 로 태그"
  sudo docker tag erp-app:latest "$ROLLBACK_TAG" || { echo GUARD_FAIL_TAG; exit 28; }
  T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" | cut -c8-19)
fi
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE (구 이미지 실물에서 잰다 — 전이를 증명하려면 before가 있어야 한다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 신규(data-a9-blank)=\$(grep -rlF 'data-a9-blank' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(가스·분말·고체 · 56회차 남의 축)=\$(grep -rlF '가스·분말·고체' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(complete-all-defects · 52회차 남의 축)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker57)=\$(grep -rlF 'zzzNoSuchMarker57' /app/.next 2>/dev/null | wc -l)\"
"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
echo "HEAD_NOW=$NEW"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -20
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 새 이미지 태그(다음 회차 복귀점) ==="
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치 — 새 이미지가 안 돌고 있다)')"
sudo docker exec erp-app-1 sh -c "
  echo \"  after 신규(data-a9-blank)=\$(grep -rlF 'data-a9-blank' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(가스·분말·고체)=\$(grep -rlF '가스·분말·고체' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(complete-all-defects)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker57)=\$(grep -rlF 'zzzNoSuchMarker57' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== 기대치 ==="
echo "  신규: 0 → 1 이상 (0이면 배포 실패 또는 마커 오선정)"
echo "  존속 2건은 before와 같아야 하고, 음성은 0이어야 한다"
