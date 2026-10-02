#!/usr/bin/env bash
# 110회차 확증 — 493f9777 → 624e016c (마이그 0 · img는 109회차 통지값 → ?)
# 마커 before(2026-10-02 운영 실측): repair-sales-page·quote-preview·send-submit·open-repair-page·delivery-list 0 ·
#   존속 repair-sales-chain 2·unquoted-strip 2·replaceState(null 28·form13-station-select 2·history-progress 2 · xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 624e016c*) echo "✅ HEAD 624e016c";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 109회차 이미지)"; [ "$IMG" = "9eee0f21be91" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 624e016c; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 전 회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 신규(0→N) — 보수 견적 페이지 testid
for M in repair-sales-page quote-preview send-submit open-repair-page delivery-list; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 존속 — 줄지 않았는가 (108회차 축 + 공통 축)
for M in repair-sales-chain:2 unquoted-strip:2 "replaceState(null:28" form13-station-select:2 history-progress:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker109)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
# Caddy는 이번 회차 불변이어야 한다
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변 $CI" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
[ "$(docker inspect --format '{{.State.Status}}' erp-caddy-1)" = "running" ] && echo "✅ caddy running" || { echo "❌ caddy not running"; FAIL=$((FAIL+1)); }
# 앱 생사는 컨테이너 안에서 · 외부는 내 PC에서 따로 잰다
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
