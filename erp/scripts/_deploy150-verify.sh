#!/usr/bin/env bash
# 150회차 확증 — 7788cdd8 → 3b131929 (마이그 0 · img 2862878297ad → ?)
# before 실측: fpimg 0 · 폐지 「예외 상황에서만 사유를 남기고」 2 · 존속 「사유 완료 철회」 2 (마커는 erp-a8 제공)
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 3b131929*) echo "✅ HEAD 3b131929";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 2862878297ad)"; [ "$IMG" = "2862878297ad" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
for C in 3b131929 0679927b 7788cdd8; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
n=$(c fpimg); [ "$n" -ge 1 ] && echo "✅ 신규 fpimg(한글 사진) 0→$n" || { echo "❌ 신규 fpimg $n"; FAIL=$((FAIL+1)); }
n=$(c '예외 상황에서만 사유를 남기고'); [ "$n" = "0" ] && echo "✅ 폐지 「예외 상황에서만 사유를 남기고」 2→0" || { echo "❌ 폐지 문구 잔존 $n"; FAIL=$((FAIL+1)); }
for M in '사유 완료 철회:1' fire-plan-hwpx:1 fire-plan-xlsx:1 delegationDateSerial:1 record-card-link:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker150)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
docker exec erp-app-1 test -f /app/templates/fire-plan-form.hwpx && echo "✅ 한글 서식 존속" || { echo "❌ 한글 서식 없음"; FAIL=$((FAIL+1)); }
A=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers/00000000-0000-0000-0000-000000000000/fire-plan/hwpx 2>&1' | grep -iE "^ *(HTTP/|location:)" | tr '\n' ' ')
case "$A" in *login*|*401*) echo "✅ 무인증 차단";; *) echo "❌ 무인증 $A"; FAIL=$((FAIL+1));; esac
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
