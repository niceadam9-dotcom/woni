#!/usr/bin/env bash
# 105회차 확증 — bb56b4ee → 1e7a60ab (마이그 0 · img 7faafae23176 → ?)
# 마커 before(2026-10-01 운영 실측): cal-range-loading 0 · cal-range-error 0 · route-loading 0 · sms-unsent-count 0 · step-badge 0 ·
#   monitor/page.js 1 · inspection-ledger/page.js 1 · by-customer page.js 1 · cal-toolbar 2 · cal-nav 2 · workbench-stepbar 2 ·
#   daypanel-period 2 · cal-orphan-chip 2 · xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 1e7a60ab*) echo "✅ HEAD 1e7a60ab";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 7faafae23176)"; [ "$IMG" = "7faafae23176" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
for C in 3a0c7c4e 1e7a60ab; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 103회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# ⚠ 경로는 **작은따옴표 한 겹**으로 컨테이너 sh에 넘긴다 — 첫 실행에서 `\[customerId\]`를 이스케이프한 채 넘겨
#   ls가 못 찾아 「page.js 1→0」은 헛초록·「route.js 0→1」은 헛빨강이 났다(계측기 탓, 수동 ls로 route.js 실재 확인)
f(){ docker exec erp-app-1 sh -c "ls '$1' 2>/dev/null | wc -l"; }
# 신규(0→N) — 달력 보충 로딩/오류 표식(클라이언트) · loading.tsx 뼈대 testid · 두 캐시 키(서버 번들 문자열)
for M in cal-range-loading cal-range-error route-loading sms-unsent-count step-badge; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 역방향(1→0) — 리다이렉트 전용 page.js 세 개가 번들에서 사라지고, by-customer는 route.js로 바뀐다
for P in "/app/.next/server/app/(dashboard)/inspection-plans/monitor/page.js" "/app/.next/server/app/(dashboard)/inspection-ledger/page.js" "/app/.next/server/app/(dashboard)/inspections/by-customer/[customerId]/page.js"; do n=$(f "$P"); [ "$n" = "0" ] && echo "✅ 역방향 $(basename $(dirname "$P"))/page.js 1→0" || { echo "❌ 역방향 $P $n"; FAIL=$((FAIL+1)); }; done
n=$(f "/app/.next/server/app/(dashboard)/inspections/by-customer/[customerId]/route.js"); [ "$n" = "1" ] && echo "✅ 신규 by-customer route.js 0→1" || { echo "❌ by-customer route.js $n"; FAIL=$((FAIL+1)); }
# 역방향 통제 — 같은 함수가 **있는 파일**은 1로 센다(헛초록 방지: 이 줄이 0이면 위 역방향도 못 믿는다)
n=$(f "/app/.next/server/app/(dashboard)/inspections/calendar/page.js"); [ "$n" = "1" ] && echo "✅ 통제 calendar/page.js 1" || { echo "❌ 통제 calendar/page.js $n (ls 계측기 고장)"; FAIL=$((FAIL+1)); }
# 존속 — 줄지 않았는가
for M in cal-toolbar:2 cal-nav:2 workbench-stepbar:2 daypanel-period:2 cal-orphan-chip:2; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker105)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
# 옛 주소는 이제 proxy가 렌더 전에 307로 보낸다(종전 페이지 redirect와 같은 착지)
for P in /login /inspections /inspections/calendar /inspection-plans/monitor /inspection-ledger; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://sjfire.co.kr$P"); LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -m 30 "https://sjfire.co.kr$P"); echo "$P -> $CODE ${LOC:+→ $LOC}"
  case "$P:$CODE" in /login:200|/inspections*:307|/inspection-plans/monitor:307|/inspection-ledger:307) ;; *) echo "❌ 예상 밖 응답 $P $CODE"; FAIL=$((FAIL+1));; esac
done
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
