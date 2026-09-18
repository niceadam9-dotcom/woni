#!/usr/bin/env bash
# 63회차 운영 배포 — 08cdc18 -> 2ff1c6cf (37커밋 = 소방계획서 50시트 시리즈 전체)
#   범위: ae89b91(대장 단일 원천)..2ff1c6cf(2.6·2.8 설비 상자) — 전부 이 프로젝트 커밋,
#   범위 안 마이그레이션 0건(착수 판정 실측) · xlsx 자산 변경 0건(코드 마커로 판정).
#
# 마커 3분법:
#   신규   evac210_false_alarm · ext29_method_ground · contact26_autodial  0 → ≥1
#   존속   complete-all-defects · stair_special_count                       유지
#   음성   zzzNoSuchMarker63                                               0 = 0
# ⚠ 역방향 마커 없음 — 이 시리즈는 순수 추가다(61회차 규약: 지어내지 않는다).
set -u

EXPECT_HEAD=08cdc18842293a7601d587ef97750e170dbf9841
EXPECT_IMG=ca1023745814
TARGET=2ff1c6cf
ROLLBACK_TAG=erp-app:rollback-08cdc18
NEXT_ROLLBACK=erp-app:rollback-2ff1c6cf

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

echo "=== MARKER BEFORE (구 이미지 실물 — 신규 0·존속 ≥1·음성 0 이어야 한다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 신규(evac210_false_alarm)=\$(grep -rlF 'evac210_false_alarm' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 신규(ext29_method_ground)=\$(grep -rlF 'ext29_method_ground' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 신규(contact26_autodial)=\$(grep -rlF 'contact26_autodial' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(complete-all-defects)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(stair_special_count)=\$(grep -rlF 'stair_special_count' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker63)=\$(grep -rlF 'zzzNoSuchMarker63' /app/.next 2>/dev/null | wc -l)\"
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
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치 — 옛 이미지가 떠 있다)')"
sudo docker exec erp-app-1 sh -c "
  echo \"  after 신규(evac210_false_alarm)=\$(grep -rlF 'evac210_false_alarm' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 신규(ext29_method_ground)=\$(grep -rlF 'ext29_method_ground' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 신규(contact26_autodial)=\$(grep -rlF 'contact26_autodial' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(complete-all-defects)=\$(grep -rlF 'complete-all-defects' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(stair_special_count)=\$(grep -rlF 'stair_special_count' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker63)=\$(grep -rlF 'zzzNoSuchMarker63' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치 ==="
echo "  신규 3종 0→≥1 · 존속 2종 유지 · 음성 0 · login=200 이어야 한다"
