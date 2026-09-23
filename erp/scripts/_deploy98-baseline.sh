#!/usr/bin/env bash
# 98회차 착수 실측(읽기 전용) — ac9cbed7 → origin/main(3커밋 · 마이그 0)
#   53806ec1 feat(점검달력): 보고서 고지 제거 + 고객 등록은 페이지로·왔던 사이드바로 복귀 (R9)
#   74399f84 test(점검달력): R9 변이 두 벌 재작성 (scripts 전용)
#   a804d283 test(점검달력): R9 실화면 왕복 프로브 (scripts 전용)
#
# ① 지금 무엇이 물려 있나 ② 회차 98이 맞나(선점 전례) ③ 구간이 원격에 있고 서버엔 없나
# ④ 마커 before — 신규는 0이어야, 역방향은 ≥1이어야 적격
#
# 🚨 `채우면 다음 발행에 반영됩니다`는 **마커로 쓰지 않는다** — 소방계획서 칩(doc-notice-list)이
#   같은 글자를 계속 쓴다. 보고서 축만 뺐으므로 개수가 안 준다(공유 부품 함정 — 86회차 전례).
# 🚨 `grep -c`는 0건일 때 exit 1 → `wc -l`만 쓴다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git rev-parse HEAD)  $(git log -1 --format=%s | cut -c1-60)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"

echo
echo "=== 회차 세기 ==="
ls /home/ubuntu/woni/erp/scripts/_deploy*-up.sh 2>/dev/null | sort -V | tail -3
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' | grep -F 'erp-app:rollback-' | head -4

echo
echo "=== 구간 ==="
git fetch origin --quiet
echo "origin/main = $(git rev-parse origin/main)"
for C in 53806ec1 74399f84 a804d283; do
  R='원격 NO'; S='서버 미배포'
  git merge-base --is-ancestor "$C" origin/main 2>/dev/null && R='원격 YES'
  git merge-base --is-ancestor "$C" HEAD 2>/dev/null && S='서버 이미 배포됨'
  printf '  %-10s %-8s %s\n' "$C" "$R" "$S"
done
echo "  --- 서버 HEAD..origin/main ---"
git log --oneline HEAD..origin/main
echo "  마이그 변경 = $(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)건"

c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

echo
echo "=== 신규 후보 before (0이어야 적격) ==="
for M in 'initialDayPanelDate' '등록하면 점검달력으로 돌아갑니다' 'returnHref'; do
  printf '  %-34s = %s\n' "$M" "$(c "$M")"
done
echo
echo "=== 역방향 후보 before (≥1이어야 적격 — 배포 후 0) ==="
for M in 'calendar-new-customer-modal' 'daypanel-workbook-resume' 'calendar-created-banner' 'created-started' 'created-planned'; do
  printf '  %-34s = %s\n' "$M" "$(c "$M")"
done
echo
echo "=== 존속(줄면 안 된다) ==="
for M in 'daypanel-new-customer' 'calendar-new-customer' 'calendar-cell-new-customer' 'daypanel-workbook' \
         'daypanel-fireplan' 'doc-notice-list' 'doc-notice-chip' 'workbook-xlsx' '채우면 다음 발행에 반영됩니다' \
         'anchor-date-modal' 'daypanel-closed' 'new-anchor-provisional'; do
  printf '  %-34s = %s\n' "$M" "$(c "$M")"
done
echo "=== 음성 ==="
printf '  %-34s = %s\n' 'zzzNoSuchMarker98' "$(c 'zzzNoSuchMarker98')"

echo
echo "=== 자산 ==="
echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')"
echo
echo "=== 서빙 ==="
curl -s -o /dev/null -w "  login -> %{http_code}\n" -m 25 https://sjfire.co.kr/login
echo BASELINE_DONE
