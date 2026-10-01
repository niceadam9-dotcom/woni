#!/usr/bin/env bash
# 104회차 확증 — a64bd0ef → bb56b4ee (마이그 0 · img 6c8c21fff9fe → ?)
# 마커 before(2026-10-01 운영 실측): step-goal 0 · step-done-toast 0 · step-done-next 0 · owner-report-ways 0 · submit9-ready 0 ·
#   submit11-ready 0 · goal-unregistered-x 0 · data-done 0 · accent-[#5b46d9] 2 · workbench-stepbar 2 · cert-reported-toggle 2 ·
#   submit9-record 2 · submit11-record 2 · annex-doc-chips 2 · goto-defect-register 2
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in bb56b4ee*) echo "✅ HEAD bb56b4ee";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 6c8c21fff9fe)"; [ "$IMG" = "6c8c21fff9fe" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
for C in 9b616a7b bb56b4ee; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 103회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 신규(0→N) — 완료 조건 띠·완료 토스트·[다음 단계]·③ A/B 상자·④⑥ 준비/전제 줄·① 미등록 ✕·칩 data-done (전부 소스에 글자 그대로 있는 testid/속성)
for M in step-goal step-done-toast step-done-next owner-report-ways submit9-ready submit11-ready goal-unregistered-x data-done; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 역방향(2→0) — 옛 ② 체크박스 클래스(accent-[#5b46d9])가 번들에서 빠졌는가(src 0곳)
for M in 'accent-[#5b46d9]'; do n=$(c "$M"); [ "$n" = "0" ] && echo "✅ 역방향 $M 2→0" || { echo "❌ 역방향 $M $n"; FAIL=$((FAIL+1)); }; done
# 존속 — 줄지 않았는가
for M in workbench-stepbar:2 cert-reported-toggle:2 submit9-record:2 submit11-record:2 annex-doc-chips:2 goto-defect-register:2; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker104)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
for P in /login /inspections /inspections/calendar; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://sjfire.co.kr$P"); echo "$P -> $CODE"
  case "$P:$CODE" in /login:200|/inspections*:307) ;; *) echo "❌ 예상 밖 응답 $P $CODE"; FAIL=$((FAIL+1));; esac
done
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
