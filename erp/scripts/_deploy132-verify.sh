#!/usr/bin/env bash
# www 사이트 회차 검증 — 서버에서 실행. 외부 경로(공인 DNS)로 찌른다(내부 curl은 Caddy를 안 거칠 수 있다).
set -u
FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }

echo "=== www 사이트 ==="
chk "www / 상태" "$(code https://www.sjfire.co.kr/)" 200
chk "www software.html" "$(code https://www.sjfire.co.kr/software.html)" 200
chk "www privacy.html" "$(code https://www.sjfire.co.kr/privacy.html)" 200
chk "www assets/site.css" "$(code https://www.sjfire.co.kr/assets/site.css)" 200
chk "www 없는 경로" "$(code https://www.sjfire.co.kr/nope-404)" 404
chk "www 본문 마커(점검에서 끝나지 않는)" "$(curl -s --max-time 20 https://www.sjfire.co.kr/ | grep -c '점검에서 끝나지 않는')" 1
chk "www 301 소멸(Location 헤더 0)" "$(curl -sI --max-time 20 https://www.sjfire.co.kr/ | grep -ci '^location:')" 0
chk "www HSTS" "$(curl -sI --max-time 20 https://www.sjfire.co.kr/ | grep -ci '^strict-transport-security:')" 1

echo "=== 앱(무변경이어야 함) ==="
chk "sjfire.co.kr/login" "$(code https://sjfire.co.kr/login)" 200
chk "sjfire.co.kr/api/health" "$(code https://sjfire.co.kr/api/health)" 200
chk "staging noindex 유지" "$(curl -sI --max-time 20 https://staging.sjfire.co.kr/login | grep -ci '^x-robots-tag:')" 1
chk "caddy 로그 오류(5분)" "$(docker compose -f /home/ubuntu/woni/erp/docker-compose.prod.yml logs caddy --since 5m 2>&1 | grep -c '\"level\":\"error\"')" 0

echo "VERIFY_FAIL=$FAIL"
