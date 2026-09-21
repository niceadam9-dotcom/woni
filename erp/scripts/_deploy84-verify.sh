#!/usr/bin/env bash
# 84회차 사후 실측 — `sz val="32"` 마커가 before/after 모두 0이었다.
# 중첩 셸 세 겹(ssh → docker exec → sh -c)을 지나며 따옴표 이스케이프가 깨진 것으로 보이나,
# **계측기 탓이라고 단정하지 않고 직접 묻는다**. 0이 맞다면 32pt가 안 들어간 것이므로 롤백 사유다.
set -u
echo "=== 배포된 xlsx에서 표지 제목 스타일을 직접 읽는다 ==="
sudo docker exec erp-app-1 sh -c '
  rm -rf /tmp/vfy && mkdir -p /tmp/vfy && cd /tmp/vfy
  unzip -o -q /app/templates/fire-plan-workbook.xlsx xl/styles.xml xl/worksheets/sheet1.xml
  echo "  글꼴 표 <fonts> 전문:"
  sed -n "s/.*<fonts[^>]*>\(.*\)<\/fonts>.*/\1/p" xl/styles.xml | tr ">" ">\n" | grep -E "sz val|name val" | sed "s/^/    /"
  echo "  32pt 글꼴 벌수 = $(grep -o "sz val=.32." xl/styles.xml | wc -l)"
  echo "  HY헤드라인M 벌수 = $(grep -oF "HY헤드라인M" xl/styles.xml | wc -l)"
  echo "  표지 A3 셀 = $(grep -o "<c r=.A3. s=.[0-9]*." xl/worksheets/sheet1.xml | head -1)"
  rm -rf /tmp/vfy
'
echo "=== 최종 상태 ==="
echo "HEAD=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"
echo "RUNNING=$(sudo docker inspect --format "{{.Image}}" erp-app-1 | cut -c8-19)"
echo "ROLLBACK_NEW=$(sudo docker images --no-trunc --format "{{.ID}}" erp-app:rollback-14779d0c | cut -c8-19)"
echo "login=$(curl -s -o /dev/null -w "%{http_code}" -m 20 https://sjfire.co.kr/login)"
echo "DONE_VERIFY"
