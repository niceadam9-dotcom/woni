#!/usr/bin/env bash
# 61회차 운영 배포 — b971dbc -> ea02271 (6커밋)
#   c17f47a chore(배포): 60회차 up 스크립트를 기록으로 싣는다            (문서만)
#   98f027c feat(서식 1.1): 전기차충전소 체크칸을 배선한다
#   8617cfc feat(시설현황): 승강기·주차장·계단을 서식 1.1 격자 한 덩어리로
#   1f50a7e test(시설현황): 실화면 왕복·인쇄 대조로 관문을 닫는다
#   23fa189 fix(시설현황): 별지 9호 전용 구분을 기본 펼침으로
#   ea02271 fix(서식 1.1): 전기차충전소 칸을 AR13으로 — 워크북 열 기하가 옮겨졌다
#
# ✅ 마이그 165는 **운영에 이미 적용돼 있다**(2026-09-16 실측: buildings.stair_direct_count=6 실값).
#    코드가 그 컬럼을 select하므로 미적용이면 별지 9호·소방계획서가 통째로 죽는다 — 먼저 확인했다.
# ✅ 워크북 자산(xlsx)·매니페스트는 이 범위에서 **안 바뀐다** — sha256이 그대로여야 한다.
#    바뀌면 딴 게 섞인 것이다(자산은 24e061f에서 이미 재생성돼 60회차로 나갔다).
#
# 마커 3분법 (전부 **화면에 보이는 한글 문자열** — minify가 식별자는 지워도 리터럴은 남긴다):
#   신규  "별지 9호엔 칸이 없다"   0 → ≥1   (전기차충전소 안내 = 이번 범위의 얼굴)
#   신규  "직통 + 피난"            0 → ≥1   (계단 합계 축 = 마이그 165가 세운 것)
#   역방향 "색칠된 칩"             ≥1 → 0    (옛 주차장 칩 안내가 남아 있지 않은가)
#   존속  xlsx sha256 9c89bdb0…   = 그대로
#   존속  data-a9-blank ≥1 · complete-all-defects ≥1  (남의 축이 살아 있는가)
#   음성  zzzNoSuchMarker61       0 = 0     (계측기가 아무거나 세고 있지 않은가)
set -u

EXPECT_HEAD=b971dbc4c3b9f3a7b4dcdb5ff9d4c9ba0ba233a6
EXPECT_IMG=1ed887f1c660
TARGET=ea02271985877c4146a10f16a9145654c0e92f85
ROLLBACK_TAG=erp-app:rollback-b971dbc
NEXT_ROLLBACK=erp-app:rollback-ea02271
KEEP_XLSX=9c89bdb0783193fb

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
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_RUNNING; exit 24; }
[ "$L" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_LATEST; exit 25; }
[ "$T" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_ROLLBACK; exit 26; }
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

MARK='
  f=$(find /app -name fire-plan-workbook.xlsx 2>/dev/null | head -1)
  echo "    xlsx sha256(존속)=$(sha256sum "$f" 2>/dev/null | cut -c1-16)"
  echo "    신규(별지 9호엔 칸이 없다)=$(grep -rlF "별지 9호엔 칸이 없다" /app/.next 2>/dev/null | wc -l)"
  echo "    신규(직통 + 피난)=$(grep -rlF "직통 + 피난" /app/.next 2>/dev/null | wc -l)"
  echo "    역방향(색칠된 칩)=$(grep -rlF "색칠된 칩" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "    음성(zzzNoSuchMarker61)=$(grep -rlF "zzzNoSuchMarker61" /app/.next 2>/dev/null | wc -l)"
'
echo "=== MARKER BEFORE (구 이미지 실물) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c "$MARK"

echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
echo "HEAD_NOW=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"

echo "=== BUILD & UP ==="
sudo docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -12
UP_RC=${PIPESTATUS[0]}
echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sudo docker tag erp-app:latest "$NEXT_ROLLBACK" && echo "tagged $NEXT_ROLLBACK"

echo "=== MARKER AFTER ==="
R2=$(sudo docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19)
L2=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "RUNNING=$R2  LATEST=$L2  $([ "$R2" = "$L2" ] && echo '(일치)' || echo '(불일치)')"
sudo docker exec erp-app-1 sh -c "$MARK"
echo "  HTTP login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치: 신규 0→≥1 둘 · 역방향 ≥1→0 · xlsx $KEEP_XLSX 그대로 · 존속 유지 · 음성 0 ==="
