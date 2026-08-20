/** 셀 단위 오버라이드 순수 코어 회귀 테스트 — lib/doc-overrides.ts
 *
 *  실행: npx tsx scripts/test-annex-overrides.mts   (서버·DB 불필요 — test:all 무서버 단계)
 *
 *  고정하는 계약:
 *   ① 8종 템플릿의 키 후보 태그 열기·닫기가 균형 — 파서 없는 스캔의 전제. 여기가 깨지면
 *      오버라이드가 엉뚱한 범위를 덮어써 법정 문서를 망가뜨린다. 가장 먼저 터져야 할 테스트다.
 *   ② highlight on/off에서 키가 동일 — 미리보기에서 고친 셀 = 인쇄되는 셀
 *   ③ 왕복 — 덮어쓴 값이 그대로 살아나고 이웃 셀은 불변
 *   ④ 앵커 4단 해석, 특히 **빈 칸이 밀렸을 때 엉뚱한 칸에 붙지 않는다**(이 설계의 최대 위험)
 *   ⑤ 편집값은 항상 이스케이프된다 — 평문 저장/렌더 시 esc 규약
 *   ⑥ 점검결과 마크 칸에는 키가 없다 — 자체점검 결과 위조 통로 차단 */

const {
  indexDocument, resolveOverrides, applyOverrides, canon, normalizeValue, renderValue, textOf,
} = await import('../src/lib/doc-overrides.ts')
const {
  DOCS, renderReport4With, renderReport9With, renderCoverWith,
} = await import('./_fixtures-doc-templates.mts')

type CellIndex = ReturnType<typeof indexDocument>['cells'][number]
type SavedOverride = Parameters<typeof resolveOverrides>[1][number]

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : `\n       ${extra}`}`)
  ok ? pass++ : fail++
}

const KEY_TAGS = ['td', 'th', 'h1', 'p', 'div', 'span'] as const

/** 저장 레코드 만들기 — 서버가 실제로 하는 일(렌더 → 인덱스 → 앵커 채취)과 같다 */
const savedFrom = (c: CellIndex, value: string): SavedOverride =>
  ({ key: c.key, value, canonHash: c.canonHash, labelPath: c.labelPath, origText: c.origText })

// ── ① 태그 균형 불변식 ────────────────────────────────────────────────────────
console.log('\n① 키 후보 태그 열기·닫기 균형 (파서 없는 스캔의 전제)')
for (const d of DOCS) {
  const html = d.render(true)
  const bad = KEY_TAGS.filter(t =>
    (html.match(new RegExp(`<${t}(\\s[^>]*)?>`, 'gi')) ?? []).length !==
    (html.match(new RegExp(`</${t}\\s*>`, 'gi')) ?? []).length)
  check(`${d.label}`, bad.length === 0, `불균형 태그: ${bad.join(', ')}`)
}

// ── ② highlight 불변성 ───────────────────────────────────────────────────────
console.log('\n② highlight on/off 키 동일 (미리보기 셀 = 인쇄 셀)')
for (const d of DOCS.filter(x => x.hasHighlight)) {
  const onDoc = indexDocument(d.render(true))
  const offDoc = indexDocument(d.render(false))
  const on = onDoc.cells, off = offDoc.cells
  const same = on.length === off.length && on.every((c, i) => c.key === off[i].key)
  check(`${d.label} — 셀 ${on.length}개`, same, `on ${on.length} / off ${off.length}`)

  // 앵커도 같아야 한다 — 해시가 갈리면 미리보기에서 저장한 오버라이드가 PDF에서 tier1을 놓친다
  const bad = same ? on.findIndex((c, i) => c.canonHash !== off[i].canonHash || c.labelPath !== off[i].labelPath) : -1
  let detail = ''
  if (bad >= 0) {
    if (on[bad].labelPath !== off[bad].labelPath) {
      detail = `첫 불일치 key=${on[bad].key} — labelPath\n       on  ${on[bad].labelPath}\n       off ${off[bad].labelPath}`
    } else {
      // canon 문자열을 직접 떠서 첫 갈림 지점을 보여준다 — 어떤 마크업이 highlight를 타는지 특정하려고
      const ca = canon(onDoc.html.slice(on[bad].innerStart, on[bad].innerEnd))
      const cb = canon(offDoc.html.slice(off[bad].innerStart, off[bad].innerEnd))
      let i = 0
      while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++
      detail = `첫 불일치 key=${on[bad].key} tag=${on[bad].tag} — canon 문자 ${i}에서 갈림\n` +
        `       on  …${JSON.stringify(ca.slice(Math.max(0, i - 40), i + 60))}\n` +
        `       off …${JSON.stringify(cb.slice(Math.max(0, i - 40), i + 60))}`
    }
  }
  check(`${d.label} — 앵커(canonHash·labelPath) 동일`, same && bad < 0, detail)
}

// ── ③ 왕복 ───────────────────────────────────────────────────────────────────
console.log('\n③ 왕복 — 덮어쓴 값 보존 + 이웃 불변')
{
  const doc = indexDocument(DOCS.find(d => d.key === 'official')!.render(true))
  const free = doc.cells.filter(c => c.grade === 'free')
  check('공문에 편집 가능한 셀이 있다', free.length > 0, `free ${free.length}개`)

  const target = free[Math.floor(free.length / 2)]
  const neighbours = doc.cells.filter(c => c.key !== target.key).map(c => c.key + '=' + c.origText)

  const out = applyOverrides(doc.html, doc.cells, new Map([[target.key, '임의 문구 A']]))
  const re = indexDocument(out)
  const got = re.cells.find(c => c.key === target.key)
  check('덮어쓴 값이 재인덱스에서 그대로', got?.origText === '임의 문구 A', `실제: ${got?.origText}`)

  const reNeighbours = re.cells.filter(c => c.key !== target.key).map(c => c.key + '=' + c.origText)
  check('이웃 셀 전부 불변', JSON.stringify(neighbours) === JSON.stringify(reNeighbours))

  // 여러 셀 동시 — 오프셋 역순 치환이 서로를 밀어내지 않는지
  const multi = free.slice(0, Math.min(5, free.length))
  const out2 = applyOverrides(doc.html, doc.cells, new Map(multi.map((c, i) => [c.key, `값${i}`])))
  const re2 = indexDocument(out2)
  check('여러 셀 동시 덮어쓰기', multi.every((c, i) => re2.cells.find(x => x.key === c.key)?.origText === `값${i}`))

  // 줄바꿈 → <br>
  const out3 = applyOverrides(doc.html, doc.cells, new Map([[target.key, '첫 줄\n둘째 줄']]))
  check('줄바꿈이 <br>로', out3.includes('첫 줄<br>둘째 줄'))
}

// ── ④ 앵커 해석 4단 ──────────────────────────────────────────────────────────
console.log('\n④ 앵커 해석 — 정상 / 자가치유 / 데이터변경 / 모호')

// 4-1 정상(tier 1)
{
  const doc = indexDocument(DOCS.find(d => d.key === 'delegation')!.render(true))
  const t = doc.cells.find(c => c.grade === 'free')!
  const r = resolveOverrides(doc.cells, [savedFrom(t, '유지')])
  check('tier1 — 같은 문서면 그대로 적용', r.resolved.get(t.key) === '유지' && r.warnings.length === 0 && !r.blocked)
}

// 4-2 키 밀림 + 빈 칸 — **이 설계의 최대 위험**.
//     빈 칸은 canonHash가 전부 sha('')라 해시만으로는 오적용을 못 막는다. labelPath가 막아야 한다.
{
  const a = indexDocument(renderReport4With(13, 31))
  const b = indexDocument(renderReport4With(13, 35))   // 항목 수 ↑ → 설비마다 쪽 분할이 달라져 키가 밀린다

  // 설비 1의 '비고' 빈 칸 — labelPath가 sticky h1('1번 설비 점검표')으로 설비마다 갈린다
  const emptyOf = (cells: CellIndex[], sec: string) =>
    cells.find(c => c.grade === 'free' && c.origText === '' && c.labelPath.includes(`${sec}번 설비`) && c.labelPath.includes('비고'))

  const a1 = emptyOf(a.cells, '1')
  const b1 = emptyOf(b.cells, '1')
  const b2 = emptyOf(b.cells, '2')
  check('설비 1·2의 빈 비고 칸을 각각 찾았다', !!a1 && !!b1 && !!b2 && b1.key !== b2.key,
    `a1=${a1?.key} b1=${b1?.key} b2=${b2?.key}`)

  if (a1 && b1 && b2) {
    check('전제: 항목 수를 바꾸면 키가 실제로 밀린다', a1.key !== b1.key, `a1=${a1.key} b1=${b1.key}`)
    check('전제: 빈 칸이라 해시가 서로 같다(해시만으론 구분 불가)', b1.canonHash === b2.canonHash)

    const r = resolveOverrides(b.cells, [savedFrom(a1, '설비1 비고 문구')])
    check('tier2 — 밀린 키를 설비 1 칸으로 복구', r.resolved.get(b1.key) === '설비1 비고 문구',
      `resolved=${JSON.stringify([...r.resolved])}`)
    check('⚠ 설비 2 칸에는 절대 붙지 않았다', !r.resolved.has(b2.key))
    check('키 자가치유가 기록됐다', r.healed.some(h => h.from === a1.key && h.to === b1.key))
    check('오적용이 아니므로 생성 차단 없음', !r.blocked)
  }
}

// 4-3 데이터 변경(tier 3) — 자동값이 바뀌면 적용하되 사람 확인 전까지 생성을 막는다.
//     특정 필드를 지목하지 않고, 실제로 '라벨은 같은데 값이 바뀐' 셀을 두 렌더에서 찾아 쓴다.
{
  const a = indexDocument(renderReport9With({}))
  const b = indexDocument(renderReport9With({
    customerName: '바뀐빌딩', companyPhone: '031-999-9999', reportEmail: 'z@z.kr',
    inspDays: '9일', ownerPhone: '010-9999-8888',
  }))
  const uniqIn = (cells: CellIndex[], lp: string) => cells.filter(c => c.labelPath === lp).length === 1
  const target = a.cells.find(c =>
    c.grade === 'free' && c.origText !== '' && uniqIn(a.cells, c.labelPath) && uniqIn(b.cells, c.labelPath) &&
    b.cells.some(x => x.labelPath === c.labelPath && x.canonHash !== c.canonHash))
  check('전제: 라벨은 같고 값만 바뀐 유일 셀을 찾았다', !!target, `target=${target?.origText}`)

  if (target) {
    const r = resolveOverrides(b.cells, [savedFrom(target, '수기 문구')])
    const w = r.warnings.find(x => x.kind === 'data_changed')
    check('tier3 — 자동값 변경을 감지', !!w, `warnings=${JSON.stringify(r.warnings)}`)
    check('tier3 — 값은 적용하되 PDF 생성을 차단', r.blocked && r.resolved.size === 1)
    check('tier3 — 경고에 변경 전/후가 담긴다', w?.origText !== w?.currentText, `${w?.origText} → ${w?.currentText}`)

    // 사람이 확인하면 서버가 canon_hash를 현재 값으로 재기록한다 → 다음 해석은 tier1
    const cur = b.cells.find(x => x.labelPath === target.labelPath)!
    const r2 = resolveOverrides(b.cells, [savedFrom(cur, '수기 문구')])
    check('tier3 — 확인 후 재기록하면 차단이 풀린다', !r2.blocked && r2.warnings.length === 0)
  }
}

// 4-4 모호 / 없음 — 문서 내용에 기대지 않도록 셀을 합성해 규칙 자체를 검사한다
{
  const cell = (key: string, labelPath: string, canonHash: string): CellIndex => ({
    key, tag: 'td', grade: 'free', innerStart: 0, innerEnd: 0,
    canonHash, labelPath, pageSig: 'p', origText: '',
  })
  const twins = [cell('1.1', '같은라벨', 'aaaa'), cell('1.2', '같은라벨', 'aaaa')]
  const r1 = resolveOverrides(twins, [{ key: '9.9', value: 'x', canonHash: 'aaaa', labelPath: '같은라벨', origText: '' }])
  check('tier4 — 후보가 여럿이면 적용하지 않고 경고',
    r1.resolved.size === 0 && r1.warnings[0]?.kind === 'skipped_ambiguous', JSON.stringify(r1.warnings))

  const r2 = resolveOverrides(twins, [{ key: '0.0', value: 'x', canonHash: 'zz', labelPath: '없는라벨', origText: '' }])
  check('tier4 — 못 찾으면 적용하지 않고 경고',
    r2.resolved.size === 0 && r2.warnings[0]?.kind === 'skipped_missing')

  // 한 칸에 둘이 붙지 않는다 — 먼저 자리를 잡은 오버라이드가 이긴다
  const one = [cell('1.1', 'L', 'h1')]
  const r3 = resolveOverrides(one, [
    { key: '1.1', value: '첫째', canonHash: 'h1', labelPath: 'L', origText: '' },
    { key: '7.7', value: '둘째', canonHash: 'h1', labelPath: 'L', origText: '' },
  ])
  check('한 셀에 오버라이드가 겹치면 뒤엣것은 적용되지 않는다',
    r3.resolved.get('1.1') === '첫째' && r3.warnings.some(w => w.kind === 'skipped_missing'),
    JSON.stringify([...r3.resolved]) + ' / ' + JSON.stringify(r3.warnings))
}

// 4-5 labelPath 판별력 — 중복이 많으면 tier2 복구가 자주 실패한다. 실측해 둔다.
{
  console.log('  · labelPath 판별력(중복 라벨 비율 — 낮을수록 키 밀림 복구가 잘 된다)')
  for (const d of DOCS) {
    const cells = indexDocument(d.render(true)).cells
    const counts = new Map<string, number>()
    for (const c of cells) counts.set(c.labelPath, (counts.get(c.labelPath) ?? 0) + 1)
    const dup = cells.filter(c => (counts.get(c.labelPath) ?? 0) > 1).length
    const pct = cells.length ? (dup / cells.length) * 100 : 0
    console.log(`      ${d.label.padEnd(22)} ${String(dup).padStart(4)}/${String(cells.length).padEnd(4)} (${pct.toFixed(0)}%)`)
  }
}

// ── ⑤ 이스케이프 ─────────────────────────────────────────────────────────────
console.log('\n⑤ 편집값 이스케이프 (평문 저장 → 렌더 시 esc)')
{
  const doc = indexDocument(DOCS.find(d => d.key === 'cover')!.render(true))
  const t = doc.cells.find(c => c.grade === 'free')!
  const evil = '<script>alert(1)</script> & "따옴표" <td>주입</td>'
  const out = applyOverrides(doc.html, doc.cells, new Map([[t.key, evil]]))
  check('스크립트 태그가 raw로 들어가지 않는다', !out.includes('<script>'))
  check('주입한 <td>가 태그로 살아나지 않는다', !out.includes('<td>주입</td>'))
  check('&·따옴표가 엔티티로', out.includes('&amp;') && out.includes('&quot;'))
  check('재인덱스 시 원문 텍스트로 복원', indexDocument(out).cells.find(c => c.key === t.key)?.origText === evil)
  // 주입 후에도 태그 균형이 유지돼야 한다 — 안 그러면 뒤 셀 범위가 통째로 어긋난다
  const bad = KEY_TAGS.filter(tg =>
    (out.match(new RegExp(`<${tg}(\\s[^>]*)?>`, 'gi')) ?? []).length !==
    (out.match(new RegExp(`</${tg}\\s*>`, 'gi')) ?? []).length)
  check('주입 후에도 태그 균형 유지', bad.length === 0, `불균형: ${bad.join(',')}`)

  check('normalizeValue — 제어문자 제거, 줄바꿈 보존',
    normalizeValue('a bc\r\nd') === 'abc\nd', JSON.stringify(normalizeValue('a bc\r\nd')))
  check('normalizeValue — 길이 상한', normalizeValue('x'.repeat(5000)).length === 2000)
  check('renderValue — 빈 값도 안전', renderValue('') === '')
}

// ── ⑥ 등급 — 점검결과 칸은 키가 없다 ─────────────────────────────────────────
console.log('\n⑥ 편집 등급 — 점검 사실은 손댈 수 없다')
for (const key of ['report4', 'report9', 'exterior']) {
  const d = DOCS.find(x => x.key === key)!
  const doc = indexDocument(d.render(true))
  // 결과 마크(○·×·/)를 담은 셀이 키를 받았는가 — 하나라도 있으면 위조 통로다
  const leaked = doc.cells.filter(c => ['○', '×', '/'].includes(c.origText))
  check(`${d.label} — 결과 마크 칸에 키 없음`, leaked.length === 0,
    `누출 ${leaked.length}개: ${leaked.slice(0, 3).map(c => `${c.key}:${c.origText}`).join(', ')}`)
  check(`${d.label} — data-ok가 결과 칸(class="mk")에 안 붙었다`,
    !/<td[^>]*class="[^"]*\bmk\b[^"]*"[^>]*data-ok/.test(doc.html) &&
    !/<td[^>]*data-ok[^>]*class="[^"]*\bmk\b/.test(doc.html))
}

// ── 커버리지 리포트 (정보) ────────────────────────────────────────────────────
console.log('\n· 편집 커버리지 (free = 사용자가 바로 고칠 수 있는 칸)')
for (const d of DOCS) {
  const doc = indexDocument(d.render(true))
  const free = doc.cells.filter(c => c.grade === 'free').length
  const locked = doc.cells.filter(c => c.grade === 'locked').length
  console.log(`  ·  ${d.label.padEnd(22)} free ${String(free).padStart(4)} / locked ${String(locked).padStart(4)}`)
}

// ── canon 정규화 ─────────────────────────────────────────────────────────────
console.log('\n· canon 정규화')
check('.missing span은 무시된다', canon('<span class="missing">&nbsp;</span>') === '')
check('img src는 비교에서 제외', canon('<img src="a.jpg">') === canon('<img src="https://x/y?token=z">'))
check('data-ok는 비교에서 제외', canon('<b data-ok="1.2">x</b>') === canon('<b>x</b>'))
check('textOf — 엔티티 복원', textOf('a&amp;b&nbsp;c') === 'a&b c')

console.log(`\n${pass}/${pass + fail} 통과`)
if (fail) process.exit(1)
