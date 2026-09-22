#!/usr/bin/env bash
# 97회차 배포 확증 — 94c1646e → ac9cbed7 (5커밋 · 마이그 0 · img b2ba83ee5dd3 → b10509516a78)
#
# 판정 규약(96회차까지의 교훈을 그대로 쓴다):
#  · **신규**는 before 0 → after ≥1 (before는 착수 실측에서 운영 이미지에 직접 물었다)
#  · **존속**은 등호가 아니라 **「줄지 않았다」(≥)** — 신규 문자열이 기존 문자열을 부분문자열로
#    품으면 파일 수가 정당하게 는다. 이번엔 `daypanel-period`가 `daypanel-period-mismatch`를 품는다.
#  · **음성**은 0이어야 한다(계측기가 살아 있는지 — 아무거나 세고 있지 않은지)
#  · `grep -c`는 0건일 때 exit 1이라 "0\n0"이 된다 → `wc -l`만 쓴다
#
# ⚠ R8b(92401c55)는 고유 마커가 **원리적으로 없다**(기존 모달 재사용 + minify가 함수명을 지운다).
#   지어내지 않는다 — 착지는 아래 ANCESTRY로 증명하고, 동작은 같은 배의 R3·R7 마커가 증언한다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0

echo "=== 착지 ==="
# 🚨 `--short`는 **7자**(ac9cbed)인데 커밋 표기는 8자(ac9cbed7)다 — 이 저장소에서 이미 두 번
#   가드를 헛되이 세운 함정이다. 이름 길이를 맞추려 들지 말고 **실체로** 묻는다(full sha 접두 비교).
H=$(git rev-parse HEAD); echo "HEAD = $(git rev-parse --short HEAD)  (full $H)"
case "$H" in ac9cbed7*) echo "  ✅ 기대 커밋 ac9cbed7";; *) echo "  ❌ VERIFY_FAIL_HEAD"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
echo "img  = $IMG (직전 b2ba83ee5dd3 — 달라야 한다)"
[ "$IMG" = "b2ba83ee5dd3" ] && { echo "VERIFY_FAIL_IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"

echo
echo "=== ANCESTRY — 내 4커밋이 정말 실린 HEAD인가(마커 없는 R8b는 이걸로 증명한다) ==="
for C in c6ce07a9 8276cf4f 92401c55 ac9cbed7; do
  if git merge-base --is-ancestor "$C" HEAD; then printf '  %-10s ✅ 조상\n' "$C"
  else printf '  %-10s ❌ 미착지\n' "$C"; FAIL=$((FAIL+1)); fi
done

c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

echo
echo "=== 신규 마커 (before 0 → after ≥1이어야 한다) ==="
for M in 'daypanel-period' 'daypanel-period-mismatch' 'daypanel-closed' 'daypanel-row-closed' \
         '종료됨' 'new-anchor-legal' 'new-anchor-provisional' 'anchor-provisional' \
         'customer-row-provisional' 'calendar-cell-new-customer' '잠정 기산점만' '잠정 배치'; do
  N=$(c "$M")
  if [ "$N" -ge 1 ]; then printf '  ✅ %-28s 0 → %s\n' "$M" "$N"
  else printf '  ❌ %-28s 0 → %s  (미착지)\n' "$M" "$N"; FAIL=$((FAIL+1)); fi
done

echo
echo "=== 존속 마커 (줄지 않았다 — 등호 아님) ==="
check_keep(){ N=$(c "$1"); if [ "$N" -ge "$2" ]; then printf '  ✅ %-28s %s ≥ %s\n' "$1" "$N" "$2"
  else printf '  ❌ %-28s %s < %s  (줄었다)\n' "$1" "$N" "$2"; FAIL=$((FAIL+1)); fi; }
check_keep 'daypanel-new-customer' 2
check_keep 'daypanel-workbook'     2
check_keep 'daypanel-fireplan'     2
check_keep 'daypanel-detail-link'  2
check_keep 'daypanel-step-row'     2
check_keep 'anchor-date-modal'     2
check_keep 'anchor-date-save'      2
check_keep 'anchor-date-edit'      2
check_keep 'legal-schedule-badge'  4
check_keep 'calendar-sms-day'      2

echo
echo "=== 음성 (0이어야 한다 — 계측기 자기 검사) ==="
NEG=$(c 'zzzNoSuchMarker97')
if [ "$NEG" = "0" ]; then echo "  ✅ zzzNoSuchMarker97 = 0"
else echo "  ❌ zzzNoSuchMarker97 = $NEG (계측기가 아무거나 센다)"; FAIL=$((FAIL+1)); fi

echo
echo "=== 자산 (이 구간엔 템플릿 변경 0 — 변하면 오히려 이상) ==="
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')
if [ "$SHA" = "5dc767d1a9101aa9" ]; then echo "  ✅ xlsx sha 불변 $SHA"
else echo "  ❌ xlsx sha $SHA (기대 5dc767d1a9101aa9)"; FAIL=$((FAIL+1)); fi

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers https://sjfire.co.kr/inspections/calendar; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$u")
  echo "  $u -> $CODE"
  case "$u" in *login) [ "$CODE" = "200" ] || { echo "  VERIFY_FAIL_LOGIN"; FAIL=$((FAIL+1)); };; esac
done

echo
echo "=== 런타임 오류 (배포 후) ==="
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true)
echo "  최근 10분 오류 줄 수 = $ERRS"
docker logs erp-app-1 --since 10m 2>&1 | grep -iE '\berror\b|unhandled' | head -5

echo
echo "VERIFY_FAIL=$FAIL"
