#!/usr/bin/env bash
# 138회차 확증 — 9dd5cefe → 8e713b2c (마이그 0 · img 585868c6ef61 → ?)
# before 실측: 「건물·시설」15 · 「건물정보」2 · building-group 2 · new-group-building 2
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 8e713b2c*) echo "✅ HEAD 8e713b2c";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 585868c6ef61)"; [ "$IMG" = "585868c6ef61" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 8e713b2c 9dd5cefe; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
n=$(c '건물·시설'); [ "$n" -lt 15 ] && echo "✅ 옛 「건물·시설」 15→$n" || { echo "❌ 옛 「건물·시설」 $n(줄지 않음)"; FAIL=$((FAIL+1)); }
n=$(c '건물정보'); [ "$n" -gt 2 ] && echo "✅ 새 「건물정보」 2→$n" || { echo "❌ 새 「건물정보」 $n(늘지 않음)"; FAIL=$((FAIL+1)); }
for M in building-group:2 new-group-building:2 doc-notice-toast:1 new-anchor-manual:1 record-card-link:2 seal-preview:2 tag-building-card:1; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker138)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
TC=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers/new 2>&1' | grep -i "^ *location:" | head -1); echo "내부 무인증 /customers/new: $TC"
case "$TC" in *login*) echo "✅ 무인증 리다이렉트";; *) echo "❌ /customers/new $TC"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
