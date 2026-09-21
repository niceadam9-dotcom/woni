#!/usr/bin/env bash
# 87회차 — **서빙 실측**. 마커는 「이미지에 코드가 들었나」만 말한다. 사람이 실제로 여는 주소가
# 뜨는지는 따로 물어야 한다. 앱은 host:3000에 공개돼 있지 않고 caddy 뒤에 있으므로
# 127.0.0.1:3000은 000이 나온다(그게 정상) — 이전 회차와 같이 **공개 도메인**으로 잰다.
set -u
# 🚨 도메인은 **sjfire.co.kr**이다. 85·86회차 스크립트가 쓰던 `erp.sjfire.co.kr`은 DNS에 없어
#    (내 PC·서버 양쪽에서 해석 실패) 줄곧 `curl 실패`만 찍고 있었다 — 즉 **서빙 확인이 실은
#    한 번도 안 되고 있었다**. Caddyfile 실측으로 바로잡았다(2026-09-21).
DOMAIN=${DOMAIN:-https://sjfire.co.kr}
echo "=== 공개 도메인 ($DOMAIN) ==="
for u in "$DOMAIN/" "$DOMAIN/login"; do
  curl -s -o /dev/null -w "  $u -> %{http_code} (%{time_total}s)\n" -m 25 "$u" || echo "  $u -> curl 실패"
done

echo
echo "=== 서빙 자산 (로그인 없는 축 — 운영 DB엔 E2E 계정이 없다) ==="
ASSET=$(curl -s -m 25 "$DOMAIN/login" | grep -oE '/_next/static/[^"]+\.(css|js)' | head -1)
echo "  asset = ${ASSET:-(못 찾음)}"
[ -n "$ASSET" ] && curl -s -o /dev/null -w "  asset -> %{http_code}\n" -m 25 "$DOMAIN$ASSET"

echo
echo "=== 컨테이너 내부에서 직접 (앱이 실제로 듣는가) ==="
docker exec erp-app-1 sh -c "wget -qO- -T 15 http://127.0.0.1:3000/login >/dev/null 2>&1 && echo '  내부 /login OK' || echo '  내부 /login 실패'"

echo
echo "=== 기동 후 오류 ==="
docker logs erp-app-1 --since 10m 2>&1 | grep -iE 'error|unhandled|FATAL|ECONN' | grep -viE 'favicon|deprecat' | tail -8 || true
echo "  (위가 비어 있으면 오류 없음)"
echo "=== SERVE CHECK DONE ==="
