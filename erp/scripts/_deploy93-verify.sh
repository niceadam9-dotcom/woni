#!/usr/bin/env bash
# 93회차 배포 **검증** — 마커 3분법 + 서빙 실측.
# 판정 기준은 `_deploy93-up.sh` 머리말의 before 값이다(배포 **전** 같은 방법으로 실측해 박아 둔 것).
#
# 🚨 도메인은 **sjfire.co.kr**이다. 85·86회차 스크립트가 쓰던 `erp.sjfire.co.kr`은 DNS에 없어
#   줄곧 `curl 실패`만 찍었다 — 즉 서빙 확인이 실은 안 되고 있었다(87회차에서 Caddyfile 실측으로 교정).
# 🚨 `127.0.0.1:3000`은 **000이 정상**이다(앱은 호스트에 공개돼 있지 않고 caddy 뒤에 있다).
#   앱 생사는 컨테이너 **안에서** 묻는다.
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)   (기대 e99941f)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)   (기대: 0f4b3b908603 아님)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "health      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"

echo
echo "=== MARKER AFTER ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
FAIL=0
ok() { echo "  OK   $1"; }
no() { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

V=$(c 'calendar-step-input')
[ "$V" -gt 0 ] && ok "신규 calendar-step-input = $V  (before 0)" || no "신규 calendar-step-input = $V  (before 0 · 늘어야)"
V=$(c '"insp"')
[ "$V" -ge 5 ] && ok "확대 insp = $V  (before 5 · 줄면 안 된다)" || no "확대 insp = $V  (before 5)"
V=$(c '설비 확인 → 점검표')
[ "$V" = "4" ] && ok "존속 설비확인-점검표 = $V  (before 4)" || no "존속 설비확인-점검표 = $V  (before 4)"
V=$(c '배치확인서를 올리거나')
[ "$V" = "4" ] && ok "존속 배치확인서 = $V  (before 4)" || no "존속 배치확인서 = $V  (before 4)"
V=$(c 'data-detail-panel')
[ "$V" = "2" ] && ok "존속 data-detail-panel = $V  (before 2 · 87회차 축)" || no "존속 data-detail-panel = $V  (before 2)"
V=$(c '표지 제목 크기 조정 불발')
[ "$V" = "1" ] && ok "존속 표지고지 = $V  (before 1)" || no "존속 표지고지 = $V  (before 1)"
V=$(c 'sheet-entry-back')
[ "$V" -ge 2 ] && ok "존속 sheet-entry-back = $V  (before 2)" || no "존속 sheet-entry-back = $V  (before 2)"
V=$(c 'zzzNoSuchMarker93')
[ "$V" = "0" ] && ok "음성 가드 = 0  (grep 거짓양성 없음)" || no "음성 가드 = $V  (0이어야)"

echo
echo "=== 자산 — 이번 구간엔 템플릿 변경이 **없다**(그대로여야 한다) ==="
SHA=$(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")
if [ "$SHA" = "5dc767d1a9101aa9" ]; then ok "templates xlsx sha = $SHA (불변 — 기대대로)"
else no "templates xlsx sha = $SHA (기대 5dc767d1a9101aa9 — 이 회차엔 바뀌면 안 된다)"; fi

echo
echo "=== 서빙 실측 ==="
docker exec erp-app-1 sh -c "wget -qO- -T 15 http://127.0.0.1:3000/login >/dev/null 2>&1 && echo '  OK   컨테이너 내부 /login 응답' || echo '  FAIL 컨테이너 내부 /login 실패'"
for u in https://sjfire.co.kr/ https://sjfire.co.kr/login https://sjfire.co.kr/inspections/calendar; do
  curl -s -o /dev/null -w "  $u -> %{http_code} (%{time_total}s)\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
ASSET=$(curl -s -m 25 https://sjfire.co.kr/login | grep -oE '/_next/static/[^"]+\.(css|js)' | head -1)
echo "  asset = ${ASSET:-(못 찾음)}"
[ -n "$ASSET" ] && curl -s -o /dev/null -w "  asset -> %{http_code}\n" -m 25 "https://sjfire.co.kr$ASSET"

echo
echo "=== 기동 후 오류 ==="
docker logs erp-app-1 --since 10m 2>&1 | grep -iE 'error|unhandled|FATAL|ECONN' | grep -viE 'favicon|deprecat' | tail -8 || true
echo "  (위가 비어 있으면 오류 없음)"

echo
echo "=== 롤백 태그 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -3

echo
if [ "$FAIL" = "0" ]; then echo "=== VERIFY OK — 마커 전건 통과 ==="; else echo "=== VERIFY FAIL $FAIL건 ==="; fi
exit "$FAIL"
