#!/usr/bin/env bash
# 100회차 착수 실측(읽기 전용) — 0cd7a69a → origin/main(70de37d2 · 2커밋 · 마이그 0)
#   dccb1b64 chore(배포): 99회차 기록                                   (문서 전용)
#   70de37d2 feat(점검달력·고객): 도구줄 두 줄 + 보고서 빈칸 안내(타 세션 작업 이어받기)
# 🚨 역방향 마커는 원리적으로 없다 — 옛 퇴사 띠 문구가 칩 title로 그대로 남는다(지어내지 않는다).
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
echo "HEAD        = $(git rev-parse HEAD)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | grep -F 'erp-app:rollback-' | head -2
git fetch origin --quiet
echo "origin/main = $(git rev-parse origin/main)"
for C in dccb1b64 70de37d2; do R='원격 NO'; S='서버 미배포'
  git merge-base --is-ancestor "$C" origin/main 2>/dev/null && R='원격 YES'
  git merge-base --is-ancestor "$C" HEAD 2>/dev/null && S='서버 이미 배포됨'
  printf '  %-10s %-8s %s\n' "$C" "$R" "$S"; done
echo "  마이그 변경 = $(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)건"
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "=== 신규 후보 before (0이어야 적격) ==="
for M in cal-toolbar-secondary cal-nav-move cal-nav-label inspanel-close cal-orphan-chip report-gaps-next report-gaps-return; do
  printf '  %-26s = %s\n' "$M" "$(c "$M")"; done
echo "=== 존속 ==="
for M in cal-nav cal-customer-search calendar-sms-toolbar calendar-new-customer daypanel-new-customer daypanel-close info-save-bar data-save-bar fsm-keyrow; do
  printf '  %-26s = %s\n' "$M" "$(c "$M")"; done
printf '  %-26s = %s\n' zzzNoSuchMarker100 "$(c zzzNoSuchMarker100)"
echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')"
curl -s -o /dev/null -w "  login -> %{http_code}\n" -m 25 https://sjfire.co.kr/login
echo BASELINE_DONE
