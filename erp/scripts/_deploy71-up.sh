#!/usr/bin/env bash
# 71회차 운영 배포 — 3f1857c8 -> 342dbf4e (6커밋)
#   70회차 기록 · 전수 조사 프로브 3종 · 문서 상태 감사 2건 · 설계서 49/50 첫 커밋 · 50 갱신.
#
# ⚠ **구간에 제품 코드가 없다**(erp/src 0파일 · 마이그 0 — 착수 실측). 앱 동작은 70회차와
#   동일하고, 이 배포의 목적은 서버 저장소 동기화 + 새 복귀점이다.
# 마커 3분법: 신규는 **원리적으로 없다**(순수 문서·스크립트 구간 — 지어내지 않는다).
#   존속   mgr171_ · evacmap15_zone   유지
#   음성   zzzNoSuchMarker71          0 = 0
set -u

EXPECT_HEAD=3f1857c871c1704eb684d47173f21d33f106154f
EXPECT_IMG=72d21f911f9c
TARGET=342dbf4e
ROLLBACK_TAG=erp-app:rollback-3f1857c8
NEXT_ROLLBACK=erp-app:rollback-342dbf4e

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

echo "=== MARKER BEFORE ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "
  echo \"  before 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker71)=\$(grep -rlF 'zzzNoSuchMarker71' /app/.next 2>/dev/null | wc -l)\"
"

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
sudo docker exec erp-app-1 sh -c "
  echo \"  after 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker71)=\$(grep -rlF 'zzzNoSuchMarker71' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=342dbf4e · 존속 2종 유지 · 음성 0 · login=200 (신규 마커 없음 — 문서 구간)"
