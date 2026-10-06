#!/usr/bin/env bash
# 139회차 확증 — 8e713b2c → ba8f35d4 (마이그 181 선적용 · img 7b76297bc9c7 → ?)
# before 실측: 「이 날짜로 잡히는 일정」4 · anchor-manual-toggle 2 · new-notes 2 · onboarding-done 0 · cal-new-customer 0 ·
#   new-submit-calendar 0 · new-annual 0 · 「주소로 건물정보를 찾는 중」0
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in ba8f35d4*) echo "✅ HEAD ba8f35d4";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 7b76297bc9c7)"; [ "$IMG" = "7b76297bc9c7" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 93af60d3 b1c669ff ba8f35d4 08a24033 8e713b2c; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 사라져야 할 것 — 칸·스위치·메모 폐지
for M in '이 날짜로 잡히는 일정' anchor-manual-toggle new-notes; do n=$(c "$M"); [ "$n" = "0" ] && echo "✅ 폐지 「$M」 → 0" || { echo "❌ 폐지 「$M」 $n(남음)"; FAIL=$((FAIL+1)); }; done
# 새로 생겨야 할 것
for M in onboarding-done cal-new-customer new-submit-calendar new-annual '주소로 건물정보를 찾는 중'; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 「$M」 0→$n" || { echo "❌ 신규 「$M」 $n"; FAIL=$((FAIL+1)); }; done
# 존속
for M in building-group:2 new-group-building:2 doc-notice-toast:1 record-card-link:2 seal-preview:2 tag-building-card:1; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker139)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
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
