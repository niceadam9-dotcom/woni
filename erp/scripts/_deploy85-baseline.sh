#!/usr/bin/env bash
# 85회차 착수 판정 — 배포 전에 서버에게 묻는다(추측으로 시작하면 남의 배포에 올라탄다).
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
echo "=== 회차 실측(두 세션이 같은 번호를 집은 전례) ==="
ls $W/erp/scripts/_deploy*-up.sh 2>/dev/null | sed 's#.*/_deploy##; s#-up.sh##' | sort -n | tail -3
echo "=== 내 커밋이 이미 올라가 있나 ==="
git -C $W fetch origin --quiet 2>/dev/null
echo "ORIGIN_MAIN=$(git -C $W rev-parse --short origin/main)"
git -C $W merge-base --is-ancestor 5d72df24 HEAD 2>/dev/null \
  && echo "ANCESTOR=YES (이미 배포본에 포함 — 배포하지 말 것)" \
  || echo "ANCESTOR=NO (아직 안 나갔다)"
echo "=== 마커 적격성 선실측(before가 0인 축은 판정에서 뺀다) ==="
sudo docker run --rm --entrypoint sh erp-app:latest -c '
  n() { echo "  $1=$(grep -rlF "$2" /app/.next 2>/dev/null | grep -v "\.map$" | wc -l)"; }
  n "신규(보고서 엑셀)"        "보고서 엑셀"
  n "역방향A(엑셀로 받기)"     "엑셀로 받기"
  n "역방향B(w-[2.6rem])"      "w-[2.6rem]"
  n "존속(소방계획서 엑셀)"     "소방계획서 엑셀"
  n "존속(building-saved-note)" "building-saved-note"
  n "존속(mgr171_)"            "mgr171_"
'
echo "DONE_BASELINE"
