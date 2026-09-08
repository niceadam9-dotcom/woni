/** 「불량사진」 시트 실 DB 왕복 (소방계획서_46 S4-7) — 1회성 조사 프로브
 *  실행: npx tsx --conditions=react-server scripts/_probe-46-realdb.mts [envFile]
 *
 *  합성 픽스처는 "코드가 스스로 만든 것"이라, 실제 버킷에 든 사진(휴대폰 EXIF·PNG 혼입·용량)이
 *  같은 경로를 통과하는지는 별개 축이다. 읽기 전용 — DB에 아무것도 쓰지 않는다.
 *  산출 xlsx/pdf는 **실고객 사진**을 담으므로 임시 폴더에만 쓰고 저장소에 커밋하지 않는다. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { buildDefectPhotoSheet, type DefectPhotoRow } from '../src/lib/defect-photo-embed.ts'
import { insertSheetAfter } from '../src/lib/xlsx-sheet-surgery.ts'
import { DEFECT_SHEET } from '../src/lib/xlsx-anchors.ts'

const envFile = process.argv[2] ?? '.env.local'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})\n`)

// ⚠ error를 함께 본다 — data만 보면 없는 컬럼 하나가 '조용한 0행'이 된다
const { data: rows, error } = await admin.from('inspection_defects')
  .select('inspection_id, defect_code, defect_name, defect_detail, action_taken, photo_url, after_photo_url')
  .or('photo_url.not.is.null,after_photo_url.not.is.null')
  .order('created_at', { ascending: true })
if (error) { console.error('조회 실패:', error.message); process.exit(1) }

const byInsp = new Map<string, DefectPhotoRow[]>()
for (const r of rows ?? []) {
  const arr = byInsp.get(r.inspection_id as string) ?? []
  arr.push(r as DefectPhotoRow)
  byInsp.set(r.inspection_id as string, arr)
}
console.log(`사진 달린 불량 ${rows?.length ?? 0}건 / 점검 ${byInsp.size}건`)
if (byInsp.size === 0) {
  console.log('\n⚠ 실 DB에 사진이 달린 불량이 0건 — 실왕복으로 판정할 표본이 없다.')
  console.log('  (합성 픽스처 66/0은 통과했다. 이 축은 표본이 생긴 뒤 다시 돌릴 것)')
  process.exit(2)
}

// 가장 사진이 많은 점검 건을 고른다 — 페이지 나눔까지 보려면 건수가 클수록 좋다
const [inspId, defects] = [...byInsp.entries()].sort((a, b) => b[1].length - a[1].length)[0]
console.log(`표본 점검 ${inspId} — 불량 ${defects.length}건`)

const template = new Uint8Array(readFileSync(join(root, 'templates/report-workbook-full.xlsx')))
const t0 = Date.now()
const built = await buildDefectPhotoSheet(admin, defects, template)
if (!built) { console.error('❌ 빌더가 null — 실 사진을 한 장도 못 실었다'); process.exit(1) }
const out = await insertSheetAfter(template, DEFECT_SHEET, built.part)
console.log(`\n임베드 ${built.photoCount}장 · ${Date.now() - t0}ms · ${(out.bytes.byteLength / 1024 / 1024).toFixed(2)}MB`)
console.log(`재번호 ${out.renumbered}건 · 삽입 index ${out.index}`)
if (built.notes.length) console.log(`고지: ${built.notes.join(' | ')}`)

const zip = await JSZip.loadAsync(out.bytes)
const sheet = await zip.file('xl/worksheets/sheetPhoto.xml')!.async('string')
const blocks = [...sheet.matchAll(/<row /g)].length / 3
// ⚠ 2026-09-08 3건/장 전환 — 여기 나눗수가 2로 남아 **쪽수를 과대 예측**하고 있었다.
// 규격은 defect-photo-embed의 DEFECTS_PER_PAGE가 정본이다(이 줄은 표시용 예측일 뿐).
console.log(`블록 ${blocks}건 → 예상 ${Math.ceil(blocks / 3)}쪽 (3건/장)`)

const dir = mkdtempSync(join(tmpdir(), 'realdb46-'))
const xlsx = join(dir, 'out.xlsx')
writeFileSync(xlsx, out.bytes)
console.log(`\n산출: ${xlsx}  (실고객 사진 포함 — 저장소에 옮기지 말 것)`)

if (process.argv.includes('--lo')) {
  execFileSync('C:\\Program Files\\LibreOffice\\program\\soffice.com',
    ['-env:UserInstallation=file:///' + dir.replace(/\\/g, '/') + '/lo', '--headless', '--norestore',
      '--convert-to', 'pdf', '--outdir', dir, xlsx], { timeout: 600_000 })
  const pdf = readFileSync(join(dir, 'out.pdf')).toString('latin1')
  console.log(`PDF 전체 ${[...pdf.matchAll(/\/Type\s*\/Page[^s]/g)].length}쪽 — ${join(dir, 'out.pdf')}`)
}
