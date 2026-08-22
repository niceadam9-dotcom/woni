/** F-1f — 고시 별지4 정본 추출본에서 5(조기진압)·10(할론) 전용 점검표를 축자 추출 → JSON + 마이그레이션 150 생성.
 *
 *  148 생성기(_extract-annex4-missing-sheets.mts)의 복제·개조 — 파서·자기검증(그룹별 #코드=#항목) 동일.
 *  148에서 이 둘을 제외했던 이유(기존 응답 데이터 연속성)는 **이중 귀속 매핑**으로 해소한다:
 *  전용 시트를 신설하되 SHEET_FACILITY_MAP의 레거시 간선(스프링클러→조기진압, 할로겐→할론)을
 *  롤업 전용으로 남겨 과거 회차 응답의 귀속을 유지한다(sheet-facility-map.ts LEGACY_ROLLUP_MAP).
 *
 *  근거(2026-08-22 실측, _recon-f1f-item-delta.mts): 묶음 시트에 없는 전용 문항이
 *  조기진압 14/73·할론 16/53 — 문항 정합은 묶음 유지로는 처리 불가.
 *
 *  실행: npx tsx scripts/_extract-annex4-f1f-sheets.mts
 *  산출: scripts/_out/f1f-sheets.json · supabase/migrations/150_f1f_dedicated_sheets.sql */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(import.meta.dirname, '..', '..', 'erp_goal', '_form', '_별지4호_현행판_추출.txt')
const lines = readFileSync(SRC, 'utf8').split(/\r?\n/)

/** 대상 시트 — sheetName은 원문 축자, facility는 ERP 표준 42종 어휘(facility_type·주석용) */
const TARGETS: Array<{ num: number; facility: string }> = [
  { num: 5, facility: '화재조기진압용 스프링클러설비' },
  { num: 10, facility: '할론소화설비' },
]

type Item = {
  item_code: string; item_name: string; comprehensive_only: boolean
  group_code: string; group_name: string; group_order: number
  subgroup_name: string | null; subgroup_order: number | null
  order_num: number
}
type Sheet = { num: number; sheetName: string; facility: string; items: Item[] }

/** 본문 시작줄 — 'N. … 점검표' 중 뒤따르는 60줄 안에 N-A-001이 있는 발생(앞쪽 발생은 목차) */
function bodyStart(num: number): { line: number; title: string } {
  const re = new RegExp(`^${num}\\. (.+) 점검표\\s*$`)
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    const window = lines.slice(i + 1, i + 61).join('\n')
    if (window.includes(`${num}-A-001`)) return { line: i, title: m[1].trim() }
  }
  throw new Error(`${num}번 점검표 본문을 찾지 못함`)
}

const NOISE = [
  /^\s*$/, /^번호\s*$/, /^점검항목\s*$/, /^점검결과\s*$/, /^비고\s*$/,
  /^210mm×297mm/, /^\(\d+쪽 중 \d+쪽\)\s*$/, /^\[백상지/,
]
const isNoise = (s: string) => NOISE.some(re => re.test(s))

const sheets: Sheet[] = []
const warnings: string[] = []

for (const t of TARGETS) {
  const { line: start, title } = bodyStart(t.num)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\d+\. .+ 점검표\s*$/.test(lines[i])) { end = i; break }
  }

  const items: Item[] = []
  let g: { code: string; name: string; order: number } | null = null
  let codes: string[] = []
  let sub: { name: string | null; order: number | null } = { name: null, order: null }
  let subCount = 0
  let texts: Array<{ name: string; comp: boolean; sub: string | null; subOrder: number | null }> = []
  let order = 0

  const flushGroup = (where: string) => {
    if (!g) return
    if (codes.length !== texts.length) {
      throw new Error(`${t.num}번 ${g.code} 코드 ${codes.length} ≠ 항목 ${texts.length} (${where})\n` +
        `codes: ${codes.join(', ')}\ntexts:\n${texts.map(x => `  ${x.comp ? '●' : '○'} ${x.name}`).join('\n')}`)
    }
    for (let k = 0; k < codes.length; k++) {
      order += 1
      items.push({
        item_code: codes[k], item_name: texts[k].name, comprehensive_only: texts[k].comp,
        group_code: g.code, group_name: g.name, group_order: g.order,
        subgroup_name: texts[k].sub, subgroup_order: texts[k].subOrder, order_num: order,
      })
    }
    codes = []; texts = []; sub = { name: null, order: null }; subCount = 0
  }

  const groupHead = new RegExp(`^(${t.num}-([A-Z]))\\.\\s*(.*)$`)
  const codeRe = new RegExp(`${t.num}-[A-Z]-\\d{3}`, 'g')

  for (let i = start + 1; i < end; i++) {
    const raw = lines[i].trim()
    if (isNoise(raw)) continue

    const gh = groupHead.exec(raw)
    if (gh) {
      flushGroup(`다음 그룹 ${gh[1]} 직전`)
      const rest = gh[3]
      const glued = [...rest.matchAll(codeRe)].map(m => m[0])
      const name = (glued.length ? rest.slice(0, rest.indexOf(glued[0])) : rest).trim()
      g = { code: gh[1], name, order: gh[2].charCodeAt(0) - 64 }
      codes.push(...glued)
      continue
    }
    if (!g) continue

    const br = /^\[(.+)\]\s*$/.exec(raw)
    if (br) { subCount += 1; sub = { name: br[1].trim(), order: subCount }; continue }

    const cs = [...raw.matchAll(codeRe)].map(m => m[0])
    if (cs.length && !/^[●○]/.test(raw)) { codes.push(...cs); continue }

    if (/^[●○]/.test(raw)) {
      texts.push({ name: raw.slice(1).trim(), comp: raw[0] === '●', sub: sub.name, subOrder: sub.order })
      continue
    }
    warnings.push(`${t.num}번 ${g.code} 미분류 줄 무시: "${raw.slice(0, 60)}"`)
  }
  flushGroup('시트 끝')

  // ── 고시 원문 번호 오기 보정(5번 한정) ─────────────────────────────────
  // 원문은 5-L-001을 **두 번** 부여한다: 제어반 그룹 직속 '겸용…' 항목과 [감시제어반] 첫 항목
  // (hwp 추출본·XML 정본 양쪽 실측 2026-08-22. 3번 시트는 겸용=001·감시제어반=011~라 충돌 없음 —
  // 5번만 감시제어반이 001부터 다시 시작한다). DB·응답 키(item_code)는 유일해야 하므로
  // 첫 등장(겸용)을 5-L-000으로 재부여한다 — 번호 오름차순 인쇄 순서(000,001..011,021,031)가
  // 유지되는 최소 개입. **문구는 축자 유지**, 어긋남은 이 1곳뿐이며 프로브가 양방향 단언한다.
  // 원문이 개정돼 중복이 사라지면 이 보정은 성립하지 않아야 한다 — 전제부터 단언.
  if (t.num === 5) {
    const dups = items.filter(i => i.item_code === '5-L-001')
    if (dups.length !== 2 || !dups[0].item_name.startsWith('겸용')) {
      throw new Error(`5-L-001 중복 전제 깨짐 — ${dups.length}건: ${dups.map(d => d.item_name.slice(0, 20)).join(' / ')}`)
    }
    dups[0].item_code = '5-L-000'
  }
  const uniq = new Set(items.map(i => i.item_code))
  if (uniq.size !== items.length) {
    throw new Error(`${t.num}번 item_code 중복 잔존: ${items.length - uniq.size}건`)
  }

  sheets.push({ num: t.num, sheetName: title, facility: t.facility, items })
}

mkdirSync(path.join(import.meta.dirname, '_out'), { recursive: true })
writeFileSync(path.join(import.meta.dirname, '_out', 'f1f-sheets.json'), JSON.stringify(sheets, null, 2), 'utf8')

console.log('=== 추출 결과')
for (const s of sheets) {
  const comp = s.items.filter(i => i.comprehensive_only).length
  const groups = [...new Set(s.items.map(i => i.group_code))]
  console.log(`  ${String(s.num).padStart(2)}. ${s.sheetName} — ${s.items.length}항목 (● ${comp}) · 그룹 ${groups.length} (${groups[0]}~${groups[groups.length - 1]})`)
}
if (warnings.length) {
  console.log(`\n⚠ 미분류 줄 ${warnings.length}건:`)
  for (const w of warnings.slice(0, 20)) console.log('  ' + w)
}

// ── SQL 생성 — 137·148 선례(DO 블록·블록 단위 재실행 가드·축자 VALUES) ──
const esc = (s: string) => s.replace(/'/g, "''")
const sqlSheets = sheets.map(s => {
  const rows = s.items.map(i =>
    `    (v_sheet, '${i.item_code}', '${esc(i.item_name)}', '${esc(s.facility)}', ${i.order_num}, ${i.comprehensive_only}, ` +
    `'${i.group_code}', '${esc(i.group_name)}', ${i.group_order}, ` +
    `${i.subgroup_name ? `'${esc(i.subgroup_name)}'` : 'NULL'}, ${i.subgroup_order ?? 'NULL'})`).join(',\n')
  return `-- ── ${s.num}. ${s.sheetName} 점검표 — ${s.items.length}항목 (ERP 설비: ${s.facility}) ──
DO $$
DECLARE
  v_sheet uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM inspection_sheets WHERE sheet_code = 'STD-${String(s.num).padStart(2, '0')}' AND version = 'v2025') THEN
    RAISE NOTICE '150 스킵 — STD-${String(s.num).padStart(2, '0')} 이미 존재(재실행)';
    RETURN;
  END IF;
  INSERT INTO inspection_sheets (sheet_code, sheet_name, version, description, is_active)
  VALUES ('STD-${String(s.num).padStart(2, '0')}', '${esc(s.sheetName)}', 'v2025',
          '소방시설 자체점검사항 등에 관한 고시 별지4 — ${s.num}번 점검표 (150 편입, F-1f 이중 귀속 분리)', true)
  RETURNING id INTO v_sheet;

  INSERT INTO inspection_sheet_items
    (sheet_id, item_code, item_name, facility_type, order_num, comprehensive_only,
     group_code, group_name, group_order, subgroup_name, subgroup_order)
  VALUES
${rows};
END $$;`
}).join('\n\n')

const header = `-- 150: 조기진압(5)·할론(10) 전용 점검표 편입 (2026-08-22, 소방계획서_26 F-1f)
--
-- 왜: 148은 이 둘을 제외했다 — 묶음 매핑(스프링클러·할로겐 시트)으로 이미 입력 가능했고
-- 기존 응답 재귀속이 필요해 보였기 때문. 그러나 실측(_recon-f1f-item-delta.mts)에서
-- 묶음 시트에 없는 전용 문항이 조기진압 14/73·할론 16/53으로 확인됐다 — 묶음 유지로는
-- 고시가 요구하는 문항의 19~30%를 점검표에 담을 수 없다(문항 정합 처리 지점이 없다).
--
-- 재귀속은 하지 않는다(이중 귀속) — 코드의 SHEET_FACILITY_MAP은 전용 시트를 신설하되
-- 레거시 간선(스프링클러 시트→조기진압, 할로겐 시트→할론)을 **롤업 전용**으로 남긴다
-- (LEGACY_ROLLUP_MAP). 과거 회차가 묶음 시트에 남긴 응답(스테이징 서림사 2026 완료 회차
-- 27건 실측)의 별지 3쪽 귀속이 그대로 유지되고, 신규 입력만 전용 시트로 간다.
-- 운영 DB는 조기진압·할론 설치 0곳 실측(2026-08-22) — 적용 시점 영향 없음.
--
-- 문구는 erp_goal/_form/_별지4호_현행판_추출.txt 축자(●/○ 불릿 제외 — comprehensive_only가 원천,
-- 기존 860건·137·148과 동일 규약). ● = 종합점검 전용(true). 3층 축(group_*·subgroup_*)은 134 규약.
--
-- ⚠ 번호 어긋남 1곳(의도된 보정): 고시 5번 원문은 5-L-001을 두 번 부여한다(제어반 직속 '겸용…'
-- 항목과 [감시제어반] 첫 항목 — hwp 추출본·XML 정본 양쪽 실측). item_code는 응답의 키라 유일해야
-- 하므로 첫 등장(겸용)을 5-L-000으로 재부여했다. 문구는 축자 그대로이며, 000,001..011,021,031
-- 오름차순이 유지되는 최소 개입이다. 3번 시트(겸용=001·감시제어반=011~)와 달리 5번만 충돌한다.
--
-- 생성기: scripts/_extract-annex4-f1f-sheets.mts (그룹별 #코드=#항목 자기검증 통과분만 출력).
-- 재실행 안전: 시트 존재 여부로 블록 단위 게이트(137·148 선례).

`
writeFileSync(path.join(import.meta.dirname, '..', 'supabase', 'migrations', '150_f1f_dedicated_sheets.sql'),
  header + sqlSheets + '\n', 'utf8')
console.log(`\nSQL 생성: supabase/migrations/150_f1f_dedicated_sheets.sql (시트 ${sheets.length} · 항목 ${sheets.reduce((n, s) => n + s.items.length, 0)})`)
