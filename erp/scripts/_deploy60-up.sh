#!/usr/bin/env bash
# 60회차 운영 배포 — 24e061f -> b971dbc (2커밋)
#   b74cf09 chore(배포): 59회차 up 스크립트를 기록으로 싣는다   (문서만)
#   b971dbc fix(소방계획서 엑셀): 체크박스를 상자 자리에 「정확히」 맞췄더니 화면에서 글자를 덮었다
# ✅ 마이그레이션 0건.
#
# 🚨 **이번 제품 변경은 상수 하나(16 → 13)뿐이라 문자열 마커가 없다.** 자산(xlsx)도 안 바뀐다 —
#    들여쓰기는 템플릿이 아니라 **요청 시점**에 적용되기 때문이다. 그래서 마커를 minify된
#    **식 자체**에서 잡는다: `d=13*r.col+16+l.offsetPx` → `...+13+...`.
#    변수명은 빌드마다 달라질 수 있으므로 **정규식**으로 묶는다(`-F`가 아니라 `-E`).
#
# 마커 3분법:
#   신규  13*<v>.col+13+   0 → 1   (여유 확보 편향이 실제로 실렸는가)
#   역방향 13*<v>.col+16+  1 → 0   (옛 상수가 남아 있지 않은가)
#   존속  xlsx sha256 9c89bdb0…  = 그대로 (자산은 안 바뀌어야 한다 — 바뀌면 딴 게 섞인 것)
#   존속  data-a9-blank 2 = 2 · complete-all-defects 2 = 2
#   음성  zzzNoSuchMarker60  0 = 0
set -u

EXPECT_HEAD=24e061f345db9d8e82334bd1db4064beb7d65888
EXPECT_IMG=1e2ba1592c51
TARGET=b971dbc
ROLLBACK_TAG=erp-app:rollback-24e061f
NEXT_ROLLBACK=erp-app:rollback-b971dbc
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
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "INFLIGHT=$INFLIGHT"
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 27; }
[ "$T" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_ROLLBACK; exit 26; }
echo "GUARD_OK — 복귀점 $ROLLBACK_TAG = $T"

MARK='
  f=$(find /app -name fire-plan-workbook.xlsx 2>/dev/null | head -1)
  echo "    xlsx sha256(존속)=$(sha256sum "$f" 2>/dev/null | cut -c1-16)"
  echo "    신규(…col+13+)=$(grep -rlE "13\*[A-Za-z_$]+\.col\+13\+" /app/.next 2>/dev/null | wc -l)"
  echo "    역방향(…col+16+)=$(grep -rlE "13\*[A-Za-z_$]+\.col\+16\+" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "    존속(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "    음성(zzzNoSuchMarker60)=$(grep -rlF "zzzNoSuchMarker60" /app/.next 2>/dev/null | wc -l)"
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
echo "  HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "=== 기대치: 신규 0→1 · 역방향 1→0 · xlsx sha256 은 $KEEP_XLSX 그대로 · 존속 2·2 · 음성 0 ==="
