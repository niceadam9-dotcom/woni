#!/usr/bin/env bash
# 149회차 확증 — 16fffc8e → 7788cdd8 (마이그 0 · img 2c8fcfc0adba → ?)
# before 실측: fire-plan-hwpx 0 · templates = fire-plan-workbook.xlsx·report-workbook-full.xlsx·report9-placeholder.hwpx
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 7788cdd8*) echo "✅ HEAD 7788cdd8";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
git merge-base --is-ancestor 0679927b HEAD 2>/dev/null && { echo "❌ 타 세션 0679927b가 실렸다(범위 밖)"; FAIL=$((FAIL+1)); } || echo "✅ 0679927b 미포함"
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 2c8fcfc0adba)"; [ "$IMG" = "2c8fcfc0adba" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
for C in 7788cdd8 16fffc8e; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
n=$(c fire-plan-hwpx); [ "$n" -ge 1 ] && echo "✅ 신규 fire-plan-hwpx 0→$n" || { echo "❌ 신규 fire-plan-hwpx $n"; FAIL=$((FAIL+1)); }
for M in fire-plan-xlsx:1 delegationDateSerial:1 record-card-link:2 seal-preview:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker149)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
# 서식 파일이 컨테이너에 실렸나(next.config tracing) — 없으면 라우트가 ENOENT 500
docker exec erp-app-1 test -f /app/templates/fire-plan-form.hwpx && echo "✅ templates/fire-plan-form.hwpx 실림($(docker exec erp-app-1 sh -c 'wc -c < /app/templates/fire-plan-form.hwpx')B)" || { echo "❌ 서식 파일 없음"; FAIL=$((FAIL+1)); }
for F in fire-plan-workbook.xlsx report-workbook-full.xlsx report9-placeholder.hwpx; do docker exec erp-app-1 test -f /app/templates/$F && echo "✅ 존속 $F" || { echo "❌ $F 없음"; FAIL=$((FAIL+1)); }; done
# 무인증 관문 — 세션 없으면 /login으로(proxy) 또는 401
A=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers/00000000-0000-0000-0000-000000000000/fire-plan/hwpx 2>&1' | grep -iE "^ *(HTTP/|location:)" | tr '\n' ' ')
echo "무인증 hwpx: $A"; case "$A" in *login*|*401*) echo "✅ 무인증 차단";; *) echo "❌ 무인증 $A"; FAIL=$((FAIL+1));; esac
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
