#!/usr/bin/env bash
# 61회차 배포 검증 — 옛 이미지(rollback-b971dbc)와 지금 도는 이미지를 **나란히** 잰다. 읽기 전용.
set -u
MARK='
  f=$(find /app -name fire-plan-workbook.xlsx 2>/dev/null | head -1)
  echo "    xlsx=$(sha256sum "$f" 2>/dev/null | cut -c1-16)"
  echo "    신규A(별지 9호엔 칸이 없다)=$(grep -rlF "별지 9호엔 칸이 없다" /app/.next 2>/dev/null | wc -l)"
  echo "    신규B(직통 + 피난)=$(grep -rlF "직통 + 피난" /app/.next 2>/dev/null | wc -l)"
  echo "    역방향(색칠된 칩)=$(grep -rlF "색칠된 칩" /app/.next 2>/dev/null | wc -l)"
  echo "    존속1(data-a9-blank)=$(grep -rlF "data-a9-blank" /app/.next 2>/dev/null | wc -l)"
  echo "    존속2(complete-all-defects)=$(grep -rlF "complete-all-defects" /app/.next 2>/dev/null | wc -l)"
  echo "    음성(zzzNoSuchMarker61)=$(grep -rlF "zzzNoSuchMarker61" /app/.next 2>/dev/null | wc -l)"
'
echo "=== BEFORE (구 이미지 erp-app:rollback-b971dbc) ==="
sudo docker run --rm --entrypoint sh erp-app:rollback-b971dbc -c "$MARK"
echo "=== AFTER (지금 도는 컨테이너) ==="
sudo docker exec erp-app-1 sh -c "$MARK"
echo "=== 상태 ==="
echo "HEAD=$(git -C /home/ubuntu/woni rev-parse --short HEAD)  DIRTY=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "RUNNING=$(sudo docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19)  LATEST=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)"
sudo docker ps --format '{{.Names}}\t{{.Status}}' | head -4
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
echo "root=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/)"
echo "--- 앱 로그 마지막 줄(에러 유무) ---"
sudo docker logs --tail 8 erp-app-1 2>&1 | tail -8
