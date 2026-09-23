#!/usr/bin/env bash
# 99회차 배포 확증 — a804d283 → 0cd7a69a (7커밋 · 마이그 0 · img 0268216f6efc → ?)
# 판정: 신규 0→≥1 · 역방향 2→0 · 존속 「줄지 않았다」(≥) · 음성 0 · 자산 불변 · 조상 관계.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0
echo "=== 착지 ==="
H=$(git rev-parse HEAD); echo "HEAD = $H"
case "$H" in 0cd7a69a*) echo "  ✅ 기대 커밋 0cd7a69a";; *) echo "  ❌ VERIFY_FAIL_HEAD"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
echo "img  = $IMG (직전 0268216f6efc — 달라야 한다)"
[ "$IMG" = "0268216f6efc" ] && { echo "  ❌ VERIFY_FAIL_IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
# 3장·1.11 수리(52f67b90·ae6273be)는 고유 마커가 원리적으로 없다 — 조상 관계로 착지를 증명한다
for C in 5e219da1 c94c10de 7cdd430a 52f67b90 ae6273be 0cd7a69a; do
  git merge-base --is-ancestor "$C" HEAD && printf '  %-10s ✅ 조상\n' "$C" || { printf '  %-10s ❌ 미착지\n' "$C"; FAIL=$((FAIL+1)); }
done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo; echo "=== 신규 (0 → ≥1) ==="
for M in info-save-bar building-keydates fsm-keyrow new-keydates info-keydates data-save-bar contacts-group building-group; do
  N=$(c "$M"); if [ "$N" -ge 1 ]; then printf '  ✅ %-30s 0 → %s\n' "$M" "$N"; else printf '  ❌ %-30s 0 → %s\n' "$M" "$N"; FAIL=$((FAIL+1)); fi
done
echo; echo "=== 역방향 (2 → 0) ==="
N=$(c '담당 배정 · 추가 관계인 · 계약일 · 사용승인일')
[ "$N" = "0" ] && echo "  ✅ 옛 등록 화면 선택 항목 머리 2 → 0" || { echo "  ❌ 옛 등록 화면 선택 항목 머리 2 → $N"; FAIL=$((FAIL+1)); }
echo; echo "=== 존속 (≥) ==="
keep(){ N=$(c "$1"); if [ "$N" -ge "$2" ]; then printf '  ✅ %-30s %s ≥ %s\n' "$1" "$N" "$2"; else printf '  ❌ %-30s %s < %s\n' "$1" "$N" "$2"; FAIL=$((FAIL+1)); fi; }
keep fp-info-save 2; keep form14-save 4; keep specs-save 4; keep fsm-save 2; keep etc-items-save 2
keep annex-status-save 2; keep form14-multi-use-save 4; keep daypanel-new-customer 2
keep initialDayPanelDate 3; keep returnHref 3; keep '1.11.1 연간 훈련·교육 계획' 2
echo; echo "=== 음성 ==="
NEG=$(c zzzNoSuchMarker99); [ "$NEG" = "0" ] && echo "  ✅ zzzNoSuchMarker99 = 0" || { echo "  ❌ 음성 $NEG"; FAIL=$((FAIL+1)); }
echo; echo "=== 자산 ==="
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')
[ "$SHA" = "5dc767d1a9101aa9" ] && echo "  ✅ xlsx sha 불변 $SHA" || { echo "  ❌ xlsx sha $SHA"; FAIL=$((FAIL+1)); }
echo; echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers/new https://sjfire.co.kr/customers; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$u"); echo "  $u -> $CODE"
  case "$u" in *login) [ "$CODE" = "200" ] || { echo "  VERIFY_FAIL_LOGIN"; FAIL=$((FAIL+1)); };; esac
done
echo; echo "=== 런타임 오류 (최근 10분) ==="
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true)
echo "  오류 줄 수 = $ERRS"; docker logs erp-app-1 --since 10m 2>&1 | grep -iE '\berror\b|unhandled' | head -5
echo; echo "VERIFY_FAIL=$FAIL"
