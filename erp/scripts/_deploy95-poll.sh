#!/usr/bin/env bash
# 95회차 진행 폴링 — 로그 끝과 in-flight만 본다(읽기 전용)
set -u
echo "inflight = $(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)"
echo "img      = $(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)"
echo "status   = $(docker inspect --format '{{.State.Status}}' erp-app-1 2>/dev/null)"
echo "--- /tmp/_deploy95.log 끝 20줄 ---"
tail -20 /tmp/_deploy95.log 2>/dev/null || echo "(로그 없음)"
