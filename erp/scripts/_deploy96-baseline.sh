#!/usr/bin/env bash
# 96회차 착수 실측(읽기 전용) — 5ae147d → origin/main(94c1646e · 9커밋 · 마이그 0)
#   e0011940 feat(점검달력): 점검일자를 달력에서 고친다        (R8a)
#   ee8b294d feat(점검달력): 달력에서 날짜를 짚어 고객을 등록  (R1)
#   ab4356b7 fix(점검달력): 미래 날짜를 정직하게               (R2)
#   e6d5945f feat(보고서): 엑셀 고지 분류 — 순수 모듈·화면 0   (R4)
#   4070b9d7 feat(점검달력): 고지를 채우러 가는 입구로         (R5)
#   94c1646e feat(점검달력): 패널에 소방계획서 엑셀 + 칩       (R6)
#   4b01ed90·a2fea72f·150f6410 chore(배포): 95회차 기록        (문서 전용)
#
# ① 지금 무엇이 물려 있나(HEAD·img·inflight) ② 회차 번호가 96이 맞나(타 세션 선점 전례 3회)
# ③ 구간 6커밋이 원격에 있고 서버엔 없나 ④ 마커 before(신규 후보는 **0이어야 적격**)
#
# 🚨 신규 마커는 전부 data-testid 문자열 리터럴이다 — 로컬 프로덕션 .next에서 선실측해
#   번들에 살아남는 것을 확인했다(3~4파일). minify가 지우는 식별자 축은 쓰지 않는다.
# 🚨 `grep -c`는 0건일 때 exit 1이라 "0\n0"이 된다(94회차 거짓 빨강) → `wc -l`만 쓴다.
# 🚨 R4(e6d5945f)는 **화면 변경 0인 순수 모듈**이라 고유 마커가 원리적으로 없다.
#   지어내지 않는다 — 착지는 조상 관계로, 동작은 그 위에 얹힌 R5 마커(doc-notice-*)로 본다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"

echo
echo "=== 회차 세기 — 롤백 태그(이미지 교체 흔적) ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep -F 'erp-app:rollback-' | head -6
echo "  --- 서버에 남은 up 스크립트 최신 번호 ---"
ls /home/ubuntu/woni/erp/scripts/_deploy*-up.sh 2>/dev/null | tail -3
ls /tmp/_deploy9*-up.sh 2>/dev/null | tail -3

echo
echo "=== 구간 ==="
git fetch origin --quiet
echo "origin/main = $(git rev-parse --short origin/main)"
for C in e0011940 ee8b294d ab4356b7 e6d5945f 4070b9d7 94c1646e; do
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
echo "=== 신규 마커 before (전부 0이어야 후보 적격) ==="
for M in 'anchor-date-preview' 'anchor-date-save' 'anchor-date-modal-blocked' \
         'anchor-future-note' 'calendar-new-customer-modal' 'daypanel-new-customer' \
         'calendar-created-banner' 'doc-notice-chip' 'doc-notice-caps' \
         'daypanel-workbook-resume' 'daypanel-fireplan' '점검일자 고치기' '채우러 가기'; do
  printf '  %-30s = %s\n' "$M" "$(c "$M")"
done

echo
echo "=== 존속 마커(줄면 안 된다) ==="
for M in 'calendar-step-input' 'daypanel-detail-link' 'sheet-entry-back' 'data-detail-panel' \
         'daypanel-workbook' 'multiday-end' 'flex gap-6 items-start'; do
  printf '  %-30s = %s\n' "$M" "$(c "$M")"
done
echo "=== 음성 ==="
printf '  %-30s = %s\n' 'zzzNoSuchMarker96' "$(c 'zzzNoSuchMarker96')"

echo
echo "=== 자산(이 구간엔 템플릿 변경 없음 — 변하면 오히려 이상) ==="
echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')"

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
echo BASELINE_DONE
