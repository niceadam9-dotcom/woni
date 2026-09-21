#!/usr/bin/env bash
# 86회차 배포 **착수 실측** — 아직 아무것도 바꾸지 않는다.
# 서버가 지금 어디 있고, 남이 배포 중이지는 않은지, 배포 전 마커가 몇인지를 먼저 잰다.
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 서버 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)"
git -C /home/ubuntu/woni log --oneline -1
echo "dirty(up.log 제외) = $(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "latest  img = $(docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)"

echo
echo "=== 🚨 남이 배포 중인가 (4GB VPS — 동시 빌드는 OOM) ==="
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "in-flight docker compose = $INFLIGHT"
ps -eo etime,cmd | grep -F 'docker compose' | grep -v grep || echo "  (없음)"

echo
echo "=== 원격 최신 ==="
git -C /home/ubuntu/woni fetch origin --quiet && git -C /home/ubuntu/woni log --oneline -3 origin/main

echo
echo "=== MARKER BEFORE (실행 중 이미지 실물) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "  신규  xlsx-notice-chip              = $(c 'xlsx-notice-chip')          <- 0이어야"
echo "  신규  고지 머리글(아래 칸이 비었거나) = $(c '아래 칸이 비었거나')          <- 0이어야"
echo "  감소  엑셀 고지:                     = $(c '엑셀 고지: ')"
echo "  존속  plan-bar-pdf (83회차 내 축)    = $(c 'plan-bar-pdf')"
echo "  존속  reports-round-label (85회차)   = $(c 'reports-round-label')"
echo "  존속  fire-plan-xlsx                 = $(c 'fire-plan-xlsx')"
echo "  음성  zzzNoSuchMarker86              = $(c 'zzzNoSuchMarker86')        <- 0이어야"

echo
echo "=== 롤백 태그 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -4
echo "=== 디스크·메모리 ==="
df -h / | tail -1
free -m | head -2
echo "=== BASELINE DONE ==="
