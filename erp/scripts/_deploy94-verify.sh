#!/usr/bin/env bash
# 94회차 배포 **검증** — 마커 3분법 + 서빙 실측.
# 판정 기준은 `_deploy94-up.sh` 머리말의 before 값이다(배포 **전** 같은 방법으로 실측해 박은 것).
#
# 🚨 도메인은 **sjfire.co.kr**이다(`erp.` 아님).
# 🚨 `127.0.0.1:3000`은 **000이 정상**이다 — 앱은 호스트에 공개돼 있지 않고 caddy 뒤에 있다.
#   앱 생사는 컨테이너 **안에서** 묻는다.
# 🚨 내 커밋의 알맹이(미리보기 대표 칸)는 **번들 문자열 마커가 없다** — 새 문자열 없이 순서만
#   바꿨다. 그 축은 여기서 ①조상 관계 ②이미지 교체로만 보고, **동작 축은 별도 프로브**가 잰다
#   (`_probe-plan-text-preview.mts`를 운영 자격증명으로 — 배포 전 14건 중 2건 불일치 → 0이어야).
set -u
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)   (기대 37820ac)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)   (기대: e7f7ff7e5aef 아님)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "health      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"

FAIL=0
ok() { echo "  OK   $1"; }
no() { echo "  FAIL $1"; FAIL=$((FAIL+1)); }

echo
echo "=== 내 커밋이 정말 서버에 실렸는가(조상 관계 — 이름 아닌 실체로) ==="
git -C /home/ubuntu/woni merge-base --is-ancestor 37820ac7 HEAD \
  && ok "37820ac7가 서버 HEAD의 조상" || no "37820ac7가 서버 HEAD에 없다"
git -C /home/ubuntu/woni merge-base --is-ancestor 6d63efdc HEAD \
  && ok "6d63efdc(타 세션)도 함께 나갔다" || no "6d63efdc가 서버 HEAD에 없다"

echo
echo "=== 배포된 소스가 정말 수리본인가(서버 체크아웃 실물) ==="
# 🚨 `grep -c`는 **0건일 때 exit 1**이다. `|| echo 0`을 붙이면 grep이 이미 찍은 "0" 뒤에
#   "0"이 한 번 더 붙어 V="0\n0"이 되고, 값이 옳은데도 비교가 빗나간다(첫 실행에서 실제로
#   거짓 빨강을 냈다 — 빨강이면 계측기부터 의심한다). grep -c는 언제나 숫자를 찍으므로 그냥 받는다.
SRC=/home/ubuntu/woni/erp/src/lib/plan-text-sections.ts
V=$(grep -c 'firstDeclared' "$SRC" 2>/dev/null); V=${V:-0}
[ "$V" -ge 3 ] && ok "plan-text-sections.ts에 firstDeclared = $V (수리본)" || no "firstDeclared = $V (기대 ≥3)"
V=$(grep -c 'Object.values(dict(b))' "$SRC" 2>/dev/null); V=${V:-0}
[ "$V" = "0" ] && ok "역방향: 구계약 Object.values(dict(b)) = 0" || no "구계약이 아직 남아 있다 = $V"

echo
echo "=== MARKER AFTER (실행 중 이미지 실물) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

V=$(c '이 회차에 해당하는 기타 시설')
[ "$V" -gt 0 ] && ok "신규 회차귀속 기타 = $V  (before 0 · 구간 도달)" || no "신규 회차귀속 기타 = $V  (before 0 · 늘어야)"
V=$(c '피난·방화시설·방염과 위험물')
[ "$V" -ge 4 ] && ok "확대 피난·방화시설 = $V  (before 4 · 줄면 안 된다)" || no "확대 피난·방화시설 = $V  (before 4)"
V=$(c '공사·정비 내용')
[ "$V" = "12" ] && ok "존속 공사·정비 내용 = $V  (before 12 · 내 모듈이 번들에 있다)" || no "존속 공사·정비 내용 = $V  (before 12)"
V=$(c '피난 방법 (유형 공통)')
[ "$V" = "5" ] && ok "존속 피난 방법(유형 공통) = $V  (before 5)" || no "존속 피난 방법(유형 공통) = $V  (before 5)"
V=$(c 'calendar-step-input')
[ "$V" = "2" ] && ok "존속 calendar-step-input = $V  (before 2 · 93회차 축)" || no "존속 calendar-step-input = $V  (before 2)"
V=$(c 'data-detail-panel')
[ "$V" = "2" ] && ok "존속 data-detail-panel = $V  (before 2 · 87회차 축)" || no "존속 data-detail-panel = $V  (before 2)"
V=$(c 'sheet-entry-back')
[ "$V" -ge 2 ] && ok "존속 sheet-entry-back = $V  (before 2)" || no "존속 sheet-entry-back = $V  (before 2)"
V=$(c '설비 확인 → 점검표')
[ "$V" = "4" ] && ok "존속 설비확인-점검표 = $V  (before 4)" || no "존속 설비확인-점검표 = $V  (before 4)"
V=$(c 'zzzNoSuchMarker94')
[ "$V" = "0" ] && ok "음성 가드 = 0  (grep 거짓양성 없음)" || no "음성 가드 = $V  (0이어야)"

echo
echo "=== 자산 — 이번 구간엔 템플릿 변경이 **없다**(그대로여야 한다) ==="
SHA=$(docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16")
if [ "$SHA" = "5dc767d1a9101aa9" ]; then ok "templates xlsx sha = $SHA (불변 — 기대대로)"
else no "templates xlsx sha = $SHA (기대 5dc767d1a9101aa9 — 이 회차엔 바뀌면 안 된다)"; fi

echo
echo "=== 서빙 실측 ==="
docker exec erp-app-1 sh -c "wget -qO- -T 15 http://127.0.0.1:3000/login >/dev/null 2>&1 && echo '  OK   컨테이너 내부 /login 응답' || echo '  FAIL 컨테이너 내부 /login 실패'"
for u in https://sjfire.co.kr/ https://sjfire.co.kr/login https://sjfire.co.kr/fire-plans/library; do
  curl -s -o /dev/null -w "  $u -> %{http_code} (%{time_total}s)\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
ASSET=$(curl -s -m 25 https://sjfire.co.kr/login | grep -oE '/_next/static/[^"]+\.(css|js)' | head -1)
echo "  asset = ${ASSET:-(못 찾음)}"
[ -n "$ASSET" ] && curl -s -o /dev/null -w "  asset -> %{http_code}\n" -m 25 "https://sjfire.co.kr$ASSET"

echo
echo "=== 기동 후 오류 ==="
docker logs erp-app-1 --since 10m 2>&1 | grep -iE 'error|unhandled|FATAL|ECONN' | grep -viE 'favicon|deprecat' | tail -8 || true
echo "  (위가 비어 있으면 오류 없음)"

echo
echo "=== 롤백 태그 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -F 'erp-app:rollback-' | head -3

echo
if [ "$FAIL" = "0" ]; then echo "=== VERIFY OK — 마커 전건 통과 ==="; else echo "=== VERIFY FAIL $FAIL건 ==="; fi
exit "$FAIL"
