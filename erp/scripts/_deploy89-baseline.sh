#!/usr/bin/env bash
# 89회차 착수 실측 — 아무것도 바꾸지 않는다.
# ⚠ 이번 변경(beead875)은 **새 한글 문자열이 없다**. 크기·굵기만 바뀌었으므로 마커는
#   className 문자열로 잡는다(Tailwind 클래스는 번들에 그대로 남는다).
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 서버 위치 ==="
echo "HEAD = $(git -C /home/ubuntu/woni rev-parse --short HEAD)"
git -C /home/ubuntu/woni log --oneline -1
echo "dirty = $(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "latest  img = $(docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)"

echo
echo "=== 🚨 남이 배포 중인가 ==="
echo "in-flight = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
ps -eo etime,cmd | grep -F 'docker compose' | grep -v grep || echo "  (없음)"

echo
echo "=== 원격 최신 ==="
git -C /home/ubuntu/woni fetch origin --quiet && git -C /home/ubuntu/woni log --oneline -3 origin/main

echo
echo "=== MARKER BEFORE (실행 중 이미지) ==="
c() { docker exec erp-app-1 sh -c "grep -roF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "  신규  페이저 새 상자(size-12 border-2)   = $(c 'justify-center size-12 rounded-lg border-2')   <- 0이어야"
echo "  신규  순번 새 글꼴(w-14)                 = $(c 'font-semibold text-ink-sub w-14 text-center')   <- 0이어야"
echo "  역방향 페이저 옛 상자(size-7 border)      = $(c 'justify-center size-7 rounded-lg border text-form-sm')   <- N이어야"
echo "  역방향 순번 옛 글꼴(w-12)                = $(c 'text-form-2xs text-ink-sub w-12 text-center')   <- N이어야"
echo "  존속  목록으로 40px(88회차 내 축)        = $(c 'size-10')"
echo "  존속  specs-close testid                 = $(c 'specs-close')"
echo "  음성  zzzNoSuchMarker89                  = $(c 'zzzNoSuchMarker89')   <- 0이어야"

echo
echo "=== 자원 ==="; df -h / | tail -1; free -m | head -2
echo "=== 롤백 태그 ==="; docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -3
echo "=== BASELINE DONE ==="
