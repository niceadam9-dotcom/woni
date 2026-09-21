#!/usr/bin/env bash
# 87회차 배포 **검증** — 마커 3분법으로 「정말 나갔는가」를 실행 중 이미지에 직접 묻는다.
# 판정 기준은 `_deploy87-up.sh` 머리말의 before 값이다(배포 **전** 같은 방법으로 실측해 박아 둔 것).
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)   (기대 c32da4b)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)   (기대: d3e099d697db 아님)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "health      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"

echo
echo "=== MARKER AFTER ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
FAIL=0
chk() { # 이름 실제 기대설명 판정결과
  if [ "$3" = "ok" ]; then echo "  ✅ $1 = $2  ($4)"; else echo "  ❌ $1 = $2  ($4)"; FAIL=$((FAIL+1)); fi
}
V=$(c 'data-detail-panel');              [ "$V" -gt 0 ] && chk 'data-detail-panel' "$V" ok 'before 0 → 늘어야' || chk 'data-detail-panel' "$V" no 'before 0 → 늘어야'
V=$(c '표지 제목 크기 조정 불발');        [ "$V" -gt 0 ] && chk '표지 제목 크기 조정 불발' "$V" ok 'before 0 → 늘어야' || chk '표지 제목 크기 조정 불발' "$V" no 'before 0 → 늘어야'
V=$(c 'aria-modal');                     [ "$V" -gt 4 ] && chk 'aria-modal(확대)' "$V" ok 'before 4 → 늘어야' || chk 'aria-modal(확대)' "$V" no 'before 4 → 늘어야'
V=$(c 'xlsx-notice-chip');               [ "$V" = "2" ] && chk 'xlsx-notice-chip(존속)' "$V" ok 'before 2 = 유지' || chk 'xlsx-notice-chip(존속)' "$V" no 'before 2 = 유지'
V=$(c 'reports-round-label');            [ "$V" = "1" ] && chk 'reports-round-label(존속)' "$V" ok 'before 1 = 유지' || chk 'reports-round-label(존속)' "$V" no 'before 1 = 유지'
V=$(c 'fire-plan-xlsx');                 [ "$V" -ge 10 ] && chk 'fire-plan-xlsx(존속)' "$V" ok 'before 10 = 유지 이상' || chk 'fire-plan-xlsx(존속)' "$V" no 'before 10 = 유지 이상'
V=$(c '저장하지 않은 변경이 있습니다');    [ "$V" -ge 22 ] && chk '확인창 문구(존속)' "$V" ok 'before 22 = 유지 이상' || chk '확인창 문구(존속)' "$V" no 'before 22 = 유지 이상'
V=$(c 'zzzNoSuchMarker87');              [ "$V" = "0" ] && chk '음성 가드' "$V" ok '0이어야 — grep 거짓양성 없음' || chk '음성 가드' "$V" no '0이어야'

echo
echo "=== 표지 템플릿 자산 (표지 개편의 주 마커) ==="
SHA=$(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")
if [ "$SHA" = "dd7ced2260f5a7fe" ]; then echo "  ✅ sha256 = $SHA  (890b5605 → dd7ced22 교체됨)"
else echo "  ❌ sha256 = $SHA  (기대 dd7ced2260f5a7fe · 배포 전 890b560579ef8215)"; FAIL=$((FAIL+1)); fi

echo
echo "=== 서빙 확인 (운영 DB엔 E2E 계정이 없어 로그인 없는 축만 — 메모리 규약) ==="
for u in / /login; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:3000$u")
  echo "  $u → $CODE"
done
CSS=$(curl -s -m 20 http://127.0.0.1:3000/login | grep -o '/_next/static/css/[^"]*\.css' | head -1)
echo "  serving css = ${CSS:-(없음)}"
[ -n "$CSS" ] && echo "  css 200? $(curl -s -o /dev/null -w '%{http_code}' -m 20 "http://127.0.0.1:3000$CSS")"

echo
echo "=== 컨테이너 최근 오류 ==="
docker logs erp-app-1 --since 6m 2>&1 | grep -iE 'error|unhandled|FATAL' | grep -v 'favicon' | tail -8 || echo "  (없음)"

echo
echo "=== 롤백 태그 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -3

echo
if [ "$FAIL" = "0" ]; then echo "=== VERIFY OK — 마커 전건 통과 ==="; else echo "=== VERIFY FAIL $FAIL건 ==="; fi
exit "$FAIL"
