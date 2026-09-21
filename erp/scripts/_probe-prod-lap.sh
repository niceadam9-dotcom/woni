#!/usr/bin/env bash
# 운영 실측(읽기 전용) — 「설비점검 → 점검표 입력 → 달력 복귀」 한 바퀴가 실제로 나가 있는가.
# 관련 커밋: 317a7e01(91회차 · 달력→설비→점검표→달력) · 81028958(93회차 · [←]가 사이드 패널로)
set -u
echo "=== 위치 ==="
echo "HEAD        = $(git -C /home/ubuntu/woni rev-parse --short HEAD)"
echo "HEAD full   = $(git -C /home/ubuntu/woni rev-parse HEAD)"
echo "HEAD 제목   = $(git -C /home/ubuntu/woni log -1 --format=%s)"
echo "HEAD 시각   = $(git -C /home/ubuntu/woni log -1 --format=%ci)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"

echo
echo "=== 이 두 커밋이 서버 HEAD의 조상인가 (배포 대상에 들어 있나) ==="
for c in 317a7e01 81028958 55f3361d; do
  if git -C /home/ubuntu/woni merge-base --is-ancestor "$c" HEAD 2>/dev/null; then
    echo "  YES  $c  $(git -C /home/ubuntu/woni log -1 --format=%s "$c" 2>/dev/null | cut -c1-60)"
  else
    echo "  NO   $c  (서버 HEAD에 없음)"
  fi
done

echo
echo "=== 이미지 안 마커 (출현 파일 수) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
printf '  %-34s = %s\n' 'calendar-step-input'        "$(c 'calendar-step-input')"
printf '  %-34s = %s\n' '설비 확인 → 점검표'          "$(c '설비 확인 → 점검표')"
printf '  %-34s = %s\n' 'sheet-entry-back'           "$(c 'sheet-entry-back')"
printf '  %-34s = %s\n' 'daypanel-detail-link'       "$(c 'daypanel-detail-link')"
printf '  %-34s = %s\n' '"insp"'                     "$(c '"insp"')"
printf '  %-34s = %s\n' 'facilities-skip-to-sheet'   "$(c 'facilities-skip-to-sheet')"
printf '  %-34s = %s\n' '건너뛰고 점검표로'            "$(c '건너뛰고 점검표로')"
printf '  %-34s = %s\n' '배치확인서를 올리거나'        "$(c '배치확인서를 올리거나')"
printf '  %-34s = %s\n' '(음성)zzzNoSuchMarkerLap'    "$(c 'zzzNoSuchMarkerLap')"

echo
echo "=== 이미지가 HEAD보다 오래됐는가 (빌드 시각 대조) ==="
echo "  image created = $(docker inspect --format '{{.Created}}' erp-app:latest 2>/dev/null)"
echo "  HEAD committed= $(git -C /home/ubuntu/woni log -1 --format=%cI)"

echo
echo "=== 롤백 태그(회차 흔적) ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep -F 'erp-app:rollback-' | head -6

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/inspections/calendar; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
