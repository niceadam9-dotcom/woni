#!/usr/bin/env bash
# 129회차 확증 — 1f29a61f → d546fb16 (마이그 179 선적용 · img 24c711ba8dfd → ?)
# before 실측: record-card-link·tag-building-card·「소방시설등 자체점검기록표」 0 · 존속 5축
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in d546fb16*) echo "✅ HEAD d546fb16";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 24c711ba8dfd)"; [ "$IMG" = "24c711ba8dfd" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in d546fb16 1f29a61f; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in record-card-link tag-building-card '소방시설등 자체점검기록표'; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in tag-point-card:1 point-panel:4 tag-register-form:2 somin-hwpx:2 seal-preview:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker129)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ 소방계획서 xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
SHA2=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/report-workbook-full.xlsx | cut -c1-16'); [ "$SHA2" = "feaa5190be21efc4" ] && echo "✅ 갑지 xlsx sha 불변" || { echo "❌ 갑지 xlsx $SHA2"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
# ⚠ grep 'location'은 Permissions-Policy의 geo**location**에 걸린다(1차 실행 거짓 빨강 2건) — 'location:'으로 머리를 고정
TN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/t/ZZZZZZZZ 2>&1' | grep -iE "^ *(HTTP/|location:)" | head -2 | tr '
' ' '); echo "내부 무인증 /t/{code}: $TN"
case "$TN" in *307*login*next*) echo "✅ /t 비로그인 → /login?next=(복귀 배선)";; *) echo "❌ /t next $TN"; FAIL=$((FAIL+1));; esac
TC=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers 2>&1' | grep -i "^ *location:" | head -1); echo "내부 무인증 /customers: $TC"
case "$TC" in *next*) echo "❌ /customers에 next가 붙음(범위 넓어짐)"; FAIL=$((FAIL+1));; *login*) echo "✅ 다른 경로 리다이렉트 불변";; *) echo "❌ /customers $TC"; FAIL=$((FAIL+1));; esac
MA=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null --post-data={} http://127.0.0.1:3000/api/mobile/classify-defects 2>&1 | head -1'); echo "내부 무인증 /api/mobile: $MA"
case "$MA" in *401*) echo "✅ /api/mobile 무인증 401(종전 307 /login)";; *) echo "❌ /api/mobile $MA"; FAIL=$((FAIL+1));; esac
MB=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null --header="Authorization: Bearer forged.token" --post-data={} http://127.0.0.1:3000/api/mobile/classify-defects 2>&1 | head -1'); echo "내부 위조 토큰 /api/mobile: $MB"
case "$MB" in *401*) echo "✅ /api/mobile 위조 토큰 401";; *) echo "❌ /api/mobile 위조 $MB"; FAIL=$((FAIL+1));; esac
MX=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/api/mobilex 2>&1 | head -1'); echo "내부 /api/mobilex: $MX"
case "$MX" in *307*) echo "✅ /api/mobilex 는 여전히 로그인으로";; *) echo "❌ /api/mobilex $MX"; FAIL=$((FAIL+1));; esac
P404=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1 | head -1'); echo "내부 /p/무효: $P404"
case "$P404" in *404*) echo "✅ /p 무효 토큰 404";; *) echo "❌ /p 무효 토큰"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
