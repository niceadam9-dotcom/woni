#!/usr/bin/env bash
# 72회차 운영 배포 — 342dbf4e -> b285701d (3커밋: 문서 2 + 수리 1)
#   fix(등록): 과거 점검일자가 다음 영업일로 밀리고(09-18→09-21) 점검이 영영 시작되지 않았다
#   — 입력값 그대로 1차 즉시 시작(applyPastAnchorInspection) + 미리보기 고지. 마이그 0.
#
# 마커 3분법 (로컬 .next 실측: 4·3·4 / 음성 0 — 배포 전 확인 완료):
#   신규   past-anchor-start-notice(클라)=0→N · '과거 점검일자 즉시 시작 실패'(서버)=0→N
#          '적용할 자체점검 회차가 없습니다'(서버)=0→N
#   역방향 **원리적으로 없다**(순수 추가 — 지어내지 않는다)
#   존속   mgr171_=3 · evacmap15_zone=3 유지
#   음성   zzzNoSuchMarker72 = 0
set -u

EXPECT_HEAD=342dbf4e92a7893a9978e4892eabc50818e7de00
EXPECT_IMG=64764796c698
TARGET=b285701d
ROLLBACK_TAG=erp-app:rollback-342dbf4e
NEXT_ROLLBACK=erp-app:rollback-b285701d

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
  echo \"  before 신규(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 신규(과거 점검일자 즉시 시작 실패)=\$(grep -rlF '과거 점검일자 즉시 시작 실패' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 신규(적용할 자체점검 회차가 없습니다)=\$(grep -rlF '적용할 자체점검 회차가 없습니다' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  before 음성(zzzNoSuchMarker72)=\$(grep -rlF 'zzzNoSuchMarker72' /app/.next 2>/dev/null | wc -l)\"
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
  echo \"  after 신규(past-anchor-start-notice)=\$(grep -rlF 'past-anchor-start-notice' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 신규(과거 점검일자 즉시 시작 실패)=\$(grep -rlF '과거 점검일자 즉시 시작 실패' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 신규(적용할 자체점검 회차가 없습니다)=\$(grep -rlF '적용할 자체점검 회차가 없습니다' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(mgr171_)=\$(grep -rlF 'mgr171_' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 존속(evacmap15_zone)=\$(grep -rlF 'evacmap15_zone' /app/.next 2>/dev/null | wc -l)\"
  echo \"  after 음성(zzzNoSuchMarker72)=\$(grep -rlF 'zzzNoSuchMarker72' /app/.next 2>/dev/null | wc -l)\"
"
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "  기대: HEAD=b285701d · 신규 3종 0→양수 · 존속 3·3 유지 · 음성 0 · login=200"
