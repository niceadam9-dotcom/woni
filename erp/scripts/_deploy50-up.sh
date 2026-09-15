#!/usr/bin/env bash
# 50회차 운영 배포 — 1b6c73e -> 8a889b5 (6커밋: 내 것 2 + 타 세션 4)
#   8a889b5 fix(서식 2.1): 「□ 주간」·「□ 비상연락팀」 두 줄 + 임무 정렬 갈림   ← 내 것
#   70a00c8 fix(소방계획서 엑셀): 좁은 칸 글자 잘림 — 행 높이 자동 확장          ← 내 것
#   eca0b04 · 90e1183 · 9a647eb · 7992f37                                      ← 타 세션(이미 푸시됨)
#
# 회차는 rollback 태그 시각순 실측에서 셌다(47=230e952, 48=5e4f9cc, 49=1b6c73e[태그 누락]).
# 🚨 49회차가 복귀점 태그를 안 남겼다 — 그래서 이 스크립트가 **먼저 만든다**. 복귀점 없이
#    바꾸면 되돌릴 곳이 없다.
# 기대치를 상수로 박는다. 하나라도 어긋나면 아무것도 하지 않고 스스로 선다.
set -u

EXPECT_HEAD=1b6c73eea6d376cb30cb93c7c63c1d4d876ae094
EXPECT_IMG=72e59f232c13
TARGET=8a889b5f953ef01a520c466468c6ad625ae8c08d
ROLLBACK_TAG=erp-app:rollback-1b6c73e
NEXT_ROLLBACK=erp-app:rollback-8a889b5

# 🎯 이 배포의 **주 마커**는 문자열이 아니라 컨테이너 안 자산의 해시다. 템플릿은 바이너리라
#    minify도 번들도 타지 않으므로 「그 파일이 바뀌었나」를 정확히 답한다.
OLD_XLSX_SHA=7eee90c2d889c038a5d
NEW_XLSX_SHA=7b65d1e8c21e7bda

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

echo "=== 복귀점 만들기(49회차가 안 남겼다) ==="
sudo docker tag "$EXPECT_IMG" "$ROLLBACK_TAG" || { echo TAG_FAIL; exit 28; }
T=$(sudo docker images --no-trunc --format '{{.ID}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
echo "ROLLBACK=$T"
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 29; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

echo "=== MARKER BEFORE (구 이미지 실물에서 잰다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  before 템플릿sha=$(sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16)"
  echo "  before 신규(proseColumnCells)=$(grep -rlF proseColumnCells /app/.next 2>/dev/null | wc -l)"
  echo "  before 존속(data-standin · 49회차 남의 축)=$(grep -rlF data-standin /app/.next 2>/dev/null | wc -l)"
  echo "  before 양성(data-testid)=$(grep -rlF data-testid /app/.next 2>/dev/null | wc -l)"
  echo "  before 음성(zzzNoSuchMarker50)=$(grep -rlF zzzNoSuchMarker50 /app/.next 2>/dev/null | wc -l)"
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

echo "=== MARKER AFTER ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  after  템플릿sha=$(sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16)"
  echo "  after  신규(proseColumnCells)=$(grep -rlF proseColumnCells /app/.next 2>/dev/null | wc -l)"
  echo "  after  존속(data-standin · 49회차 남의 축)=$(grep -rlF data-standin /app/.next 2>/dev/null | wc -l)"
  echo "  after  양성(data-testid)=$(grep -rlF data-testid /app/.next 2>/dev/null | wc -l)"
  echo "  after  음성(zzzNoSuchMarker50)=$(grep -rlF zzzNoSuchMarker50 /app/.next 2>/dev/null | wc -l)"
'

echo "=== 다음 복귀점 ==="
sudo docker tag "$L2" "$NEXT_ROLLBACK" && echo "TAGGED $NEXT_ROLLBACK = $L2"
echo "=== UP_DONE ==="
