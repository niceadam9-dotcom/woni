#!/usr/bin/env bash
# 127회차 확증 — f183ab37 → df1fdc75 (마이그 177 선적용 · img 4a02b7ab6d43 → ? · 126 흡수)
# 마커 before: 신규 equipment-plate-open·pump-plate-note·equipment-pump-plate 0 기대(126 이미지에서 재실측) ·
#   존속은 125 값 이상 · xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in df1fdc75*) echo "✅ HEAD df1fdc75";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 4a02b7ab6d43)"; [ "$IMG" = "4a02b7ab6d43" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in df1fdc75 f183ab37; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in equipment-plate-open pump-plate-note equipment-pump-plate; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in tag-register-form:2 equipment-tag-issue:2 tag-card:2 equipment-ledger:4 gas-storage-save:2 mu-checks:4; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker127)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
P404=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1 | head -1'); echo "내부 /p/무효: $P404"
case "$P404" in *404*) echo "✅ /p 무효 토큰 404";; *) echo "❌ /p 무효 토큰"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
# standalone 빌드는 qrcode를 node_modules가 아니라 서버 청크에 묶는다(1차 실행에서 ls 검사가 오판) — 인코더 고유 문자열로 잰다
QRM=$(docker exec erp-app-1 sh -c 'grep -rlF errorCorrectionLevel /app/.next/server 2>/dev/null | wc -l'); [ "$QRM" -ge 1 ] && echo "✅ qrcode 인코더 서버 번들 안 존재(3단계분 존속)($QRM)" || { echo "❌ qrcode 인코더 없음"; FAIL=$((FAIL+1)); }
L401=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/t/ZZZZZZZZ 2>&1 | grep -iE "HTTP/|^ *location" | head -3 | tr "
" " "'); echo "내부 /t 비로그인: $L401"
case "$L401" in *login*) echo "✅ /t 는 로그인으로";; *) echo "❌ /t 공개 의심"; FAIL=$((FAIL+1));; esac
echo "VERIFY_FAIL=$FAIL"
