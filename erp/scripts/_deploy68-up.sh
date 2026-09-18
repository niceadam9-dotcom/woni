#!/usr/bin/env bash
# 68회차 운영 배포 — 6c990941 -> e33b0c18 (3커밋)
#   67회차 기록 · 새 사진 축 실서버 프로브 · 1.5.2 구역 2칸+대상명.
#   마이그 0 · xlsx 자산 변경 0(착수 실측).
#
# 마커 3분법 (로컬 .next 자기검증 완료):
#   신규   evacmap15_zone(1.5.2 구역)                 0 → ≥1
#   존속   img_train_1 · promoPhotos(67회차 것)        유지
#   음성   zzzNoSuchMarker68                          0 = 0
set -u

EXPECT_HEAD=6c990941747ef1a4eb36d15546e75b1b5c7ff36e
EXPECT_IMG=fb2fadb0250a
TARGET=e33b0c18
ROLLBACK_TAG=erp-app:rollback-6c990941
NEXT_ROLLBACK=erp-app:rollback-e33b0c18

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

echo "=== MARKER BEFORE (구 이미지 실물) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 신규(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(img_train_1)=\$(grep -rlF 'img_train_1' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(promoPhotos)=\$(grep -rlF 'promoPhotos' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker68)=\$(grep -rlF 'zzzNoSuchMarker68' /app/.next 2>/dev/null | wc -l)\"
"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -10
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }

echo "=== 새 이미지 태그(다음 회차 복귀점) ==="
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
sudo docker exec erp-app-1 sh -c "
  echo \"  after 신규(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(img_train_1)=\$(grep -rlF 'img_train_1' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(promoPhotos)=\$(grep -rlF 'promoPhotos' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker68)=\$(grep -rlF 'zzzNoSuchMarker68' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치 ==="
echo "  신규 0→≥1 · 존속 2종 유지 · 음성 0 · login=200"
