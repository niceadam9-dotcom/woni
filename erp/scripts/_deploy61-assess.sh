#!/usr/bin/env bash
# 61회차 착수 판정 — 읽기 전용. 아무것도 바꾸지 않는다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }

echo "=== SERVER GIT ==="
echo "HEAD_SHA=$(git rev-parse HEAD)"
echo "HEAD_SHORT=$(git rev-parse --short HEAD)"
echo "HEAD_SUBJ=$(git log -1 --format=%s)"
echo "DIRTY=$(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
git fetch origin --quiet 2>/dev/null
echo "ORIGIN_SHA=$(git rev-parse origin/main)"
echo "ORIGIN_SHORT=$(git rev-parse --short origin/main)"
echo "BEHIND=$(git rev-list --count HEAD..origin/main)"
echo "AHEAD=$(git rev-list --count origin/main..HEAD)"

echo "=== RANGE (server HEAD .. origin/main) ==="
git log --oneline HEAD..origin/main | cat
echo "--- 범위 안 마이그레이션 ---"
git diff --name-only HEAD origin/main -- erp/supabase/migrations | cat
echo "MIG_COUNT=$(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)"

echo "=== DOCKER ==="
echo "RUNNING=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "LATEST=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)"
echo "--- 롤백 태그 ---"
sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -F 'rollback' | head -5
echo "--- 컨테이너 ---"
sudo docker ps --format '{{.Names}}\t{{.Status}}' | head -6
echo "INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
echo "--- 최근 빌드 프로세스(누가 지금 배포 중인가) ---"
ps -eo etime,cmd | grep -E 'docker (compose|build)' | grep -v grep | head -5
echo "=== DISK/MEM ==="
df -h / | tail -1
free -m | head -2
echo "=== HTTP ==="
echo "login=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"
