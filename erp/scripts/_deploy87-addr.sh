#!/usr/bin/env bash
# 87회차 — **공개 주소가 무엇인가**를 서버 설정에 직접 묻는다.
# `erp.sjfire.co.kr`이 DNS에 없다(내 PC·서버 양쪽에서 해석 실패). 이전 회차 스크립트의
# 주소가 낡았을 수 있으므로 caddy가 실제로 무엇을 섬기는지 본다.
set -u
cd /home/ubuntu/woni/erp 2>/dev/null || true

echo "=== caddy 컨테이너 ==="
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i caddy || echo "  (caddy 없음)"

echo
echo "=== Caddyfile (도메인 선언) ==="
for f in ./Caddyfile ./caddy/Caddyfile /etc/caddy/Caddyfile; do
  [ -f "$f" ] && { echo "--- $f ---"; grep -vE '^\s*#' "$f" | grep -vE '^\s*$' | head -30; }
done
docker exec erp-caddy-1 sh -c 'cat /etc/caddy/Caddyfile 2>/dev/null' 2>/dev/null | grep -vE '^\s*#' | grep -vE '^\s*$' | head -30

echo
echo "=== compose의 포트 공개 ==="
grep -nA3 'ports:' docker-compose.prod.yml 2>/dev/null | head -20

echo
echo "=== 서버의 공인 IP ==="
curl -s -m 10 https://api.ipify.org 2>/dev/null || echo "  (조회 실패 — 외부 나감 막힘일 수 있다)"
echo

echo "=== 로컬 루프백으로 caddy 직접 ==="
for p in 80 443; do
  curl -s -o /dev/null -w "  127.0.0.1:$p -> %{http_code}\n" -m 12 -k "http://127.0.0.1:$p/login" 2>/dev/null || echo "  127.0.0.1:$p 실패"
done
curl -s -o /dev/null -w "  https://127.0.0.1/login (-k) -> %{http_code}\n" -m 12 -k https://127.0.0.1/login 2>/dev/null || echo "  https 루프백 실패"
echo "=== ADDR DONE ==="
