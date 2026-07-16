#!/bin/bash
# 운영 컨테이너 env·Gotenberg 헬스 검증 (2026-07-16)
echo "-- app 컨테이너 env (2면 정상):"
sudo docker exec erp-app-1 env | grep -c -e ACCOUNT_ENC_KEY -e GOTENBERG_URL
echo "-- app→gotenberg-prod 헬스:"
sudo docker exec erp-app-1 node -e 'fetch(process.env.GOTENBERG_URL+"/health").then(r=>r.text()).then(t=>console.log(t.slice(0,140))).catch(e=>{console.error("FAIL",e.message);process.exit(1)})'
echo "-- 사이트:"
curl -s -o /dev/null -w "prod /login: %{http_code}\n" https://sjfire.co.kr/login
echo "-- 컨테이너 상태:"
sudo docker ps --format "{{.Names}} {{.Status}}" | grep -E "erp|gotenberg"
