#!/usr/bin/env bash
# 102회차 확증 — 978e6225 → af1cccce (마이그 0 · img f8e68a104621 → ?)
# 마커 before(2026-09-29 운영 실측): 「소방 점검 계약 고객을 관리합니다」1 · 「md:inline-flex xl:hidden」0 ·
#   「hidden 2xl:inline-flex」0 · 「text-form-xs font-medium transition-colors」10 · data-recent-strip 6
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in af1cccce*) echo "✅ HEAD af1cccce";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 f8e68a104621)"; [ "$IMG" = "f8e68a104621" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
for C in 36d5abaa 6ed878b2 af1cccce; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 역방향 — 고객 목록 설명 문장(1→0)
n=$(c '소방 점검 계약 고객을 관리합니다'); [ "$n" = "0" ] && echo "✅ 역방향 설명문장 1→0" || { echo "❌ 역방향 설명문장 $n"; FAIL=$((FAIL+1)); }
# 신규 — compact 스트립 폭 구간 클래스(0→N)
for M in 'md:inline-flex xl:hidden' 'hidden 2xl:inline-flex'; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 「$M」 0→$n" || { echo "❌ 신규 「$M」 $n"; FAIL=$((FAIL+1)); }; done
# 역방향 — 사이드바 메뉴 text-form-xs(10→줄어듦; 소스 3곳 중 사이드바만 뺐으므로 0이 아니다)
n=$(c 'text-form-xs font-medium transition-colors'); [ "$n" -lt 10 ] && [ "$n" -gt 0 ] && echo "✅ 역방향 사이드바 text-form-xs 10→$n" || { echo "❌ 사이드바 text-form-xs $n"; FAIL=$((FAIL+1)); }
# 존속
for M in data-recent-strip:6 cal-nav:2 cal-toolbar-secondary:2 report-gaps-next:4 info-save-bar:2 data-save-bar:6; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker102)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 https://sjfire.co.kr/login); echo "login -> $CODE"; [ "$CODE" = "200" ] || FAIL=$((FAIL+1))
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
