#!/usr/bin/env bash
# 54회차 운영 배포 — e3245e8 -> 5d7cde0 (2커밋 = 내 것뿐)
#   91afa3b fix(작업대): dev 오버레이 「1 Issue」 — 슬롯 요소 key 누락
#   5d7cde0 chore(배포): 50·52회차 up 스크립트 기록
#
# 🚨 회차는 **이미지 교체 수**로 셌다. 53회차(→e3245e8)가 또 복귀점 태그를 안 남겼다
#    (49·51에 이어 세 번째) — 그래서 이 스크립트가 먼저 만든다.
#
# 🚨🚨 **이 배포에는 문자열 마커가 성립하지 않는다.** 변경은 `key` prop뿐인데
#    ① `key`는 props가 아니라 `jsx(C, props, key)`의 **세 번째 인자**라 `key:"…"` 문자열이 안 남고
#    ② 내가 쓴 이름(multiday·sheet·pumpTest·exterior·participants·defects)은 **이미 같은 객체의
#       키로 번들에 있다**(실측: participants 19파일·multiday 3·pumpTest 2·exterior 119).
#    없는 마커를 지어내는 대신 **다른 축으로 증명**한다:
#      · 구간 물증  — chore 커밋이 추가한 `_deploy52-up.sh`가 서버 git 작업트리에 **생긴다**(0→1)
#      · 이미지 축  — 삼측(RUNNING==LATEST · 구 이미지 아님 · 재시작 시각 변경)
#      · 양성 대조  — grep이 살아 있음을 보이는 존속 마커(legalActionRange·complete-all-defects)
#      · 음성       — 없는 문자열은 0
#
# 🚨 그리고 **이 수정은 운영에 사용자 가시 효과가 없다.** React key 경고는 dev 전용이고,
#    이 목록은 순서가 고정이라 key가 없어도 재조정 결과가 같다. 이 배포의 목적은
#    「운영 == main」을 유지하는 것이지 화면을 바꾸는 것이 아니다 — 그렇게 보고할 것.
set -u

EXPECT_HEAD=e3245e851f236ff88d1c873f477d5a2dffe03773
EXPECT_IMG=cc95a5234569
TARGET=5d7cde082963c051a4f5fed1c1cb506d0510bf49
ROLLBACK_TAG=erp-app:rollback-e3245e8
NEXT_ROLLBACK=erp-app:rollback-5d7cde0

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

echo "=== 복귀점 만들기(53회차가 안 남겼다) ==="
sudo docker tag "$EXPECT_IMG" "$ROLLBACK_TAG" || { echo TAG_FAIL; exit 28; }
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "ROLLBACK=$T"
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 29; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE ==="
echo "  before 구간물증(_deploy52-up.sh 존재)=$(test -f /home/ubuntu/woni/erp/scripts/_deploy52-up.sh && echo 1 || echo 0)"
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  before 양성(legalActionRange)=$(grep -rlF legalActionRange /app/.next 2>/dev/null | wc -l)"
  echo "  before 양성(complete-all-defects)=$(grep -rlF complete-all-defects /app/.next 2>/dev/null | wc -l)"
  echo "  before 음성(zzzNoSuchMarker54)=$(grep -rlF zzzNoSuchMarker54 /app/.next 2>/dev/null | wc -l)"
'

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD)
echo "NEW_HEAD=$NEW"
[ "$NEW" = "$TARGET" ] || { echo GUARD_FAIL_TARGET; exit 32; }
echo "  after  구간물증(_deploy52-up.sh 존재)=$(test -f /home/ubuntu/woni/erp/scripts/_deploy52-up.sh && echo 1 || echo 0)"
test -f /home/ubuntu/woni/erp/scripts/_deploy52-up.sh || { echo GUARD_FAIL_RANGE_PROOF; exit 33; }

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

echo "=== MARKER AFTER ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  after  양성(legalActionRange)=$(grep -rlF legalActionRange /app/.next 2>/dev/null | wc -l)"
  echo "  after  양성(complete-all-defects)=$(grep -rlF complete-all-defects /app/.next 2>/dev/null | wc -l)"
  echo "  after  음성(zzzNoSuchMarker54)=$(grep -rlF zzzNoSuchMarker54 /app/.next 2>/dev/null | wc -l)"
'

echo "=== 다음 복귀점 ==="
sudo docker tag "$L2" "$NEXT_ROLLBACK" && echo "TAGGED $NEXT_ROLLBACK = $L2"
echo "=== UP_DONE ==="
