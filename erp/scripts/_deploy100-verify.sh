#!/usr/bin/env bash
# 100회차 배포 확증 — 0cd7a69a → 70de37d2 (마이그 0 · img 52f3ce720d59 → ?)
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0
H=$(git rev-parse HEAD); echo "HEAD = $H"
case "$H" in 70de37d2*) echo "  ✅ 기대 커밋 70de37d2";; *) echo "  ❌ VERIFY_FAIL_HEAD"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
echo "img  = $IMG (직전 52f3ce720d59 — 달라야 한다)"; [ "$IMG" = "52f3ce720d59" ] && { echo "  ❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
for C in dccb1b64 70de37d2; do git merge-base --is-ancestor "$C" HEAD && printf '  %-10s ✅ 조상\n' "$C" || { printf '  %-10s ❌ 미착지\n' "$C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "=== 신규 (0 → ≥1) ==="
for M in cal-nav cal-toolbar-secondary cal-nav-move cal-nav-label inspanel-close cal-orphan-chip report-gaps-next report-gaps-return; do
  N=$(c "$M"); if [ "$N" -ge 1 ]; then printf '  ✅ %-26s 0 → %s\n' "$M" "$N"; else printf '  ❌ %-26s 0 → %s\n' "$M" "$N"; FAIL=$((FAIL+1)); fi; done
echo "=== 역방향 — 원리적으로 없음(옛 퇴사 띠 문구가 칩 title로 남는다) ==="
echo "=== 존속 (≥) ==="
keep(){ N=$(c "$1"); if [ "$N" -ge "$2" ]; then printf '  ✅ %-26s %s ≥ %s\n' "$1" "$N" "$2"; else printf '  ❌ %-26s %s < %s\n' "$1" "$N" "$2"; FAIL=$((FAIL+1)); fi; }
keep cal-customer-search 2; keep calendar-sms-toolbar 2; keep calendar-new-customer 2; keep daypanel-new-customer 2
keep daypanel-close 2; keep info-save-bar 2; keep data-save-bar 6; keep fsm-keyrow 2
NEG=$(c zzzNoSuchMarker100); [ "$NEG" = "0" ] && echo "  ✅ 음성 0" || { echo "  ❌ 음성 $NEG"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')
[ "$SHA" = "5dc767d1a9101aa9" ] && echo "  ✅ xlsx sha 불변" || { echo "  ❌ xlsx sha $SHA"; FAIL=$((FAIL+1)); }
for u in https://sjfire.co.kr/login https://sjfire.co.kr/inspections/calendar; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$u"); echo "  $u -> $CODE"
  case "$u" in *login) [ "$CODE" = "200" ] || { echo "  VERIFY_FAIL_LOGIN"; FAIL=$((FAIL+1)); };; esac; done
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true)
echo "  런타임 오류 줄 수(10분) = $ERRS"; docker logs erp-app-1 --since 10m 2>&1 | grep -iE '\berror\b|unhandled' | head -5
echo "VERIFY_FAIL=$FAIL"
