#!/usr/bin/env bash
# 106회차 확증 — 1e7a60ab → 82695720 (마이그 0 · img ce9358a78cd8 → ?)
# 마커 before(2026-10-01 운영 실측): history-progress 0 · 「미완료·문서 판정이 보수적으로 기웁니다」 0 ·
#   「진행 단계를 불러오지 못했습니다」 0 · buildings!inner(customer_id) 1 · form13-station-select 2 · report-gaps-strip- 4 ·
#   tab-gap- 4 · cal-toolbar 2 · cal-range-loading 2 · xlsx 5dc767d1a9101aa9
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 82695720*) echo "✅ HEAD 82695720";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 ce9358a78cd8)"; [ "$IMG" = "ce9358a78cd8" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1) started=$(docker inspect --format '{{.State.StartedAt}}' erp-app-1)"
for C in 99390d52 82695720; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 105회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 신규(0→N) — 이력 표 진행 셀 testid(클라이언트) · 목록 조각화 로그 리터럴(서버) · 진행바 실패 안내(클라이언트)
# ⚠ 첫 실행은 「미완료·문서 판정이 보수적으로 기웁니다」로 재서 0(빨강)이 났다 — 번들에는 있다. minify가 **템플릿
#   리터럴 안의** `·`(U+00B7)를 `\xb7`로 이스케이프해 적어(일반 문자열 리터럴의 `·`는 그대로) 바이트 매칭이 깨진 것.
#   한글 음절은 살지만 라틴-1 구간 문자(·)는 템플릿 리터럴에서 이스케이프될 수 있다 → 마커에서 뺀다.
for M in history-progress "보수적으로 기웁니다" "진행 단계를 불러오지 못했습니다"; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 증가(1→≥2) — 소방시설 조인 필터가 facility-form-data에도 생겼다(종전 customers/actions 1곳)
n=$(c "buildings!inner(customer_id)"); [ "$n" -ge 2 ] && echo "✅ 증가 buildings!inner(customer_id) 1→$n" || { echo "❌ 증가 buildings!inner $n"; FAIL=$((FAIL+1)); }
# 존속 — 줄지 않았는가(고객 상세 축 + 105회차 달력 축)
for M in form13-station-select:2 report-gaps-strip-:4 tab-gap-:4 cal-toolbar:2 cal-range-loading:2; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker106)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
# 앱 생사는 컨테이너 안에서(앱은 caddy 뒤라 host 127.0.0.1:3000은 000이 정상) · 외부는 내 PC에서 따로 잰다
IN=$(docker exec erp-app-1 sh -c 'wget -q -S -O /dev/null http://127.0.0.1:3000/login 2>&1 | head -1'); echo "내부 /login: $IN"; case "$IN" in *200*) ;; *) echo "❌ 내부 /login"; FAIL=$((FAIL+1));; esac
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
