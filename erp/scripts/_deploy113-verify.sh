#!/usr/bin/env bash
# 113회차 확증 — fad207e1 → 0ca796a4 (마이그 171 운영 적용 완료 · img 81888046a0eb → ?) · B3(4f9b609b) 동반 — 사용자 승인 2026-10-02
# 마커 before(2026-10-02 운영 실측): 3단계 customer-bills-panel·billing-link-create·share-round-list·share-billing-table·share-sign-canvas 0 ·
#   B3(erp-7a 제공) mu-quarters·mu-facilities·mu-checks 0 · 존속 form14-multi-use 4·share-links-section 2·share-page 1·repair-sales-page 5·
#   replaceState(null 28·form13-station-select 2 · xlsx 5dc767d1a9101aa9(B3는 템플릿 미수정)
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 0ca796a4*) echo "✅ HEAD 0ca796a4";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 81888046a0eb)"; [ "$IMG" = "81888046a0eb" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 4f9b609b 0ca796a4; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ 첫 실행 VERIFY_FAIL=1은 이 줄의 계측기 결함 — 112 템플릿을 치환하며 성공 분기에 `FAIL+1` 꼬리가 남았다.
if git merge-base --is-ancestor 435101bd HEAD; then echo "❌ A5(435101bd)가 실렸다 — 범위 밖이어야 한다"; FAIL=$((FAIL+1)); else echo "✅ A5 미포함"; fi
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in customer-bills-panel billing-link-create share-round-list share-billing-table share-sign-canvas mu-quarters mu-facilities mu-checks; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in form14-multi-use:4 share-links-section:2 share-page:1 repair-sales-page:5 "replaceState(null:28" form13-station-select:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker113)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
# 공개 경로 동작 — 컨테이너 안(caddy 우회)에서: 무효 토큰 404 · 사내 경로는 여전히 307 /login
P404=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2>&1 | head -1'); echo "내부 /p/무효: $P404"
case "$P404" in *404*) echo "✅ /p 무효 토큰 404";; *) echo "❌ /p 무효 토큰"; FAIL=$((FAIL+1));; esac
PAY=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/payroll 2>&1 | grep -iE "HTTP/|location" | head -3 | tr "\n" " "'); echo "내부 /payroll: $PAY"
case "$PAY" in *login*) echo "✅ /payroll 은 로그인으로(접두사 '/p/' 확인)";; *) echo "❌ /payroll 공개 의심"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
