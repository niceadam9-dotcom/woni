#!/usr/bin/env bash
# 96회차 판정 — 5ae147d → 94c1646 (9커밋 · 마이그 0)
#
# 이 회차는 점검달력 R-시리즈가 한 배로 나간다(R8a·R1·R2·R4·R5·R6).
#
# 🚨 `grep -c`는 0건일 때 exit 1이라 `|| echo 0`을 붙이면 "0\n0"이 된다(94회차 거짓 빨강)
#    → `wc -l`만 쓴다.
# 🚨 존속 마커는 **「줄지 않았다」로 판정**한다(등호 아님). 이번 구간에서 `daypanel-workbook`은
#    신규 `daypanel-workbook-resume`을 **부분문자열로 품어** 정당하게 늘 수 있다 — 등호로 걸면
#    멀쩡한 배포가 빨강이 된다(85회차 「툴팁이 라벨을 품어 before 4」와 같은 부류).
#    다만 값이 변하면 화면에 함께 찍어 눈으로 확인한다.
# 🚨 R4(e6d5945f)는 화면 변경 0인 순수 모듈이라 고유 마커가 **원리적으로 없다**. 지어내지 않고
#    조상 관계로 착지를 증명한다(동작은 그 위의 R5 칩이 대신 증언한다).
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
ge(){ # $1=실측 $2=before $3=이름
  if [ "$1" -ge "$2" ]; then
    if [ "$1" = "$2" ]; then echo "  ✅ $3 ($1 = $2)"; else echo "  ✅ $3 ($2 → $1 · 늘었다)"; fi
  else echo "  ❌ $3 — before $2 / 실측 $1 (줄었다)"; FAIL=$((FAIL+1)); fi; }
eq(){ if [ "$1" = "$2" ]; then echo "  ✅ $3 ($1)"; else echo "  ❌ $3 — 기대 $2 / 실측 $1"; FAIL=$((FAIL+1)); fi; }

echo "=== 착지 ==="
NEW=$(git rev-parse --short HEAD)
echo "HEAD   = $NEW  $(git log -1 --format=%s)"
echo "img    = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)  (before 7ab4339df187)"
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "up since = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F "rollback-$NEW" && echo "  복귀점 확보" || { echo "  ⚠ 복귀점 태그 없음"; FAIL=$((FAIL+1)); }

echo
echo "=== 조상 관계 — 구간 6커밋이 전부 실렸나 ==="
for C in e0011940 ee8b294d ab4356b7 e6d5945f 4070b9d7 94c1646e; do
  if git merge-base --is-ancestor "$C" HEAD; then echo "  ✅ $C"; else echo "  ❌ $C 없음"; FAIL=$((FAIL+1)); fi
done

echo
echo "=== 신규 마커 (before 전부 0 — 실측값이 박혀 있다) ==="
for M in 'anchor-date-preview' 'anchor-date-save' 'anchor-date-modal-blocked' '점검일자 고치기' \
         'calendar-new-customer-modal' 'daypanel-new-customer' 'calendar-created-banner' \
         'anchor-future-note' 'doc-notice-chip' 'doc-notice-caps' \
         'daypanel-workbook-resume' 'daypanel-fireplan'; do
  V=$(c "$M")
  if [ "$V" -ge 1 ]; then echo "  ✅ $M = $V (before 0)"; else echo "  ❌ $M = 0 — 안 나갔다"; FAIL=$((FAIL+1)); fi
done

echo
echo "=== 존속 (줄면 안 된다 · before는 착수 실측값) ==="
ge "$(c 'calendar-step-input')"     2 'calendar-step-input'
ge "$(c 'daypanel-detail-link')"    2 'daypanel-detail-link'
ge "$(c 'sheet-entry-back')"        2 'sheet-entry-back'
ge "$(c 'data-detail-panel')"       2 'data-detail-panel'
ge "$(c 'daypanel-workbook')"       2 'daypanel-workbook  (95회차 축)'
ge "$(c 'multiday-end')"            2 'multiday-end       (95회차 축)'
ge "$(c 'flex gap-6 items-start')"  4 'flex gap-6 items-start'

echo "=== 음성 ==="
eq "$(c 'zzzNoSuchMarker96')"       0 'zzzNoSuchMarker96'

echo "=== 자산(이 구간엔 템플릿 변경 없음 — 변하면 오히려 이상) ==="
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')
eq "$SHA" '5dc767d1a9101aa9' 'xlsx sha 불변'

echo
echo "=== 기동 후 오류 ==="
ERR=$(docker logs --since 10m erp-app-1 2>&1 | grep -ciE '^\s*(error|uncaught|unhandled)' || true)
echo "  error 줄 = ${ERR:-0}"

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers https://sjfire.co.kr/inspections/calendar; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u"
done

echo
echo "VERIFY_FAIL=$FAIL"
