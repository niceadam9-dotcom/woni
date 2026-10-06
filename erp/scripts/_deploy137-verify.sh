#!/usr/bin/env bash
# 137회차 확증 — 0cee1a95 → 9dd5cefe (마이그 0 · img 4da159873b30 → ?)
# before 실측: 「문서 고지: 」12 · 「한글파일 고지: 」2 · somin-hwpx-notice 2 · 「대표 이름 *」2 · 「관계인 이름 *」0
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 9dd5cefe*) echo "✅ HEAD 9dd5cefe";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 4da159873b30)"; [ "$IMG" = "4da159873b30" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in a72b655b 9dd5cefe 0cee1a95; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for k in '문서 고지: ' '한글파일 고지: ' 'somin-hwpx-notice' '대표 이름 *'; do n=$(c "$k"); [ "$n" = "0" ] && echo "✅ 폐지 「$k」 →0" || { echo "❌ 폐지 「$k」 잔존 $n"; FAIL=$((FAIL+1)); }; done
n=$(c '관계인 이름 *'); [ "$n" -ge 1 ] && echo "✅ 신규 「관계인 이름 *」 0→$n" || { echo "❌ 신규 「관계인 이름 *」 $n"; FAIL=$((FAIL+1)); }
for M in doc-notice-toast:1 somin-hwpx-error:1 new-anchor-manual:1 anchor-manual-toggle:1 record-card-link:2 seal-preview:2 tag-building-card:1; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker137)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
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
