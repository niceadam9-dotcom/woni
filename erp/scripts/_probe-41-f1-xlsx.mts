/** 소방계획서_41 F-1(엑셀 축) — 「현5」 불량내용 자동 문구의 **조판** 육안 + 「계획서!H」 전파.
 *
 *  범위를 좁힌 이유: 값 정확성은 이미 기계 검사로 닫혀 있다(test-defect-fold [3] 7단언 =
 *  buildWorkbookValues fold 분기 · test-xlsx-inject 189/0 = 계획서!H 단일참조 폐포).
 *  남은 물음은 **조판**뿐이다 — 그 문구가 칸에 제대로 앉는가, 계획서!H가 그 값을 받아 찍는가.
 *  그래서 워크북 라우트 전체(도너 시트 수술·사진 대지·목차 재작성)를 재현하지 않는다.
 *  재현하면 그만큼 **내 재현본을 검증하는 꼴**이 되어 판정이 흐려진다.
 *
 *  ① 운영 데이터로 fold를 실제로 돌리고 ② **제품의 injectWorkbook·앵커**로 현5에 주입한 뒤
 *  ③ LibreOffice로 PDF를 굽는다. 계획서!H는 템플릿의 수식이라 LO가 재계산해 찍는다
 *  (= 전파가 육안으로 확인된다). 래스터화는 _tmp-f1-raster.mts가 이어받는다.
 *
 *  ⚠ 이것은 라우트 산출물이 아니다 — 시트 선별·사진 대지·목차 재작성이 빠져 있다.
 *    보는 것은 **현5·계획서 두 시트의 칸 조판**이며 그 범위에서만 유효하다.
 *  🚨 산출물에 운영 실데이터가 들어간다 — 커밋 금지, 확인 후 삭제.
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-41-f1-xlsx.mts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'
import { assembleReport9 } from '../src/lib/report9-assemble.ts'
import { foldDefectGroups, DEFECT_GROUPS, DEFECT_FOLD_TEXT } from '../src/lib/doc-templates/report9.ts'
import { injectWorkbook, type InjectTarget } from '../src/lib/xlsx-inject.ts'
import { DEFECT_SHEET, DEFECT_GROUP_ROWS, PLAN_DATE_ROWS } from '../src/lib/xlsx-anchors.ts'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
// ⚠ assembleReport9 안쪽(sheet-catalog)이 자기 admin 클라이언트를 process.env로 만든다
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (env[k]) process.env[k] = env[k]
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const INSPECTION_ID = 'ad19e760-9fab-49a3-9856-0b15db3b6043'   // 승리주유소 2026 자체점검
const CUSTOMER_ID = (await db.from('inspections').select('customer_id').eq('id', INSPECTION_ID).single()).data?.customer_id as string
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL}\n점검 ${INSPECTION_ID}\n`)

const { data } = await assembleReport9(db as never, CUSTOMER_ID, INSPECTION_ID)
if (!data.applicableGroups) { console.log('❌ applicableGroups 미공급 — fold 미발동. 육안 의미 없음.'); process.exit(1) }
const folds = foldDefectGroups(data.defectRows, data.applicableGroups)

console.log('[1] fold 상태 (8쪽 PDF와 같은 원천)')
for (const g of DEFECT_GROUPS) console.log(`    ${g.padEnd(8, ' ')} -> ${folds.get(g)?.kind}`)

// 현5 주입 타깃 — 제품 앵커(DEFECT_GROUP_ROWS)를 그대로 쓴다
const targets: InjectTarget[] = []
for (const { group, row } of DEFECT_GROUP_ROWS) {
  const f = folds.get(group)
  if (!f) continue
  if (f.kind === 'rows') {
    const kept = f.rows ?? []
    targets.push({ sheet: DEFECT_SHEET, cell: `B${row}`, value: kept.length ? kept.map(r => r.code).join('\n') : null })
    targets.push({ sheet: DEFECT_SHEET, cell: `C${row}`, value: kept.length ? kept.map(r => r.content).join('\n') : null })
  } else {
    targets.push({ sheet: DEFECT_SHEET, cell: `B${row}`, value: null })
    targets.push({ sheet: DEFECT_SHEET, cell: `C${row}`, value: DEFECT_FOLD_TEXT[f.kind] })
  }
}
console.log(`\n[2] 주입 타깃 ${targets.length}칸 (현5 B/C x 7구분)`)
console.log(`    계획서 대응행(전파 확인용) = ${PLAN_DATE_ROWS.map(p => `H${p.row}`).join(' ')}`)

// 라우트와 같은 자산(route.ts: join(cwd,'templates','report-workbook-full.xlsx'))
const TPL = new URL('../templates/report-workbook-full.xlsx', import.meta.url)
if (!existsSync(TPL)) { console.log(`❌ 템플릿 없음: ${TPL.pathname}`); process.exit(1) }
const template = new Uint8Array(readFileSync(TPL))
const result = await injectWorkbook(template, targets)
if (result.missed.length) { console.log(`❌ 미발견 칸: ${result.missed.join(', ')}`); process.exit(1) }
console.log(`[3] 주입 완료 — missed 0`)

const outDir = new URL('./_f1x/', import.meta.url).pathname.replace(/^\//, '')
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true })

// ⚠ 처음엔 현5·계획서만 남기려고 removeSheets로 65장을 제거했는데, LibreOffice가
//   **「source file could not be loaded」로 통째로 거부**했다(대량 제거가 워크북을 깨뜨린다.
//   라우트가 쓰는 도너 시트 제거는 범위가 훨씬 좁아 이 부류에 안 걸린다).
//   -> 전체 워크북 그대로 굽고 쪽을 찾는 쪽으로 되돌렸다. 제품 경로에 더 가깝기도 하다.
const xlsx = `${outDir}/full.xlsx`
writeFileSync(xlsx, result.bytes)
console.log(`[4] xlsx(전체 67시트) -> ${xlsx}`)

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
if (!existsSync(SOFFICE)) { console.log(`❌ soffice 없음: ${SOFFICE}`); process.exit(1) }
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, xlsx],
  { timeout: 600_000, stdio: 'inherit' })
console.log(`[5] pdf 생성 -> ${outDir}/full.pdf`)

/* ── 여기서부터 육안 절차(2026-09-08 실행 기록) ─────────────────────────────────
 * 전체 워크북 pdf는 72쪽이라 눈으로 찾기 어렵다. 두 단계로 좁혔다:
 *
 * ① **시트를 지우지 말고 숨긴다.** xl/workbook.xml의 <sheet .../>에 state="hidden"을 얹어
 *    현5·계획서만 남기면 LO가 보이는 시트만 내보낸다(72쪽 → 10쪽). activeTab도 현5로 옮긴다.
 *    removeSheets로 65장을 지우는 방식은 LO가 「source file could not be loaded」로 거부했다.
 *    hidden은 시트와 참조를 그대로 두므로 **계획서!H의 `=현5!C4` 수식이 살아 있다** — 전파를
 *    육안으로 보려면 이게 필수다.
 * ② **pdf를 쪽별로 가른 뒤** png로 굽는다(pdf-lib로 분할 → LO로 쪽당 변환).
 *    LO의 png 내보내기는 PageRange를 조용히 무시해 늘 1쪽만 나온다.
 *    ⚠ execFileSync에 shell:true를 주면 'C:\Program Files\...'가 'C:\Program'으로 깨진다.
 *
 * 관측(승리주유소 2026): 현5 = p06, 계획서(별지10호 이행계획서) = p10.
 *   세 표면(PDF 8쪽 · 현5 · 계획서!H)의 문구가 전부 일치.
 *   ⚠ 색은 갈린다 — 현5만 빨강. 측정으로 확인: 주입 전후 셀 스타일 인덱스가 s="337"로 동일하고
 *     그 fontId=57이 <color rgb="FFFF0000"/>다. **템플릿 원래 스타일이지 41이 만든 게 아니다.**
 *   ⚠ 이 프로브는 현5 B/C만 주입한다 — 다른 칸의 `0`·「1899년 12월 30일」은 **미주입 산물**이지
 *     제품 결함이 아니다(라우트는 그 칸들도 채운다). 판정 범위를 넘겨 읽지 말 것.
 * ────────────────────────────────────────────────────────────────────────────── */
