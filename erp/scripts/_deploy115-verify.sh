#!/usr/bin/env bash
# 115회차 확증 — 4c5c7f08 → 2849c402 · B5 점검능력평가 실적 묶음(35ea2562) · 마이그 0 · 사용자 승인 2026-10-02
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "✅ $1 = $2"; else echo "❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
ok HEAD "$(git rev-parse --short HEAD)" 2849c40
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 50ed7f922870)"
[ "$IMG" = "50ed7f922870" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
for C in 35ea2562 152ccb02; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
ok "app health" "$(docker inspect -f '{{.State.Health.Status}}' erp-app-1)" healthy
ok "gotenberg health" "$(docker inspect -f '{{.State.Health.Status}}' gotenberg-prod)" healthy
ok "app mem_limit" "$(docker inspect -f '{{.HostConfig.Memory}}' erp-app-1)" 1610612736
ok "gotenberg mem_limit" "$(docker inspect -f '{{.HostConfig.Memory}}' gotenberg-prod)" 2147483648
ok "app 재시작 횟수" "$(docker inspect -f '{{.RestartCount}}' erp-app-1)" 0
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in capability-eval-export capability-eval-year; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in mu-quarters:4 customer-bills-panel:2 share-sign-canvas:2 form14-multi-use:4 "replaceState(null:28" hometax-bulk:4; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker115)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
ok "xlsx sha" "$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16')" 5dc767d1a9101aa9
ok "caddy image" "$(docker inspect -f '{{.Config.Image}}' erp-caddy-1)" sjfire-caddy:2.11.4-ratelimit
ok "외부 /login" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/login)" 200
ok "외부 /api/health" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/api/health)" 200
ok "외부 대장 무인증(로그인으로)" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/customers/ledger)" 307
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
