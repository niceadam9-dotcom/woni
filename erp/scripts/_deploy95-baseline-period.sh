#!/usr/bin/env bash
# 95회차 배포 **착수 실측**(읽기 전용) — 회차·구간·in-flight·마커 before를 서버에 직접 묻는다.
#
# 🚨 회차는 **이미지 교체 수**로 센다(태그 목록). 기록 커밋 `e8e04bb4`가 「94회차 e99941f→37820ac」
#   라고 적었지만, 그건 *적힌 것*이지 *잰 것*이 아니다 — 서버가 지금 무엇을 물고 있는지 본다.
# 🚨 `127.0.0.1:3000`은 000이 정상(앱은 caddy 뒤에 있다). 도메인은 **sjfire.co.kr**.
#
# 🚨🚨 **내 up 스크립트는 끝내 안 돌았다.** 이 baseline을 재고 up을 띄우는 사이
#   **타 세션이 같은 95회차를 먼저 냈고**(`_deploy95-baseline-tabbar`·`-launch`·`-verify` 한 벌),
#   그쪽 구간이 내 두 커밋을 **업어 갔다**(서버 HEAD `5ae147d` ⊃ `fb22bbd3`·`fceb11e9`).
#   그래서 내 up 스크립트는 **지우고** 이 파일만 남긴다 — 안 돈 up을 기록으로 남기면
#   다음 사람이 낡은 EXPECT_HEAD/EXPECT_IMG를 그대로 믿는다.
#   ⭐ 여기서 잰 **before가 판정의 근거**다: 신규 5개 전부 0 → after 2·2·3·2·2,
#     존속 6개 전부 불변(2·2·2·4·4·2), 음성 0, 템플릿 sha 5dc767d1a9101aa9 불변.
#   ⭐ 배포 착지는 「내가 배포했는가」가 아니라 **「내 커밋이 서버 HEAD의 조상인가 + 마커가 늘었는가」**로
#     증명한다. 이 저장소에서 같은 일이 여러 번 있었다(회차 선점·조상으로 업어 감).
#   🚨 `fb22bbd3`은 문자열 마커가 **원리적으로 없다**(복귀 주소 조립을 한 곳으로 합친 변경).
#     지어내지 않고 조상 판정 + 존속 `daypanel-detail-link`=2로 증명했다.
set -u
echo "=== 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)"
echo "HEAD 제목   = $(git -C /home/ubuntu/woni log -1 --format=%s)"
echo "dirty       = $(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"

echo
echo "=== 회차 세기 — 롤백 태그(이미지 교체 흔적) ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep -F 'erp-app:rollback-' | head -8

echo
echo "=== MARKER BEFORE (출현 파일 수) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo "--- 신규(늘어야 한다) ---"
printf '  %-34s = %s\n' 'multiday-end'            "$(c 'multiday-end')"
printf '  %-34s = %s\n' 'multiday-warn'           "$(c 'multiday-warn')"
printf '  %-34s = %s\n' '다일 점검은 최대'          "$(c '다일 점검은 최대')"
printf '  %-34s = %s\n' '점검 일수(aria)'          "$(c '점검 일수')"
printf '  %-34s = %s\n' 'daypanel-workbook'       "$(c 'daypanel-workbook')"
echo "--- 존속(줄면 안 된다) ---"
printf '  %-34s = %s\n' 'calendar-step-input'     "$(c 'calendar-step-input')"
printf '  %-34s = %s\n' 'daypanel-detail-link'    "$(c 'daypanel-detail-link')"
printf '  %-34s = %s\n' 'sheet-entry-back'        "$(c 'sheet-entry-back')"
printf '  %-34s = %s\n' '설비 확인 → 점검표'        "$(c '설비 확인 → 점검표')"
printf '  %-34s = %s\n' '배치확인서를 올리거나'      "$(c '배치확인서를 올리거나')"
printf '  %-34s = %s\n' 'data-detail-panel'       "$(c 'data-detail-panel')"
echo "--- 음성(0이어야 한다) ---"
printf '  %-34s = %s\n' 'zzzNoSuchMarker95'       "$(c 'zzzNoSuchMarker95')"

echo
echo "=== 자산 — 이 구간엔 템플릿 변경이 없다(그대로여야) ==="
docker exec erp-app-1 sh -c "sha256sum /app/templates/fire-plan-workbook.xlsx 2>/dev/null | cut -c1-16"

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/inspections/calendar; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
