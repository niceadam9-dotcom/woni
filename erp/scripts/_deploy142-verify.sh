#!/usr/bin/env bash
# 142회차 확증 — 9315f15d → 2fe0581e (마이그 0 · img e22e30a6be31 → ?)
# before 실측: planReportSerial 0 · delegationDateSerial 0
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 2fe0581e*) echo "✅ HEAD 2fe0581e";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 e22e30a6be31)"; [ "$IMG" = "e22e30a6be31" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 2fe0581e 0df4cf7e 9315f15d; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for k in planReportSerial delegationDateSerial; do n=$(c "$k"); [ "$n" -ge 1 ] && echo "✅ 신규 $k 0→$n" || { echo "❌ 신규 $k $n"; FAIL=$((FAIL+1)); }; done
n=$(c 'Set(["31-A-002"])'); [ "$n" -ge 1 ] && echo "✅ 존속 31-A-002 예외 $n" || { echo "❌ 존속 31-A-002 $n"; FAIL=$((FAIL+1)); }
for M in onboarding-next:2 new-submit-save:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker142)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
