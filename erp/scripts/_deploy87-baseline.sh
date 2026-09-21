#!/usr/bin/env bash
# 87회차 배포 **착수 실측** — 아직 아무것도 바꾸지 않는다.
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
git -C /home/ubuntu/woni fetch origin --quiet && git -C /home/ubuntu/woni log --oneline -4 origin/main

echo
echo "=== MARKER BEFORE (실행 중 이미지 실물) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "--- 신규(0이어야) ---"
echo "  data-detail-panel      = $(c 'data-detail-panel')       <- 트리 Enter 착지점(키보드)"
echo "  aria-modal             = $(c 'aria-modal')              <- 미저장 확인창 수리"
echo "  표지 제목 크기 조정 불발 = $(c '표지 제목 크기 조정 불발')  <- 표지 고지(한글이라 minify 무관)"
echo "--- 존속(유지되어야) ---"
echo "  xlsx-notice-chip       = $(c 'xlsx-notice-chip')        <- 86회차 남의 축"
echo "  reports-round-label    = $(c 'reports-round-label')     <- 85회차 축"
echo "  fire-plan-xlsx         = $(c 'fire-plan-xlsx')          <- 넓은 축"
echo "  저장하지 않은 변경이 있습니다 = $(c '저장하지 않은 변경이 있습니다')  <- 확인창 자체는 원래 있다"
echo "--- 음성(0이어야 — grep 거짓양성 가드) ---"
echo "  zzzNoSuchMarker87      = $(c 'zzzNoSuchMarker87')"

echo
echo "=== 표지 템플릿 자산 sha256 (표지 개편의 주 마커) ==="
echo "  배포 전 = $(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")"
echo "  (기대: 배포 전 890b560579ef8215 → 배포 후 dd7ced2260f5a7fe)"
echo "  ⚠ 경로가 다르면 찾는다:"
docker exec erp-app-1 sh -c "find /app -name 'fire-plan-workbook.xlsx' 2>/dev/null | head -3"

echo
echo "=== 마이그레이션 — 이번 구간에 DB 변경이 있는가 ==="
git -C /home/ubuntu/woni diff --name-only HEAD origin/main -- supabase/migrations | head -10
echo "  (위가 비어 있으면 DDL 없음)"

echo
echo "=== 롤백 태그 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -4
echo "=== 디스크·메모리 ==="
df -h / | tail -1
free -m | head -2
echo "=== BASELINE DONE ==="
