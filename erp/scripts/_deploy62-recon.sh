#!/usr/bin/env bash
#
# 🚨 **파일명은 62회차인데 본문의 회차 표기와 음성 마커는 61이다 — 일부러 그렇다.**
#    실행 당시 이 스크립트는 `_deploy61-up.sh`였고 음성 마커도 `zzzNoSuchMarker61`로 돌았다
#    (실행 로그: `음성(zzzNoSuchMarker61)=0`). 그런데 **다른 세션이 같은 시각에 「61회차」를
#    선점**했다(b971dbc -> ea02271, 커밋 3fc8607). 그래서 파일명만 62로 올리고 **본문은 돌아간
#    그대로 둔다** — 기록을 예쁘게 고치면 로그와 대조가 안 된다.
#    ⭐ 회차 번호는 전역 자원인데 두 세션이 동시에 집었다. 다음 사람은 up 스크립트를 쓰기 전에
#      `git log --oneline origin/main | grep 회차`로 선점 여부를 먼저 볼 것.
# 61회차 착수 판정 — 「지금 서버가 무엇을 돌리고 있는가」를 먼저 실측한다.
# 🚨 회차·구간·이미지를 로컬 기억에서 추측하면 안 된다(메모리가 여러 번 낡아 있었다).
# 🚨 RUNNING·LATEST를 **둘 다** 잰다 — latest가 실행 중이 아닐 수 있다.
set -u
cd /home/ubuntu/woni/erp 2>/dev/null || { echo FATAL_NO_ERP_DIR; exit 9; }

echo "=== 저장소 ==="
echo "HEAD=$(git -C /home/ubuntu/woni rev-parse HEAD)"
echo "HEAD_SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)"
echo "DIRTY=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "BRANCH=$(git -C /home/ubuntu/woni rev-parse --abbrev-ref HEAD)"

echo "=== 이미지 ==="
echo "RUNNING=$(sudo docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "LATEST=$(sudo docker images --no-trunc --format '{{.ID}}' erp-app:latest 2>/dev/null | cut -c8-19)"
echo "--- 롤백 태그들 ---"
sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -F 'rollback' | head -5

echo "=== 진행 중인 배포가 있는가 (있으면 물러난다) ==="
echo "INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
ps -eo etime,cmd | grep -F 'docker compose' | grep -v grep | head -3
echo "--- 컨테이너 ---"
sudo docker ps --format '{{.Names}} {{.Status}} {{.Image}}' | head -8

echo "=== 서비스 살아 있는가 ==="
echo "HTTP_LOGIN=$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://sjfire.co.kr/login)"

echo "=== 미배포 구간 (origin/main까지) ==="
git -C /home/ubuntu/woni fetch origin --quiet 2>/dev/null
echo "ORIGIN=$(git -C /home/ubuntu/woni rev-parse --short origin/main)"
echo "--- HEAD..origin/main ---"
git -C /home/ubuntu/woni log --oneline HEAD..origin/main | head -20
echo "COUNT=$(git -C /home/ubuntu/woni rev-list --count HEAD..origin/main)"
echo "--- 이 구간에 마이그레이션이 있는가 ---"
git -C /home/ubuntu/woni diff --name-only HEAD origin/main -- erp/supabase/migrations | head -10
