#!/usr/bin/env bash
# 151회차 확증 — 3b131929 → 5bef8844 (마이그 0 · img e642aa8d02bb → ?)
# 새 코드(분류 결과 정규화)는 번들 고유 문자열이 없어 마커 대신 라우트 관문·이미지 교체로 본다(로직은 로컬 test-classify-defects-normalize 8/0)
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 5bef8844*) echo "✅ HEAD 5bef8844";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 e642aa8d02bb)"; [ "$IMG" = "e642aa8d02bb" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
for C in 5bef8844 2839dbb7 3b131929; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
docker exec erp-app-1 test -f /app/.next/server/app/api/mobile/classify-defects/route.js && echo "✅ 분류 라우트 번들 존재" || { echo "❌ 분류 라우트 없음"; FAIL=$((FAIL+1)); }
A=$(docker exec erp-app-1 sh -c "wget -q -S -O /dev/null --post-data='{\"transcript\":\"x\"}' http://127.0.0.1:3000/api/mobile/classify-defects 2>&1 | head -1")
case "$A" in *401*) echo "✅ 분류 무인증 401";; *) echo "❌ 분류 무인증 $A"; FAIL=$((FAIL+1));; esac
B=$(docker exec erp-app-1 sh -c "wget -q -S -O /dev/null --header='Authorization: Bearer forged.token' --post-data='{\"transcript\":\"x\"}' http://127.0.0.1:3000/api/mobile/classify-defects 2>&1 | head -1")
case "$B" in *401*) echo "✅ 분류 위조 토큰 401";; *) echo "❌ 분류 위조 $B"; FAIL=$((FAIL+1));; esac
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in fpimg:1 fire-plan-hwpx:1 '사유 완료 철회:1' delegationDateSerial:1 record-card-link:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker151)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
