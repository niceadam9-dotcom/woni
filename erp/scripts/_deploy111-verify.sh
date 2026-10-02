#!/usr/bin/env bash
# 111회차 확증 — 624e016c → 6d1c6787 (마이그 163·168·169 운영 기존 · img e8e1d702e506 → ?)
# 마커 before(2026-10-02 운영 실측): 신규 hometax-bulk-panel 0·hometax-export 0·buyer-bizno 0·company-tax-fields 0 ·
#   존속 placement-card 2·repair-sales-chain 7·replaceState(null 28 · xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 6d1c6787*) echo "✅ HEAD 6d1c6787";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 e8e1d702e506)"; [ "$IMG" = "e8e1d702e506" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 4b7d2b84 906bca8c 6d1c6787; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in hometax-bulk-panel hometax-export buyer-bizno company-tax-fields; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in "placement-card:2" "repair-sales-chain:7" "replaceState(null:28"; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker111)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy 이미지 $CI"; FAIL=$((FAIL+1)); }
[ "$(docker inspect --format '{{.State.Status}}' erp-caddy-1)" = "running" ] && echo "✅ caddy running" || { echo "❌ caddy not running"; FAIL=$((FAIL+1)); }
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
# A3 /api/health — 동반 실림 확인(200=DB·Gotenberg 정상, 503이면 사유를 찍는다)
HL=$(docker exec erp-app-1 sh -c 'wget -q -O - http://127.0.0.1:3000/api/health 2>&1 | head -c 200'); echo "내부 /api/health: $HL"
case "$HL" in *'"ok":true'*|*'"ok": true'*) echo "✅ health ok";; *) echo "⚠ health 확인 필요(비차단)";; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
