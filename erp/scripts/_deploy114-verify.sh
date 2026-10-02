#!/usr/bin/env bash
# 114회차 검증 — A5 compose(메모리 상한·헬스체크·스테이징 네트워크 분리). 실패 건수를 VERIFY_FAIL로 남긴다.
set -u
cd /home/ubuntu/woni/erp || exit 9
F=0
ok() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; F=$((F+1)); fi; }

echo "=== 저장소 마커 ==="
ok "HEAD" "$(git -C /home/ubuntu/woni rev-parse --short HEAD)" "4c5c7f0"
ok "prod compose mem_limit 수" "$(grep -c '^    mem_limit:' docker-compose.prod.yml)" "3"
ok "prod compose healthcheck 수" "$(grep -c '^    healthcheck:' docker-compose.prod.yml)" "2"
ok "prod compose erp_staging_edge" "$(grep -c 'name: erp_staging_edge' docker-compose.prod.yml)" "1"
ok "staging compose prod_net(제거)" "$(grep -c 'prod_net' docker-compose.staging.yml)" "0"
ok "staging compose erp_staging_edge" "$(grep -c 'name: erp_staging_edge' docker-compose.staging.yml)" "1"

echo "=== 런타임 ==="
ok "erp_staging_edge 네트워크" "$(docker network ls --format '{{.Name}}' | grep -cx erp_staging_edge)" "1"
ok "caddy 네트워크" "$(docker inspect erp-caddy-1 -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | xargs -n1 | sort | xargs)" "erp_default erp_staging_edge"
ok "app health" "$(docker inspect -f '{{.State.Health.Status}}' erp-app-1)" "healthy"
ok "gotenberg health" "$(docker inspect -f '{{.State.Health.Status}}' gotenberg-prod)" "healthy"
ok "app mem_limit" "$(docker inspect -f '{{.HostConfig.Memory}}' erp-app-1)" "1610612736"
ok "gotenberg mem_limit" "$(docker inspect -f '{{.HostConfig.Memory}}' gotenberg-prod)" "2147483648"
ok "caddy mem_limit" "$(docker inspect -f '{{.HostConfig.Memory}}' erp-caddy-1)" "268435456"
ok "caddy image" "$(docker inspect -f '{{.Config.Image}}' erp-caddy-1)" "sjfire-caddy:2.11.4-ratelimit"
ok "app image(재빌드 없음)" "$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19)" "50ed7f922870"
ok "app 재시작 횟수" "$(docker inspect -f '{{.RestartCount}}' erp-app-1)" "0"
ok "caddy unrecognized" "$(docker logs erp-caddy-1 --since 10m 2>&1 | grep -c unrecognized)" "0"
ok "외부 /login" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/login)" "200"
ok "외부 /api/health" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/api/health)" "200"
ok "무인증 크론" "$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://sjfire.co.kr/api/cron/sync-holidays)" "401"
ok "app 로그 오류(5분)" "$(docker logs erp-app-1 --since 5m 2>&1 | grep -ciE 'error|unhandled' )" "0"
echo "VERIFY_FAIL=$F"
