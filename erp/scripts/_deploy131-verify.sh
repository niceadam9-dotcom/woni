#!/usr/bin/env bash
# 131회차 확증 — 5ed52d50 → fe114ebc (마이그 180 선적용 · img 748e5d71c065 → ?)
# before 실측: 신규 2문구 0 · 존속 「이 점검을 수정할 권한이 없습니다」 1
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in fe114ebc*) echo "✅ HEAD fe114ebc";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
git merge-base --is-ancestor c8dc786d HEAD 2>/dev/null && { echo "❌ 타 세션 c8dc786d가 실렸다(범위 밖)"; FAIL=$((FAIL+1)); } || echo "✅ c8dc786d(www·Caddy) 미포함"
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 748e5d71c065)"; [ "$IMG" = "748e5d71c065" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in fe114ebc a777445d 5ed52d50; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
for M in '이 점검에 불량을 등록할 권한이 없습니다' '등록 키가 올바르지 않습니다'; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
for M in '이 점검을 수정할 권한이 없습니다:1' '점검 월 값을 확인해주세요:1' '활성 건물이 없어 대장에 반영할 수 없습니다:1' record-card-link:2 tag-building-card:1 tag-point-card:1 somin-hwpx:2 seal-preview:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker131)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
for R in sheet-save defect-add; do docker exec erp-app-1 test -d /app/.next/server/app/api/mobile/$R && echo "✅ $R 라우트 번들 존재" || { echo "❌ $R 라우트 없음"; FAIL=$((FAIL+1)); }; done
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ 소방계획서 xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
SHA2=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/report-workbook-full.xlsx | cut -c1-16'); [ "$SHA2" = "feaa5190be21efc4" ] && echo "✅ 갑지 xlsx sha 불변" || { echo "❌ 갑지 xlsx $SHA2"; FAIL=$((FAIL+1)); }
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 이미지 불변" || { echo "❌ caddy $CI"; FAIL=$((FAIL+1)); }
# 새 라우트 인증 관문 — proxy가 /api/mobile/을 통과시키므로 라우트가 직접 막아야 한다
for R in sheet-save defect-add; do
  A=$(docker exec erp-app-1 sh -c "wget -q -S -O /dev/null --post-data={} http://127.0.0.1:3000/api/mobile/$R 2>&1 | head -1")
  case "$A" in *401*) echo "✅ $R 무인증 401";; *) echo "❌ $R 무인증 $A"; FAIL=$((FAIL+1));; esac
  B=$(docker exec erp-app-1 sh -c "wget -q -S -O /dev/null --header='Authorization: Bearer forged.token' --post-data={} http://127.0.0.1:3000/api/mobile/$R 2>&1 | head -1")
  case "$B" in *401*) echo "✅ $R 위조 토큰 401";; *) echo "❌ $R 위조 $B"; FAIL=$((FAIL+1));; esac
done
TC=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/customers 2>&1' | grep -i "^ *location:" | head -1); echo "내부 무인증 /customers: $TC"
case "$TC" in *login*) echo "✅ 다른 경로 리다이렉트 불변";; *) echo "❌ /customers $TC"; FAIL=$((FAIL+1));; esac
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
for i in $(seq 1 9); do HS=$(docker inspect -f '{{.State.Health.Status}}' erp-app-1 gotenberg-prod | tr "
" " "); case "$HS" in "healthy healthy ") break;; esac; sleep 10; done
[ "$HS" = "healthy healthy " ] && echo "✅ app·gotenberg healthy" || { echo "❌ health [$HS]"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
