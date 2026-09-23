#!/usr/bin/env bash
# 101회차 확증 — 70de37d2 → 978e6225 (마이그 0 · img 7e0a61e3ec5d → ?)
# 새 문자열이 없어 개수 마커 불가 → 같은 청크 안 오프셋 맞교대(before 고객<업무<달력 → after 달력<고객<업무)
set -u
cd /home/ubuntu/woni || exit 9
FAIL=0
H=$(git rev-parse HEAD); case "$H" in 978e6225*) echo "✅ HEAD 978e6225";; *) echo "❌ HEAD $H"; FAIL=$((FAIL+1));; esac
IMG=$(docker inspect --format '{{.Image}}' erp-app-1 | cut -c8-19); echo "img=$IMG (직전 7e0a61e3ec5d)"; [ "$IMG" = "7e0a61e3ec5d" ] && { echo "❌ IMG_UNCHANGED"; FAIL=$((FAIL+1)); }
echo "status=$(docker inspect --format '{{.State.Status}}' erp-app-1)"
for C in 7f1084b0 978e6225; do git merge-base --is-ancestor $C HEAD && echo "✅ 조상 $C" || { echo "❌ 미착지 $C"; FAIL=$((FAIL+1)); }; done
OUT=$(docker exec erp-app-1 node -e '
const fs=require("fs"),path=require("path");const hits=[]
function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(p.endsWith(".js")){const t=fs.readFileSync(p,"utf8");
 const a=t.indexOf("label:\"고객 관리\""),b=t.indexOf("label:\"점검 업무\""),c=t.indexOf("label:\"점검 달력\"");
 if(a>=0&&b>=0&&c>=0)hits.push([["고객",a],["업무",b],["달력",c]].sort((x,y)=>x[1]-y[1]).map(x=>x[0]).join("<"))}}}
walk("/app/.next");console.log(hits.join(" | "))')
echo "메뉴 순서 청크: $OUT"
N_NEW=$(echo "$OUT" | tr '|' '\n' | grep -c '달력<고객<업무' || true); N_OLD=$(echo "$OUT" | tr '|' '\n' | grep -c '고객<업무<달력' || true)
[ "$N_NEW" -ge 2 ] && [ "$N_OLD" = "0" ] && echo "✅ 오프셋 맞교대 — 새 순서 ${N_NEW}청크 · 옛 순서 0" || { echo "❌ 새 순서 $N_NEW · 옛 순서 $N_OLD"; FAIL=$((FAIL+1)); }
c(){ docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
for M in cal-nav:2 cal-toolbar-secondary:2 report-gaps-next:4 info-save-bar:2 data-save-bar:6; do k=${M%%:*}; v=${M##*:}; n=$(c $k); [ "$n" -ge "$v" ] && echo "✅ 존속 $k $n≥$v" || { echo "❌ 존속 $k $n<$v"; FAIL=$((FAIL+1)); }; done
[ "$(c zzzNoSuchMarker101)" = "0" ] && echo "✅ 음성 0" || { echo "❌ 음성"; FAIL=$((FAIL+1)); }
SHA=$(docker exec erp-app-1 sh -c 'sha256sum /app/templates/fire-plan-workbook.xlsx | cut -c1-16'); [ "$SHA" = "5dc767d1a9101aa9" ] && echo "✅ xlsx sha 불변" || { echo "❌ xlsx $SHA"; FAIL=$((FAIL+1)); }
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 30 https://sjfire.co.kr/login); echo "login -> $CODE"; [ "$CODE" = "200" ] || FAIL=$((FAIL+1))
ERRS=$(docker logs erp-app-1 --since 10m 2>&1 | grep -icE '\berror\b|unhandled|ECONNREFUSED' || true); echo "런타임 오류(10분)=$ERRS"
echo "VERIFY_FAIL=$FAIL"
