#!/usr/bin/env bash
# 107회차 확증 — 82695720 → c455a0e7 (마이그 0 · img 8ed8320751bf → ?)
# 마커 before(2026-10-02 운영 실측): replaceState(window.history.state 25(server 12·static 13) · replaceState(null 8 ·
#   form13-station-select 2 · report-gaps-strip- 4 · tab-gap- 4 · cal-toolbar 2 · cal-range-loading 2 · history-progress 2 ·
#   xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in c455a0e7*) echo "✅ HEAD c455a0e7";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 8ed8320751bf)"; [ "$IMG" = "8ed8320751bf" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 97aad892 c455a0e7; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 106회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 역방향(25→라이브러리만) — 소스에 window.history.state를 넘기는 호출이 0이 됐다(달력 4·점검표 입력 1·fields 1 + 고객 탭은 106회차).
#   ⚠ Supabase auth-js(_exchangeCodeForSession, PKCE ?code= 제거)가 같은 호출을 쓴다 — 로컬 빌드 보정에서 1파일. 그 청크는 제외하고 0이어야 한다.
n=$(c 'replaceState(window.history.state'); echo "replaceState(window.history.state 전체=$n (before 25)"
n2=$(docker exec erp-app-1 sh -c "grep -rlF 'replaceState(window.history.state' /app/.next 2>/dev/null | grep -v '\.map$' | xargs -r grep -LF _exchangeCodeForSession | wc -l")
[ "$n2" = "0" ] && echo "✅ 역방향 replaceState(window.history.state 우리 코드 0(라이브러리 제외, 전체 $n)" || { echo "❌ 역방향 우리 코드 잔존 $n2"; FAIL=$((FAIL+1)); }
# 증가(8→>8) — null 호출이 달력·점검표·fields 번들에 생겼다
n=$(c 'replaceState(null'); [ "$n" -gt 8 ] && echo "✅ 증가 replaceState(null 8→$n" || { echo "❌ 증가 replaceState(null $n"; FAIL=$((FAIL+1)); }
# 존속 — 줄지 않았는가(고객 상세 축 + 105·106회차 달력·이력 축)
for M in form13-station-select:2 report-gaps-strip-:4 tab-gap-:4 cal-toolbar:2 cal-range-loading:2 history-progress:2; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker107)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
# 앱 생사는 컨테이너 안에서(앱은 caddy 뒤라 host 127.0.0.1:3000은 000이 정상) · 외부는 내 PC에서 따로 잰다
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
