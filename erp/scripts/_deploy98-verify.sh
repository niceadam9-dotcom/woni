#!/usr/bin/env bash
# 98회차 배포 확증 — ac9cbed7 → a804d283 (4커밋 · 마이그 0 · img b10509516a78 → ?)
# 판정: 신규 0→≥1 · 역방향 2→0 · 존속 「줄지 않았다」(≥) · 음성 0 · 자산 불변 · 조상 관계.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }
FAIL=0

echo "=== 착지 ==="
H=$(git rev-parse HEAD); echo "HEAD = $H"
case "$H" in a804d283*) echo "  ✅ 기대 커밋 a804d283";; *) echo "  ❌ VERIFY_FAIL_HEAD"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
echo "img  = $IMG (직전 b10509516a78 — 달라야 한다)"
[ "$IMG" = "b10509516a78" ] && { echo "  ❌ VERIFY_FAIL_IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
for C in 53806ec1 74399f84 a804d283; do
  git merge-base --is-ancestor "$C" HEAD && printf '  %-10s ✅ 조상\n' "$C" || { printf '  %-10s ❌ 미착지\n' "$C"; FAIL=$((FAIL+1)); }
done

c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

echo
echo "=== 신규 (0 → ≥1) ==="
for M in 'initialDayPanelDate' '등록하면 점검달력으로 돌아갑니다' 'returnHref'; do
  N=$(c "$M"); if [ "$N" -ge 1 ]; then printf '  ✅ %-34s 0 → %s\n' "$M" "$N"; else printf '  ❌ %-34s 0 → %s\n' "$M" "$N"; FAIL=$((FAIL+1)); fi
done
echo
echo "=== 역방향 (2 → 0) ==="
for M in 'calendar-new-customer-modal' 'daypanel-workbook-resume' 'calendar-created-banner' 'created-started' 'created-planned'; do
  N=$(c "$M"); if [ "$N" = "0" ]; then printf '  ✅ %-34s 2 → 0\n' "$M"; else printf '  ❌ %-34s 2 → %s (남았다)\n' "$M" "$N"; FAIL=$((FAIL+1)); fi
done
echo
echo "=== 존속 (≥) ==="
keep(){ N=$(c "$1"); if [ "$N" -ge "$2" ]; then printf '  ✅ %-34s %s ≥ %s\n' "$1" "$N" "$2"; else printf '  ❌ %-34s %s < %s\n' "$1" "$N" "$2"; FAIL=$((FAIL+1)); fi; }
keep 'daypanel-new-customer' 2; keep 'calendar-new-customer' 2; keep 'calendar-cell-new-customer' 2
keep 'daypanel-workbook' 2; keep 'daypanel-fireplan' 2; keep 'doc-notice-list' 2; keep 'doc-notice-chip' 2
keep 'workbook-xlsx' 14; keep '채우면 다음 발행에 반영됩니다' 2; keep 'anchor-date-modal' 2
keep 'daypanel-closed' 2
echo
echo "=== 폼 사본 (3 → 2 — 달력이 폼을 더 이상 싣지 않는다) ==="
# 🚨 첫 실행은 이 축을 존속(≥3)으로 걸어 VERIFY_FAIL=1이었다 — **내 분류가 틀렸다**.
#   before 3파일 = SSR 1 + static 2. static 둘 중 `1dimtihz3r3mj`는 **달력 경로의
#   react-loadable-manifest**(모달의 dynamic import 사본), `1m00spws-7s_y`는 /customers/new 것이었다
#   (롤백 이미지 `erp-app:rollback-ac9cbed`에서 매니페스트로 대조). after는 /customers/new 사본만 남는다.
#   폼 전용 문자열 셋(`new-anchor-provisional`·`대표 이름 *`·`anchor-future-note`)이 **똑같이** 3→2 —
#   달력 번들에서 폼이 빠졌다는 증거이지 폼이 사라진 게 아니다(SSR 사본이 1로 남는다).
for M in 'new-anchor-provisional' 'anchor-future-note'; do
  N=$(c "$M"); if [ "$N" = "2" ]; then printf '  ✅ %-34s 3 → 2
' "$M"; else printf '  ❌ %-34s 3 → %s
' "$M" "$N"; FAIL=$((FAIL+1)); fi
done
L=$(docker exec erp-app-1 sh -c "grep -rlF 'new-anchor-provisional' /app/.next/static 2>/dev/null | head -1 | xargs -r basename | sed 's/\.js\$//'")
R=$(docker exec erp-app-1 sh -c "grep -rlF '$L' '/app/.next/server/app/(dashboard)/inspections/calendar' 2>/dev/null | wc -l")
[ -n "$L" ] && [ "$R" = "0" ] && echo "  ✅ 남은 폼 청크($L)를 달력 경로가 참조하지 않는다" || { echo "  ❌ 달력 경로가 폼 청크($L)를 참조한다: $R"; FAIL=$((FAIL+1)); }
echo
echo "=== 음성 ==="
NEG=$(c 'zzzNoSuchMarker98'); [ "$NEG" = "0" ] && echo "  ✅ zzzNoSuchMarker98 = 0" || { echo "  ❌ 음성 $NEG"; FAIL=$((FAIL+1)); }
echo
echo "=== 자산 ==="
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16')
[ "$SHA" = "5dc767d1a9101aa9" ] && echo "  ✅ xlsx sha 불변 $SHA" || { echo "  ❌ xlsx sha $SHA"; FAIL=$((FAIL+1)); }
echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers/new https://sjfire.co.kr/inspections/calendar; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$u"); echo "  $u -> $CODE"
  case "$u" in *login) [ "$CODE" = "200" ] || { echo "  VERIFY_FAIL_LOGIN"; FAIL=$((FAIL+1)); };; esac
done
echo
echo "=== 런타임 오류 (최근 10분) ==="
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true)
echo "  오류 줄 수 = $ERRS"
docker logs erp-app-1 --since 10m 2>&1 | grep -iE '\berror\b|unhandled' | head -5
echo
echo "VERIFY_FAIL=$FAIL"
