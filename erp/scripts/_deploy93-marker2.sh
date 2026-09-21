#!/usr/bin/env bash
# 93회차 — 마커 후보 보강 실측(읽기 전용). `?insp=` 복원 로직은 문자열이 하나뿐이라 미리 재 둔다.
set -u
c() { docker exec erp-app-1 sh -c "grep -rlF '$1' /app/.next 2>/dev/null | wc -l"; }
echo '  "insp"(따옴표 포함)      = '"$(c '"insp"')"
echo "  initialInspectionId      = $(c 'initialInspectionId')   <- 식별자(minify로 사라질 수 있다)"
echo "  insp=                    = $(c 'insp=')"
