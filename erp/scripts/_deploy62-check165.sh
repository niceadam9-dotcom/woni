#!/usr/bin/env bash
#
# 🚨 **파일명은 62회차인데 본문의 회차 표기와 음성 마커는 61이다 — 일부러 그렇다.**
#    실행 당시 이 스크립트는 `_deploy61-up.sh`였고 음성 마커도 `zzzNoSuchMarker61`로 돌았다
#    (실행 로그: `음성(zzzNoSuchMarker61)=0`). 그런데 **다른 세션이 같은 시각에 「61회차」를
#    선점**했다(b971dbc -> ea02271, 커밋 3fc8607). 그래서 파일명만 62로 올리고 **본문은 돌아간
#    그대로 둔다** — 기록을 예쁘게 고치면 로그와 대조가 안 된다.
#    ⭐ 회차 번호는 전역 자원인데 두 세션이 동시에 집었다. 다음 사람은 up 스크립트를 쓰기 전에
#      `git log --oneline origin/main | grep 회차`로 선점 여부를 먼저 볼 것.
# 165 적용 여부 — **운영 Supabase**에 읽기 전용으로 묻는다.
# 🚨 로컬 .env.local은 스테이징(nwfln…)이다. 운영(ryuoz…)은 컨테이너 환경에만 있다.
#    그래서 판정을 반드시 서버에서, 실행 중인 컨테이너의 값으로 한다.
set -u

U=$(sudo docker exec erp-app-1 sh -c 'echo $NEXT_PUBLIC_SUPABASE_URL')
K=$(sudo docker exec erp-app-1 sh -c 'echo $SUPABASE_SERVICE_ROLE_KEY')
[ -n "$U" ] || { echo NO_URL; exit 2; }
[ -n "$K" ] || { echo NO_KEY; exit 3; }
echo "SUPABASE=$(echo "$U" | sed -E 's#https://([a-z]{5}).*#\1…#')"

probe() {  # $1 = 컬럼 목록
  curl -s -o /tmp/r.json -w '%{http_code}' -m 20 \
    "$U/rest/v1/buildings?select=$1&limit=1" \
    -H "apikey: $K" -H "Authorization: Bearer $K"
}

echo "--- 대조군: 확실히 있는 컬럼 (계측기 자기검사) ---"
C=$(probe "id"); echo "  id → HTTP $C  $(head -c 120 /tmp/r.json)"
[ "$C" = "200" ] || { echo "🚨 대조군이 실패했다 — 이 판정은 무효다"; exit 4; }

echo "--- 165 신설 4컬럼 ---"
for col in stair_direct_count stair_escape_count stair_special_count stair_outdoor_count; do
  C=$(probe "$col")
  if [ "$C" = "200" ]; then echo "  ✅ $col 있음"
  else echo "  🚨 $col 없음 (HTTP $C) $(head -c 160 /tmp/r.json)"; fi
done

echo "--- 165가 만드는 인덱스·제약이 더 있는지 (참고) ---"
C=$(probe "stairs_count"); echo "  기존 stairs_count → HTTP $C"
