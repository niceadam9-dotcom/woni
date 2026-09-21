#!/usr/bin/env bash
# 95회차 판정 — 37820ac → 5ae147d (6커밋 · 마이그 0)
#
# 이 회차는 **세 세션의 커밋이 한 배**에 실렸다. 그래서 내 축만 보지 않고 구간 전체를 묻는다.
#   fb22bbd3 (달력 복귀)  007db617 (검사)  fceb11e9 (점검기간)  f615cb7c (달력 엑셀)  5ae147d5 (탭 바)
#
# 🚨 `5ae147d5`에는 **새 문자열이 없다** — className은 그대로고 JSX 중첩만 바뀌었다.
#   개수 마커가 원리적으로 없으므로 축을 **자리**로 잡는다(75회차 [+고객 등록] 이사와 같은 수법):
#   같은 청크에서 탭 바 클래스와 본문 셸 클래스의 **바이트 오프셋이 맞교대**해야 한다.
#     before(실측 2026-09-21, img 2a3f6ae58941):
#        2_luxk5tpz8bq.js   tablist@2756   shell@2369    → shell < tablist
#        40iw6coqarmu5.js   tablist@27318  shell@26931   → shell < tablist
#     after(기대): 두 청크 모두 **tablist < shell**
# 🚨 오프셋은 컨테이너 BusyBox grep으로 못 잰다(-b 없음) — 호스트로 흘려 GNU grep으로 잰다.
# 🚨 `grep -c`는 0건일 때 exit 1이라 `|| echo 0`을 붙이면 "0\n0"이 된다(94회차 거짓 빨강).
#   여기서는 `wc -l`만 쓴다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0
ok(){ if [ "$1" = "$2" ]; then echo "  ✅ $3 ($1)"; else echo "  ❌ $3 — 기대 $2 / 실측 $1"; FAIL=$((FAIL+1)); fi; }

echo "=== 착지 ==="
NEW=$(git rev-parse --short HEAD)
echo "HEAD = $NEW  $(git log -1 --format=%s)"
echo "img  = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)  (before 2a3f6ae58941)"
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F "rollback-$NEW" && echo "  복귀점 확보" || echo "  ⚠ 복귀점 태그 없음"

echo
echo "=== 조상 관계 — 구간 5커밋이 전부 실렸나 ==="
for C in fb22bbd3 007db617 fceb11e9 f615cb7c 5ae147d5; do
  if git merge-base --is-ancestor "$C" HEAD; then echo "  ✅ $C"; else echo "  ❌ $C 없음"; FAIL=$((FAIL+1)); fi
done

echo
echo "=== 내 축(5ae147d5) — 탭 바/셸 오프셋 맞교대 ==="
FILES=$(docker exec erp-app-1 sh -c "grep -rl 'flex flex-wrap gap-1 border-b border-line' /app/.next/static/chunks 2>/dev/null")
N=$(echo "$FILES" | grep -c .)
echo "  청크 후보 = $N (before 2)"
[ "$N" -ge 1 ] || { echo "  ❌ 탭 바 클래스가 번들에 없다 — 계측기부터 의심할 것"; FAIL=$((FAIL+1)); }
for f in $FILES; do
  docker exec erp-app-1 sh -c "cat '$f'" > /tmp/_chunk95v.js 2>/dev/null
  A=$(grep -bo 'flex flex-wrap gap-1 border-b border-line' /tmp/_chunk95v.js | head -1 | cut -d: -f1)
  B=$(grep -bo 'flex gap-6 items-start' /tmp/_chunk95v.js | head -1 | cut -d: -f1)
  if [ -n "${A:-}" ] && [ -n "${B:-}" ]; then
    if [ "$A" -lt "$B" ]; then echo "  ✅ $(basename "$f")  tablist@$A < shell@$B  (맞교대 성립)"
    else echo "  ❌ $(basename "$f")  shell@$B < tablist@$A  — before형 그대로다"; FAIL=$((FAIL+1)); fi
  else
    echo "  ⚠ $(basename "$f")  한쪽이 없다 (tablist=${A:-없음} shell=${B:-없음})"
  fi
done
rm -f /tmp/_chunk95v.js

echo
echo "=== 남의 축(95회차 구간) — 신규 마커 ==="
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
for M in 'multiday-end' 'multiday-warn' '다일 점검은 최대' 'daypanel-workbook'; do
  V=$(c "$M"); if [ "$V" -ge 1 ]; then echo "  ✅ $M = $V (before 0)"; else echo "  ❌ $M = 0 — 안 나갔다"; FAIL=$((FAIL+1)); fi
done

echo
echo "=== 존속(줄면 안 된다) ==="
ok "$(c 'flex gap-6 items-start')"   4 'flex gap-6 items-start'
ok "$(c 'calendar-step-input')"      2 'calendar-step-input'
ok "$(c 'daypanel-detail-link')"     2 'daypanel-detail-link'
ok "$(c 'sheet-entry-back')"         2 'sheet-entry-back'
ok "$(c 'data-detail-panel')"        2 'data-detail-panel'
echo "=== 음성 ==="
ok "$(c 'zzzNoSuchMarker95')"        0 'zzzNoSuchMarker95'
echo "=== 자산(이 구간엔 템플릿 변경 없음) ==="
echo "  xlsx sha = $(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')  (기대 5dc767d1a9101aa9)"

echo
echo "=== 기동 후 오류 ==="
ERR=$(docker logs --since 10m erp-app-1 2>&1 | grep -ciE '^\s*(error|uncaught|unhandled)' || true)
echo "  error 줄 = ${ERR:-0}"

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers https://sjfire.co.kr/; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u"
done

echo
echo "VERIFY_FAIL=$FAIL"
