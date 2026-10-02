# 백업·복구 런북 — 일일 백업(Supabase) + 야간 덤프(오브젝트 스토리지)

> 통합 실행계획 A1(2026-10-02 결정: 일일 백업 + 야간 덤프, 보관처 오브젝트 스토리지).
> 정본 파일: `deploy/backup/backup-nightly.sh`(스크립트) · `deploy/cron/sjfire-erp.cron`(발화 02:00) · 이 문서(설치·복구).
> 비밀은 VPS `/etc/sjfire/`에만 있다. 이 저장소는 공개다.

## 0. 두 겹 구조

| 겹 | 무엇 | 어디 | 복구 범위 | 보존 |
| --- | --- | --- | --- | --- |
| 1 | Supabase 일일 백업(관리형) | Supabase 대시보드 → Database → Backups | 같은 프로젝트를 과거 시점으로 되돌리기(대시보드 Restore). 스토리지 파일 미포함 | Pro 7일 |
| 2 | 야간 덤프(이 스크립트) | 오브젝트 스토리지 버킷 `sjfire-erp-backup` | **다른 프로젝트·다른 계정으로** 전부 재건(DB 데이터 + auth 사용자 + Storage 파일). Supabase 계정 사고·프로젝트 삭제·리전 이전에도 산다 | 35일 |

1겹은 켜져 있는지 확인만 하면 되고(§1), 2겹이 이 문서의 본체다.

## 1. 사람 작업 (한 번)

1. **Supabase 일일 백업 확인** — 운영 프로젝트(`ryuozdhnilfjlahorizh`) 대시보드 → Database → Backups에 일일 백업 목록이 보이는지, 보존 일수를 `배포순서.md` 「백업」 절에 적는다. PITR은 쓰지 않는다(결정).
2. **Session pooler 접속 문자열** — Project Settings → Database → Connection string → Session pooler(포트 **5432**). 직접 접속은 IPv6 전용이라 VPS에서 안 붙고, 트랜잭션 풀러(6543)는 pg_dump가 못 쓴다.
3. **Supabase Storage S3 키** — Project Settings → Storage → S3 Connection → 프로토콜 켜고 New access key. endpoint·region을 함께 적어 둔다.
4. **오브젝트 스토리지** — NCP Object Storage(권장, 지도 API와 같은 계정) 또는 R2/S3. 버킷 `sjfire-erp-backup` 하나(비공개). 액세스 키 발급. 수명주기 규칙은 두지 않는다(스크립트가 35일 정리).
5. (선택) **healthchecks.io** 체크 하나: 주기 1일, 유예 2시간, 알림 메일/카카오. 핑 URL을 `BACKUP_ALERT_URL`에.

## 2. VPS 설치 (root)

```bash
# 패키지 — Ubuntu 24.04의 postgresql-client는 16이라 서버 15 덤프에 맞다
sudo apt-get update && sudo apt-get install -y postgresql-client rclone jq curl gzip
pg_dump --version && rclone version | head -1

# 비밀 2개 — 본보기를 복사한 뒤 실제 값을 채운다 (600, root)
sudo install -d -m 700 -o root -g root /etc/sjfire
sudo install -m 600 -o root -g root /home/ubuntu/woni/erp/deploy/backup/backup.env.example /etc/sjfire/backup.env
sudo install -m 600 -o root -g root /home/ubuntu/woni/erp/deploy/backup/rclone.conf.example /etc/sjfire/rclone.conf
sudo nano /etc/sjfire/backup.env        # SUPABASE_DB_URL·BACKUP_BUCKET·BACKUP_ALERT_URL
sudo nano /etc/sjfire/rclone.conf       # [obj]·[supa] 키·endpoint·region

# 접속 확인 셋
sudo -i bash -c 'source /etc/sjfire/backup.env; psql "$SUPABASE_DB_URL" -Atc "select count(*) from public.customers"'
sudo rclone --config /etc/sjfire/rclone.conf lsd obj:            # 버킷 목록에 sjfire-erp-backup
sudo rclone --config /etc/sjfire/rclone.conf lsd supa:           # Supabase 버킷 7개

# 첫 실행 (수동) — 소요 시간·크기를 본다
sudo chmod +x /home/ubuntu/woni/erp/deploy/backup/backup-nightly.sh
sudo /home/ubuntu/woni/erp/deploy/backup/backup-nightly.sh | tee -a /var/log/sjfire-backup.log
sudo rclone --config /etc/sjfire/rclone.conf cat obj:sjfire-erp-backup/db/$(date +%F)/MANIFEST.json | jq .

# 크론 설치 — 정본 재설치(기존 11줄 + 백업 1줄). CRON_SECRET 치환은 종전과 같다
SECRET=$(grep '^CRON_SECRET=' /home/ubuntu/woni/erp/.env.production | cut -d= -f2-)
sed "s|__CRON_SECRET__|$SECRET|g" /home/ubuntu/woni/erp/deploy/cron/sjfire-erp.cron | sudo tee /etc/cron.d/sjfire-erp >/dev/null
sudo chmod 644 /etc/cron.d/sjfire-erp && sudo systemctl restart cron
```

첫 실행 뒤 `MIN_DATA_BYTES`를 실측 `data_sql_gz_bytes`의 절반쯤으로 올린다. 다음 날 02:00 뒤 `tail /var/log/sjfire-backup.log`와 `heartbeat/last-success.txt`를 확인한다.

## 3. 매일·매주 확인

| 주기 | 확인 | 어디 |
| --- | --- | --- |
| 매일(자동) | 성공 핑 / 실패 핑 | healthchecks.io 알림 |
| 매주 1회 | `db/` 폴더 날짜가 이어지는가, `MANIFEST.json`의 `counts.customers`가 전주와 비슷한가 | `rclone lsd obj:sjfire-erp-backup/db` |
| 매월 1회 | 복구 리허설(§4) 또는 최소한 `data.sql.gz`를 내려 `gzip -t` + `zcat | head` | 아래 |

A3(관측)에서 `cron_runs`·Sentry가 생기면 하트비트 파일을 `/api/health`가 읽어 「백업 신선도」를 같은 알림 경로로 올린다. 그때까지는 healthchecks.io가 대신한다.

## 4. 복구 리허설 — 새 프로젝트로 전부 재건

**원칙.** 리허설은 운영·스테이징을 건드리지 않는다. 임시 Supabase 프로젝트(무료 요금제, 끝나면 삭제)에 복원해 앱을 붙여 보고 시간을 적는다. 스테이징(`nwflnzugwylhpdyodyog`)에 덮어쓰는 것은 실데이터 309건을 잃는 일이라 사용자 승인 없이는 하지 않는다.

```bash
# 0) 변수 — 복원 대상(임시 프로젝트)과 날짜
export NEW_DB_URL='postgresql://postgres.<new-ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres'
export DATE=2026-10-03
mkdir -p ~/restore && cd ~/restore
rclone --config /etc/sjfire/rclone.conf copy obj:sjfire-erp-backup/db/$DATE . && gzip -t *.gz && cat MANIFEST.json

# 1) 스키마 = git 마이그레이션(정본). 개발 PC에서:
#    cd erp && npx supabase link --project-ref <new-ref> && npx supabase db push
#    (schema-public.sql.gz는 마이그레이션이 깨졌을 때의 비상용. 둘을 같이 적용하지 않는다.)

# 2) 데이터 — 트리거·FK 검사 끄고 한 트랜잭션으로 적재
zcat data.sql.gz > data.sql
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET session_replication_role = replica" -f data.sql
# 시퀀스는 덤프 끝의 setval로 복원된다. 행수 대조:
psql "$NEW_DB_URL" -Atc "select (select count(*) from public.customers), (select count(*) from public.inspections), (select count(*) from auth.users)"
# → MANIFEST.json counts와 일치해야 한다

# 3) Storage 파일 — 새 프로젝트에도 S3 키를 만들어 rclone.conf에 [supa_new]로 넣고
#    버킷은 마이그레이션(004·056·068)이 만든다. 파일만 미러 → 원복
rclone --config /etc/sjfire/rclone.conf sync obj:sjfire-erp-backup/storage supa_new: --fast-list
rclone --config /etc/sjfire/rclone.conf size supa_new: --json     # count·bytes가 MANIFEST와 같은가
```

**4) 앱으로 확인(개발 PC).** `.env.local`을 임시 프로젝트 URL·anon·service_role로 바꾼 사본(`.env.restore`)으로 `npm run dev` → 로그인(복원된 auth.users의 기존 비밀번호로 들어가야 한다. JWT 비밀이 다르니 기존 세션은 무효) → 고객 목록·고객 상세 → 점검 달력 → 작업대 열기 → 불량 사진 1장 보이기 → 별지 9호 PDF 1건 생성. 그 다음 E2E 1벌:

```bash
cd erp && npx tsx scripts/test-inspection-workbench.mts   # test-all.mts의 cmd·플래그 그대로
```

**5) 기록.** `배포순서.md` 「백업」 절에 리허설 날짜·백업 날짜·소요 시간(내려받기/적재/스토리지/확인 각각)·행수 대조 결과·발견한 문제를 한 줄로. **임시 프로젝트는 삭제**하고 S3 키도 폐기한다.

**실패 양상과 처치.**
- `permission denied for schema auth` 류 → 풀러 사용자(`postgres.<ref>`)가 아니라 다른 역할로 붙은 것. 접속 문자열 확인.
- `duplicate key` → 대상 프로젝트가 비어 있지 않다(시드가 들어간 마이그레이션 032 `company_profile`, 130 `message_templates` 등). 복원 전에 그 표를 `TRUNCATE … CASCADE`하거나, `data.sql`에서 해당 COPY 블록을 뺀다. 어느 표가 시드를 갖는지는 `git grep -l "INSERT INTO" supabase/migrations`.
- Storage 파일은 있는데 화면에 안 보임 → `storage.objects` 행과 실제 파일 경로 불일치. §4-3을 먼저 하고 2)를 다시 하거나, 객체 메타만 재적재.

## 5. 운영 장애 때 실제 복구 — 어느 겹을 쓰나

| 상황 | 쓰는 겹 | 절차 |
| --- | --- | --- |
| 잘못된 마이그레이션·대량 삭제, 프로젝트는 살아 있음 | 1겹 | 대시보드 Restore(어제 자정 시점) → 그날 변경분은 활동 로그·문자 로그로 수기 복원. **Restore 전에 2겹을 한 번 수동 실행해 현재 상태를 보존** |
| 특정 파일 삭제 | 2겹 `storage-deleted/<날짜>/` | `rclone copy` 로 그 파일만 Supabase에 되돌림 |
| 프로젝트·계정 손실, 리전 이전 | 2겹 전체 | §4 그대로 새 프로젝트에 → `.env.production`·모바일 `app.json`·Edge Function 재배포 → DNS 불변(앱 URL은 같음) |

## 6. 바꾸지 않는 것

- `_backup-supabase.mjs`(개발 PC 수동 JSON 백업)는 남긴다. 비상시 Management API 토큰으로 테이블 단위를 뽑는 두 번째 길이다.
- 운영 크론 11개·`CRON_SECRET` 경로는 불변. 백업은 앱을 거치지 않는다.
- `.env.production`의 비밀을 백업 env로 복사하지 않는다. 백업에는 DB 비밀번호·S3 키만 필요하다.
