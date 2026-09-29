#!/usr/bin/env bash
# 103회차 확증 — af1cccce → a64bd0ef (마이그 0 · img 81efcb4247ae → ?)
# 마커 before(2026-09-29 운영 실측): cal-sms-panel 0 · day-sms-card 0 · lead-rule-off 0 · history-status-all 0 ·
#   (history-visit-lock 0 — 복귀점 이미지 rollback-af1cccc 실물에서 잼) · sms-filter-toggle 2 · sms-approve-range 2 · calendar-sms-toolbar 2 · sms-result-link 3 · cal-nav 2 · data-recent-strip 6
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in a64bd0ef*) echo "✅ HEAD a64bd0ef";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 81efcb4247ae)"; [ "$IMG" = "81efcb4247ae" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
for C in a9e9a674 a5f7a670 a43be665 a64bd0ef; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
# ⚠ BusyBox grep은 --include를 모른다(조용히 0) — 102회차와 같은 형태로 센다
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | grep -v '\.map$' | wc -l"; }
# 신규(0→N) — 달력 문자 패널 · 이 날 문자 카드 · 사용 안 함 체크박스 · 발송 이력 화면
# ⚠ 처음 고른 `history-status-all`은 0이었다 — 소스가 `history-status-${s}`로 **조립**해 번들에 그 글자가 없다(계측기 탓).
#   리터럴로 적힌 testid(history-visit-lock)로 바꿨다. 마커는 소스에 글자 그대로 있는 것만 쓴다.
for M in cal-sms-panel day-sms-card lead-rule-off history-visit-lock; do n=$(c "$M"); [ "$n" -ge 1 ] && echo "✅ 신규 $M 0→$n" || { echo "❌ 신규 $M $n"; FAIL=$((FAIL+1)); }; done
# 역방향(2→0) — 옛 문자 발송 화면(sms-status-client)이 번들에서 빠졌는가
for M in sms-filter-toggle sms-approve-range; do n=$(c "$M"); [ "$n" = "0" ] && echo "✅ 역방향 $M 2→0" || { echo "❌ 역방향 $M $n"; FAIL=$((FAIL+1)); }; done
# 존속 — 줄지 않았는가
for M in calendar-sms-toolbar:2 sms-result-link:3 cal-nav:2 data-recent-strip:6 cal-toolbar-secondary:2; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker103)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
for P in /login /inspections/sms /inspections/calendar; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "https://sjfire.co.kr$P"); echo "$P -> $CODE"
  case "$P:$CODE" in /login:200|/inspections/*:307) ;; *) echo "❌ 예상 밖 응답 $P $CODE"; FAIL=$((FAIL+1));; esac
done
# 운영 발송 가드 상태(값은 찍지 않는다 — 켜짐/꺼짐만)
docker exec erp-app-1 sh -c 'for k in SMS_DRY_RUN SMS_ALLOWLIST SOLAPI_API_KEY; do eval v=\$$k; [ -n "$v" ] && echo "env $k=set" || echo "env $k=unset"; done'
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
