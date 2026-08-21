/** F-1 Phase 1 — 고시 별지4 정본 추출본에서 누락 시트 7종의 항목을 축자 추출 → JSON + 마이그레이션 SQL 생성.
 *
 *  원천: erp_goal/_form/_별지4호_현행판_추출.txt (137이 쓴 정본 — MD 파생본 금지 규칙).
 *  대상: 6 물분무 · 7 미분무 · 8 포 · 12 분말 · 18 누전경보기 · 24 제연(=ERP 거실제연설비) · 30 연소방지.
 *  5(조기진압)·10(할론)은 원문상 독립 시트지만 현행 묶음 매핑으로 이미 입력 가능 — 기존 데이터 연속성
 *  때문에 이번 범위에서 제외. 강화액·고체에어로졸은 고시에 점검표가 없어 제외(사실만 보고).
 *
 *  형식(추출본 실측): 시트 제목 'N. 설비명 점검표' → 그룹마다 [머리 'N-X. 제목'] → 코드 줄들('N-X-001')
 *  → 항목 줄들('● …'=종합전용 / '○ …'). 머리와 첫 코드가 한 줄에 붙는 경우('25-H. 제어반25-H-001') 있음.
 *  k번째 코드 = k번째 ●/○ 줄. 그룹 안에서 #코드 ≠ #항목이면 **생성을 멈추고** 원문 조각을 그대로 찍는다
 *  (법정 점검표 — 어긋난 채 만들면 현장이 틀린 항목으로 점검한다).
 *
 *  실행: npx tsx scripts/_extract-annex4-missing-sheets.mts
 *  산출: scripts/_out/f1-sheets.json · supabase/migrations/148_missing_std_sheets.sql */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(import.meta.dirname, '..', '..', 'erp_goal', '_form', '_별지4호_현행판_추출.txt')
const lines = readFileSync(SRC, 'utf8').split(/\r?\n/)

/** 대상 시트 — sheetName은 원문 축자, facility는 ERP 표준 42종 어휘(매핑 키가 아니라 facility_type·주석용) */
const TARGETS: Array<{ num: number; facility: string }> = [
  { num: 6, facility: '물분무소화설비' },
  { num: 7, facility: '미분무소화설비' },
  { num: 8, facility: '포소화설비' },
  { num: 12, facility: '분말소화설비' },
  { num: 18, facility: '누전경보기' },
  { num: 24, facility: '거실제연설비' },
  { num: 30, facility: '연소방지설비' },
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
  // 끝 = 다음 'M. … 점검표'(본문이든 뭐든) 또는 EOF
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
      // 머리 뒤에 코드가 붙는 경우('25-H. 제어반25-H-001') — 이름은 첫 코드 앞까지
      const rest = gh[3]
      const glued = [...rest.matchAll(codeRe)].map(m => m[0])
      const name = (glued.length ? rest.slice(0, rest.indexOf(glued[0])) : rest).trim()
      g = { code: gh[1], name, order: gh[2].charCodeAt(0) - 64 }
      codes.push(...glued)
      continue
    }
    if (!g) continue   // 시트 머리(번호/점검항목/점검결과 등) 구간

    // 대괄호 소제목 — [펌프방식] 등. 같은 그룹 안에서 이후 항목에 귀속
    const br = /^\[(.+)\]\s*$/.exec(raw)
    if (br) { subCount += 1; sub = { name: br[1].trim(), order: subCount }; continue }

    const cs = [...raw.matchAll(codeRe)].map(m => m[0])
    if (cs.length && !/^[●○]/.test(raw)) { codes.push(...cs); continue }

    if (/^[●○]/.test(raw)) {
      texts.push({ name: raw.slice(1).trim(), comp: raw[0] === '●', sub: sub.name, subOrder: sub.order })
      continue
    }
    // 그 외(※ 각주·표 꼬리 등) — 항목으로 넣지 않되 흔적을 남긴다
    warnings.push(`${t.num}번 ${g.code} 미분류 줄 무시: "${raw.slice(0, 60)}"`)
  }
  flushGroup('시트 끝')
  sheets.push({ num: t.num, sheetName: title, facility: t.facility, items })
}

mkdirSync(path.join(import.meta.dirname, '_out'), { recursive: true })
writeFileSync(path.join(import.meta.dirname, '_out', 'f1-sheets.json'), JSON.stringify(sheets, null, 2), 'utf8')

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

// ── SQL 생성 — 137 선례(DO 블록·블록 단위 재실행 가드·축자 VALUES) ──
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
    RAISE NOTICE '148 스킵 — STD-${String(s.num).padStart(2, '0')} 이미 존재(재실행)';
    RETURN;
  END IF;
  INSERT INTO inspection_sheets (sheet_code, sheet_name, version, description, is_active)
  VALUES ('STD-${String(s.num).padStart(2, '0')}', '${esc(s.sheetName)}', 'v2025',
          '소방시설 자체점검사항 등에 관한 고시 별지4 — ${s.num}번 점검표 (148 편입)', true)
  RETURNING id INTO v_sheet;

  INSERT INTO inspection_sheet_items
    (sheet_id, item_code, item_name, facility_type, order_num, comprehensive_only,
     group_code, group_name, group_order, subgroup_name, subgroup_order)
  VALUES
${rows};
END $$;`
}).join('\n\n')

const header = `-- 148: 고시 별지4 누락 점검표 7종 편입 (2026-08-21, 소방계획서_26 F-1)
--
-- 왜: 표준 42종 중 9종이 어느 시트에도 덮이지 않아 점검 결과(○×)를 만들 방법이 없었고,
-- 별지 4호 1쪽·9호 3쪽 결과칸이 영구 공란이었다(서림사·별그리다 공란의 주원인).
-- STD 시트 코드 = 고시 설비번호인데 6·7·8·12·18·24·30 자리가 시딩에서 빠져 있었다
-- (원천이던 회사 XLS에 그 탭이 없었던 것 — 시트·항목 잔존 0건 실측, _recon-f1-db-state).
--
-- 문구는 erp_goal/_form/_별지4호_현행판_추출.txt 축자(●/○ 불릿 제외 — comprehensive_only가 원천,
-- 기존 860건·137과 동일 규약). ● = 종합점검 전용(true). 3층 축(group_*·subgroup_*)은 134 규약.
-- 생성기: scripts/_extract-annex4-missing-sheets.mts (그룹별 #코드=#항목 자기검증 통과분만 출력).
--
-- 제외: 5(화재조기진압용)·10(할론)은 원문상 독립 시트지만 현행 묶음 매핑(스프링클러·할로겐 시트)으로
-- 이미 입력 가능 — 기존 응답 데이터 연속성 때문에 유지. 강화액·고체에어로졸은 고시에 점검표가 없다
-- (원문 등장 0회) — 억지로 만들면 법정 서식 위조라 제외, 1.4 패널이 사실을 안내한다.
--
-- 재실행 안전: 시트 존재 여부로 블록 단위 게이트(137 선례).

`
writeFileSync(path.join(import.meta.dirname, '..', 'supabase', 'migrations', '148_missing_std_sheets.sql'),
  header + sqlSheets + '\n', 'utf8')
console.log(`\nSQL 생성: supabase/migrations/148_missing_std_sheets.sql (시트 ${sheets.length} · 항목 ${sheets.reduce((n, s) => n + s.items.length, 0)})`)
