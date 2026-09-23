#!/usr/bin/env bash
# 99회차 착수 실측(읽기 전용) — a804d283 → origin/main(0cd7a69a · 7커밋 · 마이그 0)
#   29ff1344 chore(배포): 98회차 기록                                            (문서 전용)
#   5e219da1·c94c10de·7cdd430a·0cd7a69a feat(고객): 그룹 정렬 · 기준일 강조 · 저장 줄 한 벌(SaveBar) · 넓게
#   52f67b90 fix(소방계획서 3장) · ae6273be fix(소방계획서 1.11) — 부분 저장값 크래시
#
# 🚨 3장·1.11 수리는 **고유 마커가 원리적으로 없다** — 정규화 함수명은 minify가 지우고 새 문자열이 없다.
#   지어내지 않는다: 착지는 조상 관계로 증명한다(97회차 R8b·96회차 R4와 같은 부류).
# 🚨 `grep -c`는 0건일 때 exit 1 → `wc -l`만 쓴다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
echo "=== 위치 ==="
echo "HEAD        = $(git rev-parse HEAD)  $(git log -1 --format=%s | cut -c1-60)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
echo; echo "=== 회차 세기 ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | grep -F 'erp-app:rollback-' | head -3
echo; echo "=== 구간 ==="
git fetch origin --quiet
echo "origin/main = $(git rev-parse origin/main)"
for C in 5e219da1 c94c10de 7cdd430a 52f67b90 ae6273be 0cd7a69a; do
  R='원격 NO'; S='서버 미배포'
  git merge-base --is-ancestor "$C" origin/main 2>/dev/null && R='원격 YES'
  git merge-base --is-ancestor "$C" HEAD 2>/dev/null && S='서버 이미 배포됨'
  printf '  %-10s %-8s %s\n' "$C" "$R" "$S"
done
echo "  마이그 변경 = $(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)건"
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo; echo "=== 신규 후보 before (0이어야 적격) ==="
for M in info-save-bar building-keydates fsm-keyrow new-keydates info-keydates data-save-bar contacts-group building-group; do
  printf '  %-32s = %s\n' "$M" "$(c "$M")"; done
echo; echo "=== 역방향 후보 before (≥1이어야 적격) ==="
printf '  %-32s = %s\n' '담당 배정 · 추가 관계인' "$(c '담당 배정 · 추가 관계인 · 계약일 · 사용승인일')"
echo; echo "=== 존속 ==="
for M in fp-info-save form14-save specs-save fsm-save etc-items-save annex-status-save form14-multi-use-save \
         daypanel-new-customer initialDayPanelDate returnHref '1.11.1 연간 훈련·교육 계획'; do
  printf '  %-32s = %s\n' "$M" "$(c "$M")"; done
echo "=== 음성 ==="; printf '  %-32s = %s\n' zzzNoSuchMarker99 "$(c zzzNoSuchMarker99)"
echo; echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')"
curl -s -o /dev/null -w "  login -> %{http_code}\n" -m 25 https://sjfire.co.kr/login
echo BASELINE_DONE
