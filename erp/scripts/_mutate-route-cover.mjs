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
//
// 🚨🚨 **이게 도는 동안 대상 파일을 편집하지 말 것.** 변이마다 시작 시점의 내용을 스냅샷으로 떠서
//    끝에 되돌리므로, 중간에 얹은 편집이 **말없이 사라진다**(2026-09-14 실측 — 이 프로브를
//    백그라운드에 두고 같은 파일을 고쳤다가 네 군데를 잃었다. `git status`는 그 되돌림을 안 알려 준다).
//    오래 걸리니(E2E × 변이 수) 편집이 끝난 뒤 **마지막에** 돌린다.
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
  {
    name: 'M6 대역을 화면에 안 세운다 — 빈 칸이 그냥 빈 칸이다(어제 상태)',
    file: FORM,
    from: '            url: coverUrl,',
    to: '            url: null,',
    expect: '표지 건물 사진이 대신 보인다',
  },
  {
    name: 'M7 대역 상태에서 화살표를 감춘다 — 표지 위에 방향을 표시할 길이 없어진다',
    file: FORM,
    from: '          {(path || standIn) && annot && (',
    to: '          {path && annot && (',
    expect: '대역 상태에서도 [화살표 넣기]는 있다',
  },
  {
    name: 'M8 복사를 건너뛰고 바로 편집기를 연다 — 표지 원본을 편집하게 된다',
    file: FORM,
    from: '    const next = await fallback.adopt()',
    to: '    const next = fallback.url',
    expect: '화살표를 누르는 순간에야 복사가 일어난다',
  },
  {
    name: 'M10 화면만 옛 기준을 쓴다 — 폐지된 주행경로 초안을 화면이 계속 보여준다(두 표면 갈라짐)',
    file: FORM,
    from: '  const routePath = isRetiredRouteDraft(fa.routeImage) ? null : fa.routeImage',
    to: '  const routePath = fa.routeImage',
    expect: '폐지된 초안 자리에도 표지 건물 사진이 선다',
  },
  {
    name: 'M9 대역에 [삭제]를 내준다 — 표지 원본을 지우는 버튼이 된다',
    file: FORM,
    from: '          {path && (\n            <button onClick={() => { void remove() }} disabled={busy}',
    to: '          {(path || standIn) && (\n            <button onClick={() => { void remove() }} disabled={busy}',
    expect: '대역 상태엔 [삭제]가 없다',
  },
]

// MUT=M5 처럼 골라 돌릴 수 있다 — 한 축만 고친 뒤 전량 재주행(≈10분)을 피하려고
const only = process.env.MUT
const TARGETS = only ? MUTANTS.filter(m => m.name.startsWith(only)) : MUTANTS
if (only && TARGETS.length === 0) throw new Error(`MUT=${only} 에 맞는 변이가 없다`)

/** 변이를 쓴 **직후**엔 dev 서버가 그 모듈을 다시 굽는다. 그 사이에 스위트를 띄우면 첫 `page.goto`가
 *  15초에서 죽어, **모든 변이가 타임아웃으로 빨강**이 된다 — 단언이 문 것처럼 보이지만 아무것도 안 쟀다
 *  (2026-09-14 실측: 9/9가 전부 '스위트 완주' 실패였다. 어제 5/5 초록이던 것과 같은 코드였다).
 *  그래서 굽기가 끝났다는 신호(연속 2회 빠른 200)를 받고서야 시작한다. */
async function warmUp() {
  const url = `${process.env.E2E_BASE ?? 'http://localhost:3000'}/login`
  let quick = 0
  for (let i = 0; i < 60; i++) {
    const t0 = Date.now()
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      const ms = Date.now() - t0
      if (res.ok && ms < 3000) { if (++quick >= 2) return true } else quick = 0
    } catch { quick = 0 }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

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

    // 🚨 예열이 `/login`만 재면 **바뀐 모듈이 다시 구워졌는지는 증명하지 못한다** — 그 라우트는 이미
    //    구워져 있어 즉시 200이다. 2026-09-14 실측: 그 상태로 다음 변이를 돌렸더니 **직전 변이의
    //    번들**을 재 엉뚱한 단언이 울었다(M10이 M8의 결과를 그대로 냈다). 파일 감시가 변경을 집어
    //    재빌드를 **시작**할 시간을 먼저 준 뒤 예열한다.
    await new Promise(r => setTimeout(r, 8000))
    if (!await warmUp()) throw new Error('dev 서버가 예열되지 않았다 — 변이 결과를 믿을 수 없다')

    let out = ''
    let failed = false
    try {
      out = execSync('npx tsx scripts/test-image-slot.mts', { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      failed = true
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    }
    const redLines = out.split('\n').filter(l => l.includes('❌'))
    // 완주 실패만 빨강이면 아무것도 못 잰 것이다 — 잡았다고 세지 않게 그 사실을 눈에 띄게 적는다
    if (redLines.length === 1 && redLines[0].includes('스위트 완주')) {
      console.log(`⚠️  ${m.name}\n     → 스위트가 중간에 죽었다(환경) — 이 변이는 재주행할 것: ${redLines[0].trim()}`)
      continue
    }
    const hitExpected = redLines.some(l => l.includes(m.expect))
    if (failed && hitExpected) {
      caught++
      console.log(`✅ ${m.name}\n     → 빨강: ${redLines.map(l => l.trim()).join(' | ')}`)
    } else if (failed && redLines.some(l => l.includes('TimeoutError'))) {
      // 완주하지 못한 주행은 **아무것도 재지 못한 것**이다 — '못 잡았다'로 세면 없는 사각지대를 만든다
      console.log(`⚠️  ${m.name}\n     → 스위트가 완주하지 못했다(환경) — 재주행할 것: ${redLines.map(l => l.trim()).join(' | ')}`)
    } else if (failed) {
      console.log(`⚠️  ${m.name}\n     → 빨강이긴 한데 의도한 단언이 아니다(기대: "${m.expect}")\n     → ${redLines.map(l => l.trim()).join(' | ')}`)
    } else {
      console.log(`❌ ${m.name}\n     → 제품을 되돌렸는데 스위트가 초록이다 — 이 축을 무는 단언이 없다`)
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text)
  }
}

console.log(`\n변이 결과: ${caught} / ${TARGETS.length} 잡음`)
process.exit(caught === TARGETS.length ? 0 : 1)
