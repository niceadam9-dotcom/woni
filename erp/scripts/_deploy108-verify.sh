#!/usr/bin/env bash
# 108회차 확증 — c455a0e7 → 7c07db3c (마이그 166 운영 적용 완료 · img a750a6ac818a → ?)
# 마커 before(2026-10-02 운영 실측): 번들 repair-sales-chain 0·unquoted-strip 0·quote-create-open 0 · 존속 replaceState(null 28·
#   form13-station-select 2·report-gaps-strip- 4·tab-gap- 4·cal-toolbar 2·cal-range-loading 2·history-progress 2 · xlsx 5dc767d1a9101aa9
#   저장소: Caddyfile rate_limit 0 · compose sjfire-caddy 0·caddy:2.11.4-alpine 1 · deploy/backup 0파일 · upload-guard.ts 0 ·
#   config.toml enable_signup=false 0 · add-defect canTouchInspection 0 · 컨테이너 caddy 이미지 caddy:2.11.4-alpine · crontab 26줄(Sep 5, 미반영 유지)
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 7c07db3c*) echo "✅ HEAD 7c07db3c";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 a750a6ac818a)"; [ "$IMG" = "a750a6ac818a" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 586447ea 4d61f98f 7c07db3c; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 106·107회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 신규(0→N) — ⑤ 칸 사슬 블록 testid(클라이언트 청크)
for M in repair-sales-chain unquoted-strip quote-create-open; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 존속 — 줄지 않았는가
for M in "replaceState(null:28" form13-station-select:2 report-gaps-strip-:4 tab-gap-:4 cal-toolbar:2 cal-range-loading:2 history-progress:2; do k=${M%%:*}; v=${M##*:}; n=$(c "$k"); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker108)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
# ── A2(Caddy·보안)·A1(백업 파일) 저장소 마커 (integrate 세션 제공) ──
# ⚠ 첫 실행 VERIFY_FAIL=4는 이 함수 탓 — 0건이면 grep -c가 "0"을 찍고 exit 1이라 `|| echo 0`이 "0"을 한 번 더 붙여 두 줄짜리 "0 0"이 됐다(계측기). 파일이 없을 때만 0.
g(){ [ -f "$2" ] || { echo 0; return; }; grep -cF -- "$1" "$2"; return 0; }  # grep -c는 0건에도 "0"을 찍는다 — exit 1을 삼킨다
[ "$(g 'rate_limit {' erp/deploy/Caddyfile)" = "1" ] && echo "✅ Caddyfile rate_limit 0→1" || { echo "❌ Caddyfile rate_limit"; FAIL=$((FAIL+1)); }
[ "$(g 'zone login' erp/deploy/Caddyfile)" = "1" ] && [ "$(g 'zone api' erp/deploy/Caddyfile)" = "1" ] && echo "✅ Caddyfile zone login·api" || { echo "❌ Caddyfile zone"; FAIL=$((FAIL+1)); }
[ "$(g 'sjfire-caddy:2.11.4-ratelimit' erp/docker-compose.prod.yml)" = "1" ] && [ "$(g 'image: caddy:2.11.4-alpine' erp/docker-compose.prod.yml)" = "0" ] && echo "✅ compose caddy 이미지 교체" || { echo "❌ compose caddy"; FAIL=$((FAIL+1)); }
[ -f erp/deploy/caddy/Dockerfile ] && [ "$(g caddy-ratelimit erp/deploy/caddy/Dockerfile)" = "1" ] && echo "✅ deploy/caddy/Dockerfile" || { echo "❌ caddy Dockerfile"; FAIL=$((FAIL+1)); }
NB=$(ls erp/deploy/backup 2>/dev/null | wc -l); [ "$NB" = "4" ] && echo "✅ deploy/backup 0→4" || { echo "❌ deploy/backup $NB"; FAIL=$((FAIL+1)); }
[ -x erp/deploy/backup/backup-nightly.sh ] && echo "✅ backup-nightly.sh 실행 비트" || { echo "❌ backup-nightly.sh 모드"; FAIL=$((FAIL+1)); }
[ "$(g backup-nightly.sh erp/deploy/cron/sjfire-erp.cron)" -ge 1 ] && echo "✅ cron 파일 backup 줄(파일만)" || { echo "❌ cron 파일"; FAIL=$((FAIL+1)); }
[ -f erp/src/lib/upload-guard.ts ] && [ -f erp/supabase/functions/_shared/edge.ts ] && echo "✅ upload-guard.ts·_shared/edge.ts" || { echo "❌ upload-guard/edge"; FAIL=$((FAIL+1)); }
[ "$(g 'enable_signup = false' erp/supabase/config.toml)" = "2" ] && [ "$(g 'enable_signup = true' erp/supabase/config.toml)" = "0" ] && echo "✅ config.toml signup off" || { echo "❌ config.toml"; FAIL=$((FAIL+1)); }
[ "$(g canTouchInspection erp/supabase/functions/add-defect/index.ts)" -ge 1 ] && [ "$(g "'Access-Control-Allow-Origin': '*'" erp/supabase/functions/add-defect/index.ts)" = "0" ] && echo "✅ add-defect canTouchInspection" || { echo "❌ add-defect"; FAIL=$((FAIL+1)); }
[ "$(g test-upload-guard.mts erp/scripts/test-all.mts)" = "1" ] && echo "✅ test-all upload-guard" || { echo "❌ test-all"; FAIL=$((FAIL+1)); }
# 서버 crontab은 이번 회차 미반영이어야 한다(A1 준비물 미설치)
CL=$(sudo grep -vc '^#' /etc/cron.d/sjfire-erp 2>/dev/null); CB=$(sudo grep -c backup-nightly /etc/cron.d/sjfire-erp 2>/dev/null)
[ "$CL" = "26" ] && [ "$CB" = "0" ] && echo "✅ 서버 crontab 미반영(26줄·backup 0)" || { echo "❌ crontab $CL/$CB"; FAIL=$((FAIL+1)); }
# ── Caddy 런타임 ──
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1); [ "$CI" = "sjfire-caddy:2.11.4-ratelimit" ] && echo "✅ caddy 컨테이너 이미지 $CI" || { echo "❌ caddy 이미지 $CI"; FAIL=$((FAIL+1)); }
[ "$(docker inspect --format '{{.State.Status}}' erp-caddy-1)" = "running" ] && echo "✅ caddy running" || { echo "❌ caddy not running"; FAIL=$((FAIL+1)); }
UNR=$(cd erp && docker compose -f docker-compose.prod.yml logs caddy --since 30m 2>&1 | grep -c unrecognized); [ "$UNR" = "0" ] && echo "✅ caddy unrecognized 0" || { echo "❌ caddy unrecognized $UNR"; FAIL=$((FAIL+1)); }
# 앱 생사는 컨테이너 안에서(앱은 caddy 뒤) · 외부는 내 PC에서 따로 잰다
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
# 레이트리밋 실동작 — 서버 자신의 IP로 /login 31회(30/분 한도) 중 429가 나오는가. 맨 끝에 둔다(앞 검사에 영향 금지).
C429=0; for i in $(seq 1 31); do code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://sjfire.co.kr/login); [ "$code" = "429" ] && C429=$((C429+1)); done
[ "$C429" -ge 1 ] && echo "✅ 레이트리밋 429 ${C429}회/31" || { echo "❌ 레이트리밋 429 없음(31회 전부 통과)"; FAIL=$((FAIL+1)); }
echo "VERIFY_FAIL=$FAIL"
