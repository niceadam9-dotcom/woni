#!/usr/bin/env bash
# 86회차 배포 검증 — before는 롤백 이미지(acad464c) 실물에서, after는 실행 중 컨테이너에서.
# 같은 자를 양쪽에 대야 「배포됐다」가 증명된다(소스 대조는 서버에 뭐가 떴는지 말해 주지 않는다).
set -u
echo "=== 실행 상태 ==="
git -C /home/ubuntu/woni log --oneline -1
echo "내 ②(a7d26f05) 조상? $(git -C /home/ubuntu/woni merge-base --is-ancestor a7d26f05 HEAD && echo YES || echo NO)"
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
L=$(docker images --no-trunc --format '{{.ID}}' erp-app:latest | cut -c8-19)
echo "running=$R  latest=$L  $([ "$R" = "$L" ] && echo '(일치)' || echo '⚠ 불일치 — 컨테이너가 옛 이미지다')"
echo "컨테이너 상태: $(docker inspect --format '{{.State.Status}} up={{.State.StartedAt}}' erp-app-1)"

a() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
b() { docker run --rm --entrypoint sh erp-app:rollback-acad464c -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }

echo
echo "=== MARKER 3분법 (before=rollback-acad464c · after=실행 중) ==="
printf '  %-14s %-34s before=%-4s after=%s\n' '신규'  'xlsx-notice-chip'        "$(b 'xlsx-notice-chip')"      "$(a 'xlsx-notice-chip')"
printf '  %-14s %-34s before=%-4s after=%s\n' '신규'  '고지 머리글'              "$(b '아래 칸이 비었거나')"     "$(a '아래 칸이 비었거나')"
printf '  %-14s %-34s before=%-4s after=%s\n' '감소'  '엑셀 고지: (10→9 기대)'   "$(b '엑셀 고지: ')"           "$(a '엑셀 고지: ')"
printf '  %-14s %-34s before=%-4s after=%s\n' '존속'  'plan-bar-pdf (83회차)'    "$(b 'plan-bar-pdf')"          "$(a 'plan-bar-pdf')"
printf '  %-14s %-34s before=%-4s after=%s\n' '존속'  'reports-round-label(85)'  "$(b 'reports-round-label')"   "$(a 'reports-round-label')"
printf '  %-14s %-34s before=%-4s after=%s\n' '존속'  'fire-plan-xlsx'           "$(b 'fire-plan-xlsx')"        "$(a 'fire-plan-xlsx')"
printf '  %-14s %-34s before=%-4s after=%s\n' '존속(남)' 'pending-doc(f112ef1)'  "$(b 'pending-doc')"           "$(a 'pending-doc')"
printf '  %-14s %-34s before=%-4s after=%s\n' '음성'  'zzzNoSuchMarker86'        "$(b 'zzzNoSuchMarker86')"     "$(a 'zzzNoSuchMarker86')"

echo
echo "=== 서빙 확인 (로그인 없이 — 200이면 앱이 살아 있다) ==="
curl -s -o /dev/null -w "  /login -> %%{http_code} (%%{time_total}s)\n" https://erp.sjfire.co.kr/login || echo "  curl 실패"
echo "=== 앱 로그 마지막 10줄 ==="
docker logs --tail 10 erp-app-1 2>&1 | tail -10
echo "=== VERIFY DONE ==="
