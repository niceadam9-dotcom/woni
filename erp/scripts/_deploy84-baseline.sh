#!/usr/bin/env bash
# 84회차 착수 판정 — **배포 전에 서버에게 묻는다**(추측으로 시작하면 남의 배포에 올라탄다).
#   · 서버 HEAD가 내가 아는 origin과 같은가
#   · 지금 누가 배포 중인가(INFLIGHT) — 4GB VPS라 동시 빌드는 OOM
#   · 회차 번호 실측(두 세션이 같은 번호를 집은 전례가 있다 — 61→62)
#   · 내 커밋이 이미 서버에 업혀 갔는가(조상 판정)
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
echo "BUILDS_RECENT=$(sudo docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | head -5)"

echo "=== 회차 실측 ==="
ls $W/erp/scripts/_deploy*-up.sh 2>/dev/null | sed 's#.*/_deploy##; s#-up.sh##' | sort -n | tail -3

echo "=== 내 커밋이 이미 올라가 있나 ==="
git -C $W fetch origin --quiet 2>/dev/null
echo "ORIGIN_MAIN=$(git -C $W rev-parse --short origin/main)"
git -C $W merge-base --is-ancestor e74539c3 HEAD 2>/dev/null \
  && echo "ANCESTOR=YES (이미 배포본에 포함 — 배포하지 말 것)" \
  || echo "ANCESTOR=NO (아직 안 나갔다)"

echo "=== 템플릿 자산 현재 지문(주 마커의 before) ==="
sudo docker exec erp-app-1 sh -c '
  ls -l /app/templates/fire-plan-workbook.xlsx 2>/dev/null || echo "NO_TEMPLATE_AT_/app/templates"
  sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16
'
echo "DONE_BASELINE"
