/** 공통 서술 라이브러리 「기본 문구」 8섹션 등록 (2026-09-21 사용자 지시).
 *
 *  왜 필요했나 — 실측: `plan_text_library` 15건 중 **실제 문구가 든 건 5건뿐**이고 「기본 문구」
 *  7건은 전부 빈 깡통(`{}`·`[]`)이었다. `plan_text_applied`는 **0건** — 자동주입 기계가 다 만들어져
 *  있는데 주입할 내용이 없어 **한 번도 돈 적이 없다**. 고객 채움률도 0~1.3%(308명 중 최대 4명).
 *
 *  유형 축을 늘리지 않고 **유형 불문 기본 문구 한 벌**로 간 이유도 실측이다:
 *    · `buildings.purpose`가 94.3% 공란이라 용도로 유형을 가를 수 없다
 *    · 고객명 대리 추정으로도 57.8%가 분류 불가(경찰서·양로원·영농조합·정수장·떡집…)
 *  기존 상가형·공장형은 대안 항목으로 그대로 둔다.
 *
 *  ⚠ **문구 모양을 여기서 다시 짜지 않는다.** `PLAN_TEXT_SECTIONS[key].pick()`에 태워 만든다 —
 *    사본이 둘이 되면 고객 고유 필드(일자·장소·담당)가 라이브러리로 새는 그 결함이 되살아난다.
 *    pick은 행의 비서술 열을 ''로 정규화하고, record는 빈 키를 지운다.
 *  ⚠ `is_default`는 **섹션당 1개**(부분 유니크 인덱스) — 지정 전에 같은 섹션 기존 기본을 해제한다.
 *  ⚠ `version`은 body가 **실제로 바뀔 때만** +1 (`planTextBodyEquals` — jsonb 키 순서 무관 비교).
 *    그래서 이 스크립트는 **몇 번 돌려도 안전**하다(같은 내용이면 version이 안 움직인다).
 *  🚨 자격증명은 `process.env`에서 **직접** 읽는다 — `_env.mjs`는 `.env.local`을 파일에서 읽어
 *    `--env-file`이 무시된다(운영을 향한다고 믿고 스테이징을 건드린 전례).
 *
 *  실행:
 *    스테이징  npx tsx scripts/_seed-plan-text-defaults.mts            (조회만)
 *              npx tsx scripts/_seed-plan-text-defaults.mts --apply
 *    운영      SUPABASE_URL=... SERVICE_ROLE_KEY=... npx tsx scripts/_seed-plan-text-defaults.mts --apply
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { PLAN_TEXT_SECTIONS, planTextBodyEquals } from '../src/lib/plan-text-sections.ts'

const APPLY = process.argv.includes('--apply')
const TITLE = '기본 문구'

/** env 우선순위: process.env(운영 주입용) → .env.local(스테이징 기본) */
function creds(): { url: string; key: string; origin: string } {
  const pu = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const pk = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (pu && pk) return { url: pu, key: pk, origin: 'process.env' }
  const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const get = (k: string) => txt.split(/\r?\n/).find(l => l.startsWith(k + '='))?.slice(k.length + 1).trim() ?? ''
  const u = get('NEXT_PUBLIC_SUPABASE_URL'), s = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!u || !s) throw new Error('자격증명을 찾지 못했습니다 (.env.local / process.env)')
  return { url: u, key: s, origin: '.env.local' }
}

// ── 문구 원본 — pick()에 태우기 **전**의 폼 모양. 각 섹션 editor 스펙과 같은 키를 쓴다 ──
const SEED: Record<string, unknown> = {
  brigadeTeams: {
    command: '자위소방대장을 보좌하여 각 팀의 활동을 총괄 지휘한다. 화재 상황을 판단해 초기소화·피난유도의 우선순위를 결정하고, 소방대 도착 시 상황과 인명 현황을 인계한다.',
    contact: '화재 사실을 119에 신고하고 관계인·재실자에게 전파한다. 비상방송설비를 작동시키고, 소방대 도착 시 진입로와 소방시설 위치를 안내한다.',
    extinguish: '소화기 및 옥내소화전을 이용하여 초기 진압을 실시한다. 연소 확대 우려가 있으면 무리하지 않고 피난한 뒤 소방대에 인계한다.',
    evacuate: '피난계단과 비상구로 재실자를 유도하고 집결지까지 인솔한다. 담당 구역의 잔류 인원을 확인해 지휘통제팀에 보고한다.',
    rescue: '부상자를 안전구역으로 옮겨 응급처치하고 구급대 도착 시 인계한다. 피난약자의 대피를 우선 지원한다.',
    protect: '방화문·방화셔터를 폐쇄하고 전기·가스를 차단한다. 관계자 외 출입을 통제하여 2차 피해를 막는다.',
    initial: '야간·휴일 등 근무 인원이 적은 시간대에는 재실 근무자가 통보·초기소화·피난유도를 겸하여 수행한다.',
  },
  evacPlan: {
    falseAlarm: '수신기에서 화재표시 구역을 확인하고 해당 구역을 직접 확인한다. 확인 전에는 음향장치를 임의로 정지하지 않는다. 비화재보로 판명되면 경보를 복구하고 그 사유를 방송으로 알린 뒤 감시를 계속한다.',
    procedure: '피난유도팀의 지시에 따라 가까운 비상구와 직통계단으로 대피한다. 승강기는 사용하지 않는다. 각 층 담당자는 담당 구역의 재실자 유무를 확인한 뒤 마지막으로 이동하며, 집결지에서 인원을 점검해 지휘통제팀에 보고한다.',
    evacMethod: '자세를 낮추고 젖은 수건 등으로 입과 코를 가린 채 벽을 따라 이동한다. 문을 열기 전 손등으로 문과 손잡이의 온도를 확인한다. 아래층으로 대피가 어려우면 옥상 등 안전구역으로 피난한다.',
  },
  // 🚨 이 섹션만 입력 모양이 다르다 — pick이 `{method}`가 아니라 **고객 서식(유형 6키)** 을 받아
  //    `dominantText`로 대표 문장을 고른다. `{method}`를 주면 6키가 전부 비어 '' 로 떨어지고
  //    **조용히 빈 body가 등록된다**(드라이런에서 「동일(무변경)」로 잡혔다 — 적용했으면 빈 채로 나갈 뻔).
  //    라이브러리에는 한 칸으로 저장되고, 고객에게 갈 때 빈 유형에만 펼쳐진다.
  vulnerableMethods: Object.fromEntries(
    ['노인', '어린이', '영유아', '임산부', '장애인', '기타'].map(t => [t,
      '사전에 파악한 담당 보조자가 1:1로 동행하여 대피시킨다. 보행이 가능하면 계단으로 부축 이동하고, 이동이 어려우면 피난기구 또는 대피공간·방화구획된 안전구역으로 옮겨 구조를 기다리며 그 위치를 즉시 119와 지휘통제팀에 알린다.',
    ]),
  ),
  training: {
    scenarioType: '공통(기본)',
    scenario: [
      '1. 최초 발견자가 화재를 발견하고 육성 및 발신기로 전파',
      '2. 비상연락팀이 119 신고 및 비상방송 실시',
      '3. 초기소화팀이 소화기·옥내소화전으로 초기 진화 시도',
      '4. 피난유도팀이 재실자를 집결지로 유도하고 잔류 인원 확인',
      '5. 집결지 인원 점검 후 소방대 도착 시 상황 인계',
      '안내방송: 화재가 발생했습니다. 가까운 비상구와 계단을 이용해 침착하게 대피해 주시기 바랍니다.',
    ].join('\n'),
    details: [
      { name: '소방훈련(소화·피난·통보)', target: '전 직원 및 관계인', kind: '합동훈련', form: '실습',
        materials: '소방계획서·층별 피난도면', plan: '소화기 실습, 피난유도 및 집결지 인원점검, 119 통보 요령' },
      { name: '소방안전교육', target: '전 직원 및 관계인', kind: '교육', form: '집합교육',
        materials: '소방안전관리 교재·홍보물', plan: '소방시설 사용법, 피난경로 숙지, 화기취급 주의사항' },
    ],
  },
  fireworkLog: [
    { work: '용접·용단 작업', measure: '가연물 이격 및 방화포 설치, 소화기 비치, 작업 후 1시간 이상 잔불 감시' },
    { work: '그라인더 등 불티 발생 작업', measure: '불티 비산방지막 설치, 주변 가연물 제거, 작업구역 출입통제' },
    { work: '난방기구·전열기구 사용', measure: '주변 가연물 이격, 자리를 비울 때 전원 차단, 문어발식 배선 금지' },
    { work: '주방 화기 사용', measure: '덕트·후드 정기 청소, 자동소화장치 작동 확인, 사용 후 가스밸브 잠금' },
  ],
  constructionLog: [
    { content: '소화기 교체·충약', note: '내용연수 10년 경과분 교체, 지시압력계 정상범위 확인' },
    { content: '수신기·감지기 정비', note: '작동시험 후 경계구역 표시 일치 확인, 경보 정지 구간 사전 공지' },
    { content: '유도등·비상조명등 정비', note: '예비전원 점등시간 확인(법정 기준 이상)' },
    { content: '소화펌프·배관 정비', note: '단수·단전 구간 사전 공지, 정비 중 대체 소화수단 확보' },
  ],
  promoLog: [
    { method: '게시', content: '피난안내도 및 소방시설 사용법 게시, 비상구 상시 개방 안내' },
    { method: '방송', content: '정기 안내방송으로 피난경로·집결지 안내 및 화기취급 주의 당부' },
    { method: '교육', content: '신규 입주자·근무자 대상 소방안전 교육 및 피난경로 안내' },
    { method: '배포', content: '계절별(동절기 난방기구, 하절기 냉방기기) 화재예방 안내문 배포' },
  ],
  recoveryLog: [
    { damage: '소방시설 손상·작동 불능', recovery: '즉시 정비업체 조치, 복구 전까지 소화기 추가 배치 및 순찰 강화' },
    { damage: '전기·기계설비 소손', recovery: '전문업체 점검 후 복구, 복구 전 해당 구역 사용 금지' },
    { damage: '내장재·방화구획 손상', recovery: '방화구획 및 방화문 원상복구, 복구 완료 후 관할 소방서 확인' },
    { damage: '인명 피해', recovery: '응급처치 및 이송, 관할 소방서 신고, 재발방지 대책 수립' },
  ],
}

const { url, key, origin } = creds()
const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const host = new URL(url).host
console.log(`대상 DB: ${host}  (자격증명 출처: ${origin})`)
console.log(`모드: ${APPLY ? '★ 적용(--apply)' : '조회만 (적용하려면 --apply)'}\n`)

// updated_by — NOT NULL일 수 있으므로 관리자 프로필을 하나 잡는다
const { data: prof } = await db.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle()
const actor = (prof?.id as string | undefined) ?? null

let ins = 0, upd = 0, same = 0, defSet = 0
for (const [sectionKey, formValue] of Object.entries(SEED)) {
  const def = PLAN_TEXT_SECTIONS[sectionKey]
  if (!def) { console.log(`  ✗ ${sectionKey} — 알 수 없는 섹션(건너뜀)`); continue }
  const body = def.pick(formValue)          // ★ 모양은 제품의 pick이 정한다

  const { data: cur, error: e1 } = await db.from('plan_text_library')
    .select('id,version,body,is_default').eq('section_key', sectionKey).eq('title', TITLE)
    .eq('is_active', true).maybeSingle()
  if (e1) { console.log(`  ✗ ${sectionKey} 조회 실패: ${e1.message}`); continue }

  const changed = !cur || !planTextBodyEquals(cur.body, body)
  const act = !cur ? '신규' : changed ? '갱신(version+1)' : '동일(무변경)'
  console.log(`  [${sectionKey.padEnd(18)}] ${act}${cur?.is_default ? '' : ' · 기본 지정 필요'}`)

  if (!APPLY) { if (!cur) ins++; else if (changed) upd++; else same++; continue }

  let id = cur?.id as string | undefined
  if (!cur) {
    const { data, error } = await db.from('plan_text_library')
      .insert({ section_key: sectionKey, title: TITLE, body, ...(actor ? { updated_by: actor } : {}) })
      .select('id').single()
    if (error) { console.log(`     ✗ 등록 실패: ${error.message}`); continue }
    id = data.id as string; ins++
  } else if (changed) {
    const { error } = await db.from('plan_text_library').update({
      body, version: (cur.version as number) + 1,
      updated_at: new Date().toISOString(), ...(actor ? { updated_by: actor } : {}),
    }).eq('id', id!)
    if (error) { console.log(`     ✗ 갱신 실패: ${error.message}`); continue }
    upd++
  } else same++

  // 기본 지정 — 섹션당 1개라 기존 기본을 먼저 해제한다(부분 유니크 인덱스)
  if (!cur?.is_default) {
    await db.from('plan_text_library').update({ is_default: false })
      .eq('section_key', sectionKey).eq('is_default', true)
    const { error } = await db.from('plan_text_library').update({ is_default: true }).eq('id', id!)
    if (error) console.log(`     ✗ 기본 지정 실패: ${error.message}`)
    else defSet++
  }
}

console.log(`\n신규 ${ins} · 갱신 ${upd} · 동일 ${same} · 기본지정 ${defSet}`)
if (APPLY) {
  const { data: after } = await db.from('plan_text_library')
    .select('section_key,title,is_default,version,body').eq('is_active', true).eq('title', TITLE)
  console.log('\n=== 적용 후 「기본 문구」 상태 ===')
  for (const r of (after ?? []).sort((a, b) => String(a.section_key).localeCompare(String(b.section_key)))) {
    const empty = JSON.stringify(r.body) === '{}' || JSON.stringify(r.body) === '[]'
    console.log(`  ${String(r.section_key).padEnd(18)} default=${r.is_default} v${r.version} ${empty ? '🚨빈칸' : '내용있음'}`)
  }
}
