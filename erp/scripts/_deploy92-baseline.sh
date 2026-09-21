#!/usr/bin/env bash
# 92회차 착수 판정 — 배포 전에 서버에게 묻는다.
set -u
W=/home/ubuntu/woni
echo "=== 서버 git ==="
echo "HEAD=$(git -C $W rev-parse HEAD)"
echo "HEAD_SHORT=$(git -C $W rev-parse --short HEAD)"
echo "DIRTY=$(git -C $W status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "=== 컨테이너 ==="
echo "RUNNING=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "LATEST=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)"
echo "INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
echo "=== 회차 실측 ==="
ls $W/erp/scripts/_deploy*-up.sh 2>/dev/null | sed 's#.*/_deploy##; s#-up.sh##' | sort -n | tail -3
echo "=== 내 커밋이 이미 올라가 있나 ==="
git -C $W fetch origin --quiet 2>/dev/null
echo "ORIGIN_MAIN=$(git -C $W rev-parse --short origin/main)"
git -C $W merge-base --is-ancestor f781ccb8 HEAD 2>/dev/null \
  && echo "ANCESTOR=YES (이미 배포본 — 배포하지 말 것)" || echo "ANCESTOR=NO"

echo "=== 마커 적격성 선실측 (before가 0인 축은 판정에서 뺀다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  echo "  주마커(xlsx sha256)=$(sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16)"
  rm -rf /tmp/b && mkdir -p /tmp/b && cd /tmp/b
  unzip -o -q /app/templates/fire-plan-workbook.xlsx xl/worksheets/sheet1.xml 2>/dev/null
  echo "  기능(표지 5행 높이)=$(grep -o "<row r=\"5\"[^>]*ht=\"[0-9.]*\"" /tmp/b/xl/worksheets/sheet1.xml | grep -o "ht=\"[0-9.]*\"" | head -1)"
  echo "  기능(표지 3행 높이)=$(grep -o "<row r=\"3\"[^>]*ht=\"[0-9.]*\"" /tmp/b/xl/worksheets/sheet1.xml | grep -o "ht=\"[0-9.]*\"" | head -1)"
  rm -rf /tmp/b
  n() { echo "  $1=$(grep -rlF "$2" /app/.next 2>/dev/null | grep -v "\.map$" | wc -l)"; }
  n "역방향후보A(*7+5 옛 산식)"   "*7+5"
  n "역방향후보B(w*7+5)"          "w*7+5"
  n "존속(보고서 엑셀)"            "보고서 엑셀"
  n "존속(소방계획서 엑셀)"        "소방계획서 엑셀"
  n "존속(building-saved-note)"   "building-saved-note"
'
echo "DONE_BASELINE"
