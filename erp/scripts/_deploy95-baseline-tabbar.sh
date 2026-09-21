#!/usr/bin/env bash
# 95회차 착수 실측(읽기 전용) — **내 축(탭 바) 전용 baseline**.
# 🚨 회차 번호를 처음엔 96으로 잡았다가 **서버에 묻고 95로 고쳤다**. 타 세션이 `_deploy95-up.sh`를
#   준비해 뒀는데(미커밋) 아직 돌리지 않았다 — 롤백 태그 최신이 `rollback-37820ac`, 서버 HEAD도
#   37820ac, 그쪽 신규 마커(multiday-end·daypanel-workbook)가 0이라 셋 다 일치했다.
#   그쪽 up은 `merge --ff-only origin/main`이라 내 커밋 5ae147d5까지 업어 간다 = **별도 회차가
#   아니라 같은 배**다. 그래서 그 파일을 건드리지 않고 그대로 실행했고, 이 파일은 그 배에 실린
#   **내 축의 before**만 맡는다.
#   ① 지금 무엇이 물려 있나(HEAD·img·inflight) ② 내 커밋이 이미 나갔나 ③ 마커 before
#
# 🚨 내 커밋 5ae147d5(탭 바를 본문 칼럼 밖으로)에는 **새 문자열이 하나도 없다.**
#   className 문자열은 그대로고 JSX 중첩만 바뀐다 → 「개수」 마커가 원리적으로 없다.
#   축을 **자리**로 잡는다(75회차 [+고객 등록] 이사와 같은 수법): 같은 청크 안에서
#     `flex flex-wrap gap-1 border-b border-line`(탭 바)와 `flex gap-6 items-start`(본문 셸)의
#     바이트 오프셋이 **맞교대**해야 한다.  before: shell<tablist  →  after: tablist<shell
# 🚨 오프셋은 컨테이너 BusyBox grep으로 못 잰다(-b 없음) — 호스트로 흘려 GNU grep으로 잰다.
set -u
cd /home/ubuntu/woni || { echo FATAL_NO_REPO; exit 9; }

echo "=== 위치 ==="
echo "HEAD        = $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"
echo "dirty       = $(git status --porcelain | grep -v -F 'erp/up.log' | wc -l)"
echo "running img = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status      = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "up since    = $(docker inspect --format '{{.State.StartedAt}}' erp-app-1 2>/dev/null)"
echo "inflight    = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"

echo
echo "=== 회차 세기 — 롤백 태그(이미지 교체 흔적) ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | grep -F 'erp-app:rollback-' | head -6

echo
echo "=== 내 커밋 5ae147d5 ==="
git fetch origin --quiet
git merge-base --is-ancestor 5ae147d5 origin/main && echo "  원격: YES" || echo "  원격: NO"
git merge-base --is-ancestor 5ae147d5 HEAD && echo "  서버: 이미 배포됨" || echo "  서버: 미배포"
echo "  --- 서버 HEAD..origin/main 구간 ---"
git log --oneline HEAD..origin/main
echo "  마이그 변경 = $(git diff --name-only HEAD origin/main -- erp/supabase/migrations | wc -l)건"

echo
echo "=== 마커 before — 탭 바/셸 오프셋 순서 ==="
FILES=$(docker exec erp-app-1 sh -c "grep -rl 'flex flex-wrap gap-1 border-b border-line' /app/.next/static/chunks 2>/dev/null")
echo "청크 후보 수 = $(echo "$FILES" | grep -c . )"
for f in $FILES; do
  docker exec erp-app-1 sh -c "cat '$f'" > /tmp/_chunk96.js 2>/dev/null
  A=$(grep -bo 'flex flex-wrap gap-1 border-b border-line' /tmp/_chunk96.js | head -1 | cut -d: -f1)
  B=$(grep -bo 'flex gap-6 items-start' /tmp/_chunk96.js | head -1 | cut -d: -f1)
  ORD='n/a'
  if [ -n "${A:-}" ] && [ -n "${B:-}" ]; then
    if [ "$A" -lt "$B" ]; then ORD='tablist<shell (after형)'; else ORD='shell<tablist (before형)'; fi
  fi
  echo "  $(basename "$f")  tablist@${A:-없음}  shell@${B:-없음}  → $ORD"
done
rm -f /tmp/_chunk96.js

echo
echo "=== 존속 마커(줄면 안 된다) ==="
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
for M in 'flex gap-6 items-start' 'calendar-step-input' 'daypanel-detail-link' 'sheet-entry-back' 'data-detail-panel' 'zzzNoSuchMarker96'; do
  printf '  %-40s = %s\n' "$M" "$(c "$M")"
done
echo "  --- 95회차(타 세션) 축이 나갔는지도 함께 본다 ---"
for M in 'multiday-end' 'daypanel-workbook'; do
  printf '  %-40s = %s\n' "$M" "$(c "$M")"
done

echo
echo "=== 서빙 ==="
for u in https://sjfire.co.kr/login https://sjfire.co.kr/customers; do
  curl -s -o /dev/null -w "  $u -> %{http_code}\n" -m 25 "$u" || echo "  $u -> curl 실패"
done
echo BASELINE_DONE
