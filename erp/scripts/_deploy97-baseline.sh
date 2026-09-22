#!/usr/bin/env bash
# 97회차 착수 실측(읽기 전용) — 94c1646e → origin/main(ac9cbed7 · 5커밋 · 마이그 0)
#   e3add004 chore(배포): 96회차 기록                              (문서 전용)
#   c6ce07a9 feat(점검달력): 패널에 점검기간 접힌 한 줄            (R3)
#   8276cf4f feat(점검달력): 한 바퀴 끝난 회차를 「종료됨」으로     (R7)
#   92401c55 feat(점검달력): 1단계 칩 드래그로 점검일자 이동       (R8b)
#   ac9cbed7 feat(고객·점검달력): 잠정 기산점                      (사용승인일 미입력 드러내기)
#
# ① 지금 무엇이 물려 있나 ② 회차 97이 맞나(선점 전례 3회) ③ 구간이 원격에 있고 서버엔 없나
# ④ 마커 before — **신규 후보는 0이어야 적격**
#
# 🚨 R8b(92401c55)는 **새 문자열이 없다** — 드롭이 R8a의 기존 모달(anchor-date-modal)을 그대로
#   재사용하고, 판정 모듈(calendar-drag)의 함수명은 minify가 지운다. 96회차 R4와 같은 부류다.
#   **지어내지 않는다**: 착지는 조상 관계로 증명하고, 동작은 그 위에 얹힌 R3·R7 마커가 증언한다
#   (같은 파일·같은 배에 실려 있으므로 그 마커가 뜨면 R8b도 그 번들 안에 있다).
# 🚨 한글 낱말(`종료됨`·`잠정`·`점검기간`)은 **이미 번들에 있을 수 있다** — before가 0이 아니면
#   신규 마커로 **부적격**이다(96회차에서 `결과보고서 엑셀`이 before 4였던 전례). 여기서 가른다.
# 🚨 `grep -c`는 0건일 때 exit 1이라 "0\n0"이 된다(94회차 거짓 빨강) → `wc -l`만 쓴다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"

echo
echo "=== 회차 세기 ==="
ls /home/ubuntu/woni/erp/scripts/_deploy*-up.sh 2>/dev/null | sort -V | tail -3
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -4

echo
echo "=== 구간 ==="
git fetch origin --quiet
echo "origin/main = $(git rev-parse --short origin/main)"
for C in e3add004 c6ce07a9 8276cf4f 92401c55 ac9cbed7; do
  R='원격 NO'; S='서버 미배포'
  git merge-base --is-ancestor "$C" origin/main && R='원격 YES'
  git merge-base --is-ancestor "$C" HEAD && S='서버 이미 배포됨'
  printf '  %-10s %-8s %s\n' "$C" "$R" "$S"
done
echo "  --- 서버 HEAD..origin/main ---"
git log --oneline HEAD..origin/main
echo "  마이그 변경 = $(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)건"

c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

echo
echo "=== 신규 마커 before (0이어야 후보 적격) ==="
for M in 'daypanel-period' 'daypanel-period-mismatch' 'daypanel-closed' 'daypanel-row-closed' \
         'new-anchor-legal' 'new-anchor-provisional' 'anchor-provisional' \
         'customer-row-provisional' 'calendar-cell-new-customer' \
         '잠정 기산점만' '잠정 배치' '종료됨' '점검기간' 'inspectionStartDate'; do
  printf '  %-30s = %s\n' "$M" "$(c "$M")"
done

echo
echo "=== 존속 마커(줄면 안 된다 — 등호 아님) ==="
for M in 'daypanel-new-customer' 'daypanel-workbook' 'daypanel-fireplan' 'daypanel-detail-link' \
         'anchor-date-modal' 'anchor-date-save' 'anchor-date-edit' 'legal-schedule-badge' \
         'calendar-sms-day' 'daypanel-step-row'; do
  printf '  %-30s = %s\n' "$M" "$(c "$M")"
done
echo "=== 음성 ==="
printf '  %-30s = %s\n' 'zzzNoSuchMarker97' "$(c 'zzzNoSuchMarker97')"

echo
echo "=== 자산(이 구간엔 템플릿 변경 0 — 변하면 오히려 이상) ==="
echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')"

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
echo BASELINE_DONE
