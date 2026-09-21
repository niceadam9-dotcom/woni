#!/usr/bin/env bash
# 95회차 완료 대기 — 로그에 종료 표식이 뜰 때까지 서버 쪽에서 기다린다(ssh 왕복을 줄인다)
set -u
for i in $(seq 1 100); do
  if grep -qE 'UP DONE|BUILD_FAIL|GUARD_FAIL|FF_FAIL|FF_MISMATCH|MINE_NOT_IN_TARGET' /tmp/_deploy95.log 2>/dev/null; then
    echo "=== 종료 표식 감지 (${i}회차 폴링) ==="
    break
  fi
  sleep 5
done
echo "inflight = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
echo "img      = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status   = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "--- 로그 끝 15줄 ---"
tail -15 /tmp/_deploy95.log
