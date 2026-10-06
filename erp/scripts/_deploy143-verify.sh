#!/usr/bin/env bash
# 143회차 확증 — 2fe0581e → 3ab5bd82 (마이그 0 · img 7b2b9d1e2855 → ?)
# before 실측: photo-album-hwpx 0 · photoalbum-generate 0 · 「공사 완료 사진첩」 0 · 「불량사진 삽입: localSheetId」 1
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 3ab5bd82*) echo "✅ HEAD 3ab5bd82";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 7b2b9d1e2855)"; [ "$IMG" = "7b2b9d1e2855" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 3ab5bd82 2fe0581e; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
n=$(c '불량사진 삽입: localSheetId'); [ "$n" = "0" ] && echo "✅ 폐지 「불량사진 삽입: localSheetId」 →0" || { echo "❌ 폐지 문구 잔존 $n"; FAIL=$((FAIL+1)); }
for k in photo-album-hwpx photoalbum-generate '공사 완료 사진첩'; do n=$(c "$k"); [ "$n" -ge 1 ] && echo "✅ 신규 「$k」 0→$n" || { echo "❌ 신규 「$k」 $n"; FAIL=$((FAIL+1)); }; done
# 사진첩 한글파일 라우트가 템플릿을 딸려 왔는가(next.config tracing) — 없으면 받기가 500이다
T=$(docker exec erp-app-1 sh -c 'ls /app/templates/report9-placeholder.hwpx 2>/dev/null | wc -l'); [ "$T" = "1" ] && echo "✅ HWPX 템플릿 실재" || { echo "❌ HWPX 템플릿 없음"; FAIL=$((FAIL+1)); }
AN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/inspections/00000000-0000-0000-0000-000000000000/photo-album-hwpx 2>&1 | head -1'); echo "무인증 사진첩 HWPX: $AN"; case "$AN" in *401*|*30[27]*) echo "✅ 무인증 차단";; *) echo "❌ 무인증 $AN"; FAIL=$((FAIL+1));; esac
for M in doc-notice-toast:1 somin-hwpx-error:1 somin-hwpx:2 workbook-xlsx:1 record-card-link:2 seal-preview:2 tag-building-card:1; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker143)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
TC=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers/new 2>&1' | grep -i "^ *location:" | head -1); echo "내부 무인증 /customers/new: $TC"
case "$TC" in *login*) echo "✅ 무인증 리다이렉트";; *) echo "❌ /customers/new $TC"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
EX=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://sjfire.co.kr/login); [ "$EX" = "200" ] && echo "✅ 외부 sjfire.co.kr/login 200" || { echo "❌ 외부 /login $EX"; FAIL=$((FAIL+1)); }
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
