// 변이 프로브 — [표지 사진 가져오기] 축(2026-09-14 B안)의 단언이 실제로 "무는지" 본다.
//
// 왜 필요한가: test-image-slot.mts가 34/0 초록이라는 사실은 "무언가를 잡는다"만 말해 줄 뿐
// "이것을 잡는다"를 말해 주지 않는다. 제품을 되돌리는 변이를 심어 **빨강이 되는지**,
// 그것도 **의도한 단언이** 빨강이 되는지 확인한다.
//
// 실행: node scripts/_mutate-route-cover.mjs   (dev 서버 + 스테이징 DB 필요)
//
// 🚨 치환이 조용히 빗나가면(공백·줄바꿈 차이) 제품이 멀쩡한 채로 돌아 "초록 → 변이를 못 잡았다"로
//    오독하게 된다. 그래서 from 문자열이 없으면 **그 자리에서 죽인다**(건너뛰기 금지).
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ACTIONS = 'src/app/(dashboard)/customers/fire-route-actions.ts'
const FORM = 'src/components/customers/plan-form13.tsx'

/** expect = 이 변이로 빨강이 되어야 하는 단언 이름의 일부 (그 단언이 물어야 의미가 있다) */
const MUTANTS = [
  {
    name: 'M1 복사가 아니라 참조 — 표지 자산 경로를 그대로 경로도로 쓴다',
    file: ACTIONS,
    from: '  const ext = (cover.path.split(\'.\').pop() ?? \'png\').toLowerCase()',
    to: '  return { path: cover.path }\n  const ext = (cover.path.split(\'.\').pop() ?? \'png\').toLowerCase()',
    expect: 'plan-assets 아래 새 파일로 들어옴',
  },
  {
    name: 'M2 경로는 맞는데 내용이 표지가 아니다 — 빈 바이트를 올린다',
    file: ACTIONS,
    from: '  const { error } = await admin.storage.from(ASSET_BUCKET).copy(cover.path, path)',
    to: '  const { error } = await admin.storage.from(ASSET_BUCKET)\n    .upload(path, Buffer.from(\'not-the-cover\'), { contentType: \'image/png\' })',
    expect: '바이트까지 같다',
  },
  {
    name: 'M3 새 바탕에 옛 원본·옛 좌표가 따라온다 — 초기화 누락',
    file: FORM,
    from: '    patchFa({ routeImage: next, routeImageBase: null, routeAnnots: null })',
    to: '    patchFa({ routeImage: next })',
    expect: '옛 원본(routeImageBase)이 따라오지 않음',
  },
  {
    name: 'M4 갈아끼우면서 옛 파일을 안 치운다 — 스토리지 고아',
    file: FORM,
    from: '    for (const p of stale) await deletePlanAssetAction(customerId, p)',
    to: '    void stale',
    expect: '두 파일을 함께 치웠다',
  },
  {
    name: 'M5 버튼을 경로 조회 ternary 안으로 되돌린다 — 소방서를 골라야만 보인다',
    file: FORM,
    from: '            <button type="button" onClick={() => { void applyCoverPhoto() }} disabled={routeBusy !== \'\'}',
    to: '            {route && <button type="button" onClick={() => { void applyCoverPhoto() }} disabled={routeBusy !== \'\'}',
    to2: { from: '              {routeBusy === \'cover\' ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />} 표지 사진 가져오기\n            </button>', to: '              {routeBusy === \'cover\' ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />} 표지 사진 가져오기\n            </button>}' },
    expect: '경로 조회 전에도 보인다',
  },
]

// MUT=M5 처럼 골라 돌릴 수 있다 — 한 축만 고친 뒤 전량 재주행(≈10분)을 피하려고
const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

let caught = 0
for (const m of TARGETS) {
  const edits = [{ file: m.file, from: m.from, to: m.to }]
  if (m.to2) edits.push({ file: m.file, from: m.to2.from, to: m.to2.to })

  const originals = new Map()
  for (const e of edits) {
    if (!originals.has(e.file)) originals.set(e.file, readFileSync(e.file, 'utf8'))
  }
  try {
    for (const e of edits) {
      const cur = readFileSync(e.file, 'utf8')
      if (!cur.includes(e.from)) {
        throw new Error(`치환 대상을 못 찾음 (${e.file}) — 변이가 적용되지 않았다:\n${e.from}`)
      }
      writeFileSync(e.file, cur.replace(e.from, e.to))
    }

    let out = ''
    let failed = false
    try {
      out = execSync('npx tsx scripts/test-image-slot.mts', { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const redLines = out.split('\n').filter(l => l.includes('❌'))
    const hitExpected = redLines.some(l => l.includes(m.expect))
    if (failed && hitExpected) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${redLines.map(l => l.trim()).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${redLines.map(l => l.trim()).join(' | ') || '(❌ 줄 없음 — 스위트가 중간에 죽었다)'}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text)
  }
}

console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
