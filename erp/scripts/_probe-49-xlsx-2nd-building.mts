/** [+ 건물 등록] 복원(2026-09-15)의 **끝까지** 확인 — DB에 2동이 있으면 갑지 엑셀이
 *  ① 「다수동일때」 건축물정보를 채우는가 ② **2동의 소화기(설비)까지 싣는가**.
 *
 *  왜 따로 필요한가: `test-multi-building-form9`은 97/0 초록이지만 조립본의 `otherBuildings`를
 *  **직접 갈아끼운다.** 즉 「DB의 2번째 행 → otherBuildings」 매핑(`report9-assemble.ts:762`
 *  `bldRest`)과 설비 합집합(`:473` `.in('building_id', 전 동)`)은 그 검사가 **한 번도 안 지난다.**
 *  버튼을 되살려 사용자가 실제로 밟을 경로가 바로 그 구간이다.
 *
 *  🚨 스테이징 DB에 임시 행(건물 1·설비 1)을 **쓴다.** finally에서 반드시 지운다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-49-xlsx-2nd-building.mts
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++
}

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/https:\/\/([^.]{6}).*/, '$1…')} (스테이징)`)

const { assembleReport9 } = await import('../src/lib/report9-assemble.ts')
const { buildWorkbookValues, toInjectTargets } = await import('../src/lib/xlsx-workbook.ts')
const { validateAnchors } = await import('../src/lib/xlsx-anchors.ts')
const { injectWorkbook } = await import('../src/lib/xlsx-inject.ts')
const { FORM4_ROWS, form4InstallField } = await import('../src/lib/xlsx-form4.ts')
const { FIRE_SUB_ITEMS, ALL_STANDARD_CODES, FACILITY_STANDARD } = await import('../src/lib/facility-codes.ts')

const EXT = FIRE_SUB_ITEMS[0]   // 「소화기(소화기·자동확산·간이)」 = 현황 시트 D7 설치칸
const extRow = FORM4_ROWS.find(r => (r.codes ?? []).includes(EXT))
if (!extRow) { console.log('🚨 소화기 행을 form4에서 못 찾았다 — 판정 불가'); process.exit(2) }
console.log(`소화기 코드="${EXT}" → 현황!${extRow.cell}`)

const { data: iRaw } = await admin.from('inspections').select('id, customer_id').order('id').limit(1)
const insp = ((iRaw ?? []) as Array<{ id: string; customer_id: string }>)[0]
if (!insp) { console.log('회차 0건 — 판정 불가(환경 축)'); process.exit(2) }

const official = {
  company: { name: '㈜테스트', address: 'A', phone: '0', fax: '0' },
  docNo: 'D', sendDate: '2026년 9월', recipient: 'R', reference: '관계인',
  sender: 'S', senderSign: { name: 'N', title: 'T', rep: 'P' }, year: 2026, typeLabel: '작동점검',
} as never
const delegation = {
  typeLabel: '작동점검', owner: { name: '', position: '', phone: '', birth: '' },
  agent: { name: '', position: '', phone: '', birth: '' },
  periodLabel: '', daysLabel: '', submitDate: '', station: '',
} as never
const template = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const anchors = validateAnchors(template)

/** 라우트와 **같은 축**으로 설치 설비를 센다(route.ts:85 `.in(building_id, 전 동)` + Set) */
async function installedCodesNow(): Promise<string[]> {
  const { data: b } = await admin.from('buildings').select('id')
    .eq('customer_id', insp.customer_id).eq('is_active', true)
  const ids = ((b ?? []) as Array<{ id: string }>).map(x => x.id)
  if (!ids.length) return []
  const { data } = await admin.from('fire_facilities').select('facility_code')
    .in('building_id', ids).eq('installed', true)
  return [...new Set(((data ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code))]
}

async function renderAndRead(codes: string[]) {
  const r9 = (await assembleReport9(admin as never, insp.customer_id, insp.id)).data
  const values = buildWorkbookValues({
    official, delegation, report9: r9 as never, customerAddress: '',
    startISO: null, endISO: null, useApprovalISO: null,
    installedCodes: codes, evacTypes: [], building: null,
  })
  const { targets, unmapped } = toInjectTargets(values, anchors.anchors)
  const r = await injectWorkbook(template, targets)
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(r.bytes)
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
  const dec = (s: string) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const sstXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml')!.async('string') : ''
  const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => dec(t[1])).join(''))
  const readSheet = async (name: string) => {
    let path = ''
    for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g))
      if (dec(m[1]) === name) path = 'xl/' + (relMap.get(m[2]) ?? '').replace(/^\/?xl\//, '')
    const cells = new Map<string, string>()
    if (!path || !zip.file(path)) return cells
    const xml = await zip.file(path)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, tail, body] = m
      if (tail === '/>') { cells.set(ref, ''); continue }
      // 🚨 `<is>`(inline string)를 반드시 함께 읽는다. 주입기는 문자열을 inlineStr로 쓰므로
      //    `<v>`만 보면 **문자열 칸이 전부 공란으로 보인다** — 숫자 칸만 초록이고 문자 칸은
      //    양성이 빨강, 음성은 **공허 통과**가 된다(2026-09-15 실측: B3가 그렇게 빨개졌고
      //    B14·B24 공란 단언은 그래서 거짓 초록이었다). 원본 리더에는 있던 갈래를 내가 빠뜨렸다.
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body ?? '')
      const im = /<is>([\s\S]*?)<\/is>/.exec(body ?? '')
      cells.set(ref, im
        ? [...im[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => dec(t[1])).join('')
        : vm ? (/\bt="s"/.test(attrs) ? (sst[Number(vm[1])] ?? '') : dec(vm[1])) : '')
    }
    return cells
  }
  return { r9, unmapped, values, multi: await readSheet('다수동일때'), form4: await readSheet('현황') }
}

let tempBldId: string | null = null
let tempFacIds: string[] = []
try {
  // ── ① 대조군: 손대기 전(1동) ──────────────────────────────────────────────
  console.log('\n── ① 대조군 (건물 1동, 손대기 전)')
  const codes0 = await installedCodesNow()
  const before = await renderAndRead(codes0)
  check('전제 — 표본 고객은 1동이다', (before.r9.otherBuildings ?? []).length === 0,
    `otherBuildings=${(before.r9.otherBuildings ?? []).length}`)
  check('🎯 (음성) 「다수동일때」 블록1 연면적 B4가 **공란**', (before.multi.get('B4') ?? '') === '',
    `"${before.multi.get('B4')}"`)
  check('주입 값 누락 0', before.unmapped.length === 0)
  const extBefore = String(before.values.get(form4InstallField(extRow)) ?? '')
  console.log(`  설치 설비 ${codes0.length}종 · 소화기 설치=${codes0.includes(EXT)} · 현황!${extRow.cell}="${extBefore}"`)

  // 신호가 **모호하지 않은** 표적을 고른다 — 이미 설치된 설비를 또 넣으면 √가 원래 √였는지 모른다
  const absent = ALL_STANDARD_CODES.filter(c => !codes0.includes(c))
  const target = !codes0.includes(EXT) ? EXT : absent.find(c => FORM4_ROWS.some(r => (r.codes ?? []).includes(c)))
  if (!target) { check('표적 설비 선정(미설치 코드)', false, '전 설비가 이미 설치됨'); throw new Error('no target') }
  const tRow = FORM4_ROWS.find(r => (r.codes ?? []).includes(target))!
  const isExt = target === EXT
  console.log(`  표적 설비: "${target}" → 현황!${tRow.cell} ${isExt ? '(= 소화기 자체)' : '(소화기는 이미 동1에 설치돼 신호가 모호하므로 미설치 설비로 대체)'}`)
  check(`🎯 (음성) 넣기 전 현황!${tRow.cell}는 미설치 표기`,
    String(before.values.get(form4InstallField(tRow)) ?? '') !== '[√]',
    `"${before.values.get(form4InstallField(tRow))}"`)

  // ── ② 2번째 동 + 그 동의 설비를 넣는다 (복원한 버튼이 여는 경로) ──────────
  console.log('\n── ② 2번째 동 + 2동에만 있는 설비 등록 후')
  const { data: bld0 } = await admin.from('buildings').select('created_by')
    .eq('customer_id', insp.customer_id).eq('is_active', true).limit(1).single()
  const createdBy = (bld0 as { created_by: string } | null)?.created_by ?? null

  const MARK = 7777
  const { data: ins, error } = await admin.from('buildings').insert({
    customer_id: insp.customer_id, building_name: 'ZZ프로브2동', is_active: true, created_by: createdBy,
    permit_date: '2013-03-03', total_area: MARK, building_area: 333, households: 33,
    floors_above: 3, floors_below: 1, height: 23,
  } as never).select('id').single()
  if (error) { check(`임시 2동 insert (${error.message})`, false); throw new Error(error.message) }
  tempBldId = (ins as { id: string }).id
  check('임시 2동 insert', !!tempBldId, tempBldId!.slice(0, 8))

  // category는 NOT NULL. 코드↔분류는 대장 코드표가 원천이되, **하위 5종은 그 표에 없다**
  // (`FIRE_SUB_ITEMS`는 `ALL_STANDARD_CODES` 밖의 개별 행) → 화면과 같은 규칙으로 '소화설비'
  // (`plan-form14.tsx:64`). 여기서 규칙을 지어내면 화면이 저장하는 것과 갈라진다.
  const cat = FACILITY_STANDARD.find(c => c.items.includes(target))?.category
    ?? (FIRE_SUB_ITEMS.includes(target) ? '소화설비' : undefined)
  check('표적 설비의 분류를 코드표에서 찾았다', !!cat, String(cat))
  // 🚨 화면은 하위를 켜면 **부모도 자동 체크**한다(`plan-form14.tsx:487`). 부모 행을 빼면
  //    DB에 화면이 만들 수 없는 조합이 생겨, 프로브가 현실과 다른 상태를 재는 꼴이 된다.
  const rows = FIRE_SUB_ITEMS.includes(target)
    ? [{ facility_code: target, category: cat }, { facility_code: '소화기구 및 자동소화장치', category: '소화설비' }]
    : [{ facility_code: target, category: cat }]
  const { data: fac, error: fErr } = await admin.from('fire_facilities')
    .insert(rows.map(r => ({ ...r, building_id: tempBldId, installed: true })) as never).select('id')
  if (fErr) { check(`임시 설비 insert (${fErr.message})`, false); throw new Error(fErr.message) }
  tempFacIds = ((fac ?? []) as Array<{ id: string }>).map(x => x.id)
  check(`임시 설비 insert — **2동에만** 있다`, tempFacIds.length === rows.length,
    `${rows.map(r => `"${r.facility_code}"`).join(' + ')}`)

  const codes1 = await installedCodesNow()
  const after = await renderAndRead(codes1)

  console.log('\n  [축 A] 건축물정보 → 「다수동일때」')
  check('🎯 조립이 DB의 2번째 동을 집었다 (bldRest → otherBuildings)',
    (after.r9.otherBuildings ?? []).length === 1, `otherBuildings=${(after.r9.otherBuildings ?? []).length}`)
  check('🎯 엑셀 「다수동일때」 블록1 연면적 B4 = 표식', after.multi.get('B4') === String(MARK),
    `"${after.multi.get('B4')}"`)
  check('  블록1 건축허가일 B3', (after.multi.get('B3') ?? '').includes('2013'), `"${after.multi.get('B3')}"`)
  {
    // 🔍 B3가 비면 어느 층에서 끊겼는지 — DB / 조립 / 값맵 세 지점을 **각각** 찍는다.
    //    한 지점만 보면 「없다」가 어디서 생겼는지 모른 채 엉뚱한 층을 고치게 된다.
    const { data: raw } = await admin.from('buildings').select('permit_date, total_area').eq('id', tempBldId!).single()
    console.log(`    🔍 DB.permit_date = ${JSON.stringify((raw as { permit_date: unknown } | null)?.permit_date)}`)
    console.log(`    🔍 조립 otherBuildings[0].permitDate = ${JSON.stringify(after.r9.otherBuildings?.[0]?.permitDate)}`)
    console.log(`    🔍 값맵 mb0PermitDate = ${JSON.stringify(after.values.get('mb0PermitDate'))}`)
  }
  check('  블록1 세대수 J4 = 33 (단위 미포함)', after.multi.get('J4') === '33', `"${after.multi.get('J4')}"`)
  check('  블록1 높이 H5 = 23', after.multi.get('H5') === '23', `"${after.multi.get('H5')}"`)
  check('🎯 (음성) 미사용 블록2 B14 공란', (after.multi.get('B14') ?? '') === '', `"${after.multi.get('B14')}"`)
  check('🎯 (음성) 미사용 블록3 B24 공란', (after.multi.get('B24') ?? '') === '', `"${after.multi.get('B24')}"`)

  console.log('\n  [축 B] 설비(소화기) → 현황 시트 설치칸 — 전 동 합집합인가')
  check('🎯 설치 설비 목록이 2동 것을 **합쳤다**', codes1.includes(target),
    `${codes0.length}종 → ${codes1.length}종`)
  check(`🎯 엑셀 현황!${tRow.cell}가 [√]로 바뀌었다 (2동에만 있는 설비)`,
    String(after.values.get(form4InstallField(tRow)) ?? '') === '[√]',
    `"${before.values.get(form4InstallField(tRow))}" → "${after.values.get(form4InstallField(tRow))}"`)
  check(`  소화기 현황!${extRow.cell} 최종 표기`,
    String(after.values.get(form4InstallField(extRow)) ?? '') === '[√]',
    `"${after.values.get(form4InstallField(extRow))}"${isExt ? '' : ' (동1에서 이미 설치)'}`)

  console.log('\n  [축 C] 🚨 알려진 비대칭 — 세부제원은 대표동만 본다')
  // report9-assemble:482 — `specQ.or('building_id.eq.<대표동>,building_id.is.null')`.
  // 즉 2동의 **세부제원(현1~현4)**은 설치 체크와 달리 인쇄되지 않는다. 결함이 아니라 현 설계다.
  const specSrc = readFileSync('src/lib/report9-assemble.ts', 'utf8')
  check('세부제원 쿼리가 대표동(b.id)+공통(null)만 본다 — 전 동 아님',
    /specQ\.or\(`building_id\.eq\.\$\{b\.id\},building_id\.is\.null`\)/.test(specSrc))
  check('대표동은 그대로다 (2동 추가가 1쪽을 안 바꾼다)',
    after.r9.customerName === before.r9.customerName, after.r9.customerName)
} finally {
  console.log('\n── 정리')
  if (tempFacIds.length) {
    const { error } = await admin.from('fire_facilities').delete().in('id', tempFacIds)
    const { data } = await admin.from('fire_facilities').select('id').in('id', tempFacIds)
    const gone = !error && (data ?? []).length === 0
    console.log(`  임시 설비 ${tempFacIds.length}행 삭제: ${gone ? '✅' : `🚨 실패 (id=${tempFacIds.join(',')})`}`)
    if (!gone) fail++
  }
  if (tempBldId) {
    const { error } = await admin.from('buildings').delete().eq('id', tempBldId)
    const { data } = await admin.from('buildings').select('id').eq('id', tempBldId)
    const gone = !error && (data ?? []).length === 0
    console.log(`  임시 2동 삭제: ${gone ? '✅' : `🚨 실패 (id=${tempBldId})`}`)
    if (!gone) fail++
  }
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
