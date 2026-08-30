/** S9-1 재생성 차단 — 규약 버전 축 가드 회귀 고정 (소방계획서_23 S9-1 재설계, 2026-08-21 사용자 확정).
 *  DB·서버 불필요, 결정적. 실행: npx tsx scripts/test-regen-protocol.mts
 *
 *  지키는 규칙(사용자 확정 2건 포함):
 *   · legacy_na(구규약 확정)      → 응답 유무와 무관하게 차단
 *   · NULL(미상) + 응답 있음      → 차단 (결정 1: 차단이 기본 — 보관함 원본 사용)
 *   · NULL(미상) + 응답 0         → 허용 (왜곡될 기존 입력이 없다 — 첫 입력이 규약을 스탬프)
 *   · blank_unanswered(신규약)    → 허용
 *  종전 날짜 축(CUTOFF)은 폐지 — 실시일≠입력일이라 어떤 날짜를 넣어도 어긋났고,
 *  실제로 2026-08-18 기입이 전건 차단(26/26·8/8)을 냈다. 날짜 상수의 부활 자체를 막는다. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isRegenBlocked, CURRENT_SHEET_PROTOCOL } from '../src/lib/annex-regen-policy.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `  ${extra}`}`); ok ? pass++ : fail++
}

console.log('── 1) 판정 4상태 × 응답 유무')
check('legacy_na + 응답 0 → 차단 (구규약 확정은 응답과 무관)',
  isRegenBlocked({ sheetProtocol: 'legacy_na', respondedCount: 0 }) === true)
check('legacy_na + 응답 있음 → 차단',
  isRegenBlocked({ sheetProtocol: 'legacy_na', respondedCount: 42 }) === true)
check('미상(null) + 응답 있음 → 차단 (결정 1 — 보수적)',
  isRegenBlocked({ sheetProtocol: null, respondedCount: 1 }) === true)
check('미상(null) + 응답 0 → 허용 (왜곡될 입력이 없다)',
  isRegenBlocked({ sheetProtocol: null, respondedCount: 0 }) === false)
check('blank_unanswered + 응답 있음 → 허용',
  isRegenBlocked({ sheetProtocol: 'blank_unanswered', respondedCount: 42 }) === false)
check('blank_unanswered + 응답 0 → 허용',
  isRegenBlocked({ sheetProtocol: 'blank_unanswered', respondedCount: 0 }) === false)

console.log('\n── 2) 스탬프·DEFAULT 정합 — 상수가 갈리면 스탬프와 가드가 서로 다른 규약을 본다')
check("CURRENT_SHEET_PROTOCOL === 'blank_unanswered' (149 DB DEFAULT와 동일해야 한다)",
  CURRENT_SHEET_PROTOCOL === 'blank_unanswered')
{
  // 마이그레이션 149의 DEFAULT 값과 축자 대조 — SQL이 바뀌면 여기서 잡힌다
  const raw = readFileSync(path.join(import.meta.dirname, '..', 'supabase', 'migrations', '149_sheet_protocol.sql'), 'utf8')
  // 주석을 걷어내고 실 SQL만 검사한다 — 주석의 'ADD COLUMN ... DEFAULT' 경고 문구가 걸리면 안 된다
  const sql = raw.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n')
  check('149 SQL의 DEFAULT가 상수와 일치', sql.includes(`SET DEFAULT '${CURRENT_SHEET_PROTOCOL}'`))
  check('149 SQL이 ADD COLUMN → SET DEFAULT 순서 (기존 행 자동 백필 금지)',
    sql.indexOf('ADD COLUMN') < sql.indexOf('SET DEFAULT')
    && !/ADD COLUMN[^;]*DEFAULT/s.test(sql))
  check('149 CHECK에 두 값만', sql.includes("('legacy_na', 'blank_unanswered')"))
}

console.log('\n── 3) 날짜 축 부활 금지 — CUTOFF 상수가 다시 생기면 전건 차단 사고의 급소가 돌아온다')
{
  const policy = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'annex-regen-policy.ts'), 'utf8')
  check('REGEN_POLICY_CUTOFF 상수 없음', !policy.includes('REGEN_POLICY_CUTOFF'))
  check('가드가 날짜 필드를 읽지 않음', !policy.includes('inspection_end_date') && !policy.includes('inspection_start_date'))
}

console.log('\n── 4) 스탬프 배선 — 점검표 쓰기 액션 전부가 첫 입력 스탬프를 단다 (결정 2)')
{
  const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'app', '(dashboard)', 'inspections', 'sheet-actions.ts'), 'utf8')
  const stamps = (src.match(/await stampSheetProtocol\(/g) ?? []).length
  // NA release·NA apply·bulkGood·save·bulkAllGood·copyPrevious = 6곳. 줄면 어느 경로가 스탬프를 잃은 것.
  check(`stampSheetProtocol 호출 6곳 (실제 ${stamps})`, stamps === 6)
  check('스탬프는 IS NULL 조건 — 확정값(legacy_na 포함)을 절대 덮지 않는다',
    /stampSheetProtocol[\s\S]{0,400}?\.is\('sheet_protocol', null\)/.test(src))
  check('confirmSheetProtocolAction — 관리자 검사 존재', /confirmSheetProtocolAction[\s\S]{0,300}?role !== 'admin'/.test(src))
  check('confirm도 IS NULL 조건 (legacy_na를 뒤집을 수 없다)',
    /confirmSheetProtocolAction[\s\S]{0,900}?\.is\('sheet_protocol', null\)/.test(src))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exitCode = fail ? 1 : 0
