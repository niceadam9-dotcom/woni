#!/usr/bin/env bash
# 122회차 확증 — a2c25596 → 1b16e6b1 (마이그 175 선적용 · img 36a11c54d3c7 → ?)
# 신규: info-somin-registered(클라이언트)·「소민터 등록값으로 인쇄」(hwpx 라우트) before 0 · 존속: 119 축 + 「세부 현황 중」
# 존속: 116 verify 축 + 무인증 /inspections/<id>/hwpx 는 로그인으로(공개 아님)
set -u
PREV_IMG=${1:-36a11c54d3c7}
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 1b16e6b1*) echo "✅ HEAD 1b16e6b1";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 $PREV_IMG)"; [ "$IMG" = "$PREV_IMG" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in info-somin-registered "소민터 등록값으로 인쇄"; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in capability-eval-export:2 customer-bills-panel:2 share-sign-canvas:2 mu-checks:4 share-links-section:2 "replaceState(null:28" form13-station-select:2 owner-report-quote-line:2 equipment-ledger:4 gas-storage-save:2 data-ledger-hint:4 somin-hwpx:2 X-Hwpx-Notice:3 "세부 현황 중:1"; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker122)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
T=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/report9-placeholder.hwpx 2>/dev/null | cut -c1-16'); [ "$T" = "e4c7873fd16f290b" ] && echo "✅ hwpx 템플릿 실림(sha 일치)" || { echo "❌ hwpx 템플릿 [$T]"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
HW=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/inspections/00000000-0000-0000-0000-000000000000/hwpx 2>&1 | grep -iE "HTTP/|location" | head -3 | tr "\n" " "'); echo "내부 무인증 /hwpx: $HW"
case "$HW" in *401*|*login*) echo "✅ /hwpx 무인증 차단";; *) echo "❌ /hwpx 무인증 응답 이상"; FAIL=$((FAIL+1));; esac
P404=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1 | head -1'); case "$P404" in *404*) echo "✅ /p 무효 토큰 404";; *) echo "❌ /p 무효 토큰 [$P404]"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); case "$IN" in *200*) echo "✅ 내부 /login 200";; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
