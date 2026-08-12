/** 소방시설등의 세부 현황(3-1~3-8) 공용 렌더 — 소방계획서_7 S3A H-21
 *
 *  별지 4호 3~7쪽 = 별지 9호 4~7쪽의 공용 원본(§4-A-1) — customer_facility_specs
 *  (FACILITY_SPEC_SECTIONS 카탈로그, H-18) 값을 서식 원문 레이아웃에 주입한다.
 *  값이 없으면 서식 빈칸 그대로(현행 빈 서식과 동등), highlight 시 미입력 하이라이트(§4-A-2c ③).
 *
 *  반환은 섹션(3-1~3-8)별 HTML 배열 — 쪽 나눔(4호=3~7쪽 5쪽, 9호=4~7쪽 4쪽)은 각 템플릿이 결정.
 *  섹션 순서·라벨은 카탈로그(FACILITY_SPEC_SECTIONS) 순회 기준, 필드 key도 카탈로그와 1:1. */

import { esc } from './base'
import { FACILITY_SPEC_SECTIONS, applyDerived, type DerivedCtx } from '../facility-spec-schema'

/** customer_facility_specs 병합본 — { sectionKey: { blockKey: { fieldKey: 값 } } } */
export type SpecMap = Record<string, Record<string, unknown>>

export type SpecRenderOpts = {
  highlight?: boolean
  /** 섹션 제목 번호 — 별지 9호 '3-1.' / 별지 4호 ' 1.' (서식 원문 표기 차이) */
  numbering?: 'annex9' | 'annex4'
  /** 파생 필드(가스계 설비 종류·유도표지·피난유도선·비상용승강기)의 원천 —
   *  세부제원에 저장하지 않고 인쇄 직전에 얹는다(2026-08-08 중복 입력 제거). 미지정이면 저장분 그대로. */
  derived?: DerivedCtx
}

type Vals = Record<string, unknown>

/** 서식 원문 체크박스 표기 (4~7쪽은 [ ] 한 칸) */
const CB = '[&nbsp;]'
const CK = '[√]'

function sv(v: unknown): string {
  if (v == null || typeof v === 'boolean') return ''
  if (Array.isArray(v)) return v.map(String).join(', ')
  return String(v).trim()
}
/** 값 존재 여부 — check(boolean)·multicheck(배열)·텍스트 공용 */
function has(v: unknown): boolean {
  if (v === true) return true
  if (Array.isArray(v)) return v.length > 0
  return !!sv(v)
}
function cb(checked: boolean): string {
  return checked ? CK : CB
}
/** select 값 일치 체크 */
function sel(v: unknown, opt: string): string {
  return cb(sv(v) === opt)
}
/** multicheck 포함 체크 */
function mc(v: unknown, opt: string): string {
  return cb(Array.isArray(v) && v.map(String).includes(opt))
}
/** 블록에 입력값이 하나라도 있는가 — 서식 행 머리 [ ] 체크 근거 */
function blockHas(b: Vals): boolean {
  return Object.values(b).some(has)
}
function blk(sec: Vals, key: string): Vals {
  return (sec[key] ?? {}) as Vals
}

/** 값 또는 서식 빈칸(공백 유지 — .pre) — highlight 시 미입력 하이라이트 */
function slot(v: unknown, blank: string, h: boolean): string {
  const s = sv(v)
  if (s) return esc(s)
  return h ? `<span class="missing">${blank}</span>` : blank
}
/** ( 값 ) 괄호 슬롯 — n = 빈칸 공백 수(서식 원문 폭) */
function pv(v: unknown, n: number, h: boolean): string {
  return `(${slot(v, ' '.repeat(n), h)})`
}
/** [ ]지상/[ ]지하 선택 표기 */
function gsel(v: unknown): string {
  return `${sel(v, '지상')}지상/${sel(v, '지하')}지하`
}

/** 설치장소: 동명( ) [ ]지상/[ ]지하 ( )층, 실명( ) — locFields(prefix) 대응 */
function locLine(b: Vals, prefix: string, h: boolean): string {
  const p = prefix ? `${prefix}_` : ''
  return `동명(${slot(b[`${p}dong`], '            ', h)}) ${gsel(b[`${p}ground`])} (${slot(b[`${p}floor`], '   ', h)})층, 실명(${slot(b[`${p}room`], '            ', h)})`
}

/** 설치장소: 동명( ) [ ]전체층/[ ]일부층 [ ]지상/[ ]지하( )층 ~ [ ]지상/[ ]지하( )층 — rangeLocFields 대응 */
function rangeLine(b: Vals, h: boolean, sfx = ''): string {
  return `동명(${slot(b[`dong${sfx}`], '   ', h)}) ${sel(b[`coverage${sfx}`], '전체층')}전체층/${sel(b[`coverage${sfx}`], '일부층')}일부층 `
    + `${gsel(b[`from_ground${sfx}`])}(${slot(b[`from_floor${sfx}`], ' ', h)})층 ~ ${gsel(b[`to_ground${sfx}`])}(${slot(b[`to_floor${sfx}`], ' ', h)})층`
}

/** 설치장소 2줄 블록(A4-4) — 서식 원문에서 둘째 줄을 가진 블록은 **8개**다:
 *  옥내소화전 · 화재조기진압용SP · 물분무 · 미분무 · 자동화재탐지설비 · **화재알림설비** · 피난기구 · 인명구조기구.
 *  기준 원문은 **현행 별지9호**(`_form/별지9호-placeholder.hwpx` Contents/section0.xml) — 세부현황은 4호·9호
 *  공용 원본이고, `_doc01` 별지4호 샘플은 구판이라 화재알림설비 자체가 없다(form_edition_finding 참조).
 *  초판이 구판을 기준으로 삼아 화재알림설비 1블록을 놓쳤고 독립 판정(2026-08-12)이 적발했다.
 *  (원문 둘째 줄의 이음표는 '::: ', ': : : ', ':' 등 제각각이라 ':동명'만 찾으면 놓친다.)
 *  둘째 줄은 원문처럼 ':'로 시작해 첫 줄의 이어짐임을 보인다(라벨 반복 없음). */
function rangeLines2(b: Vals, h: boolean): string[] {
  return [`◦ 설치장소: ${rangeLine(b, h)}`, `: ${rangeLine(b, h, '2')}`]
}

/** 설치장소: 동명( ) [ ]지상/[ ]지하 ( )층 ~ [ ]지상/[ ]지하 ( )층 — coverage 없는 층 범위(3-8 비상콘센트·무선통신) */
function rangeLineNoCoverage(b: Vals, h: boolean): string {
  return `동명(${slot(b['dong'], '            ', h)}) ${gsel(b['from_ground'])} (${slot(b['from_floor'], '   ', h)})층 ~ `
    + `${gsel(b['to_ground'])} (${slot(b['to_floor'], '   ', h)})층`
}

/** 송풍기 제원 2줄 — fanFields(prefix) 대응 (3-8 제연설비 공용) */
function fanLines(b: Vals, prefix: string, label: string, h: boolean): string[] {
  return [
    `◦ ${label} 설치장소: 동명(${slot(b[`${prefix}_dong`], '          ', h)}) ${gsel(b[`${prefix}_ground`])} (${slot(b[`${prefix}_floor`], '   ', h)})층, 실명(${slot(b[`${prefix}_room`], '            ', h)})`,
    ` 전동기 ${pv(b[`${prefix}_motor`], 6, h)}㎾, 풍량 ${pv(b[`${prefix}_airflow`], 6, h)}㎥/min, 정압 ${pv(b[`${prefix}_pressure`], 6, h)}㎜Aq`,
  ]
}

/** 라벨 + 본문(여러 줄) 행 — 개별사항 표 공용 (구 report9 specRow) */
function specRow(label: string, lines: string[]): string {
  return `<tr><td class="center" style="width:26mm">${label}</td><td class="pre">${lines.join('<br>')}</td></tr>`
}

// ── 3-1. 소화기구, 자동소화장치 ─────────────────────────────────────────────
function renderS31(sec: Vals, h: boolean): string {
  const s = blk(sec, 'summary')
  const dong = blk(sec, 'by_dong')
  const t = (opt: string) => mc(s['types'], opt)
  const tAny = (...opts: string[]) =>
    cb(Array.isArray(s['types']) && opts.some(o => (s['types'] as unknown[]).map(String).includes(o)))
  const cell = (v: unknown) =>
    `<td class="center">${sv(v) ? esc(sv(v)) : h ? '<span class="missing">&nbsp;&nbsp;</span>' : '&nbsp;'}</td>`
  const blankRow = (label: string) =>
    `<tr><td class="center">${label}</td>${'<td>&nbsp;</td>'.repeat(7)}</tr>`

  // 합계 행 — 수량 6칸 + 비고
  const sumRow = `<tr><td class="center">합계</td>${cell(s['qty_ext_powder'])}${cell(s['qty_ext_other'])}${
    cell(s['qty_simple_throw'])}${cell(s['qty_simple_other'])}${cell(s['qty_auto_diffuse'])}${cell(s['qty_auto_device'])}${cell(s['note'])}</tr>`

  // 동별 내역 — 자유 기입(줄 단위, 카탈로그 by_dong.rows) → 줄당 1행, 없으면 서식 빈 행 유지
  const lines = sv(dong['rows']).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let dongRows: string
  if (lines.length === 0) {
    dongRows = [blankRow('동명'), blankRow('&nbsp;'), blankRow('&nbsp;'), blankRow('&nbsp;'), blankRow('&nbsp;')].join('\n  ')
  } else {
    const filled = lines.map((l, i) =>
      `<tr><td class="center">${i === 0 ? '동명' : '&nbsp;'}</td><td class="pre" colspan="6">${esc(l)}</td><td>&nbsp;</td></tr>`)
    while (filled.length < 5) filled.push(blankRow('&nbsp;'))
    dongRows = filled.join('\n  ')
  }

  return `<table class="form tight">
  <tr>
    <th rowspan="2" style="width:18mm">구분</th>
    <th colspan="2">${tAny('소화기(분말)', '소화기(기타)')} 소화기</th>
    <th colspan="2">${tAny('간이소화용구(투척용)', '간이소화용구(기타)')} 간이소화용구</th>
    <th rowspan="2">${t('자동확산소화기')} 자동<br>확산소화기</th>
    <th rowspan="2">${t('자동소화장치')} 자동<br>소화장치</th>
    <th rowspan="2" style="width:16mm">비 고</th>
  </tr>
  <tr><th>${t('소화기(분말)')} 분말</th><th>${t('소화기(기타)')} 기타</th><th>${t('간이소화용구(투척용)')} 투척용</th><th>${t('간이소화용구(기타)')} 기타</th></tr>
  ${sumRow}
  ${dongRows}
</table>`
}

// ── 3-2. 수계소화설비(공통사항) ─────────────────────────────────────────────
function renderS32(sec: Vals, h: boolean): string {
  const mw = blk(sec, 'main_water')
  const aw = blk(sec, 'aux_water')
  const el = blk(sec, 'pump_elevated')
  const pr = blk(sec, 'pump_pressure')
  const pz = blk(sec, 'pump_pressurized')
  const pm = blk(sec, 'pump_type')
  const inlet = blk(sec, 'inlet')
  const ep = blk(sec, 'emergency_power')

  // A4-3(소방계획서_19): 서식 원문의 '◦ 설비의 종류' 체크줄 — 주된수원·고가/압력/가압수조·펌프방식 5블록.
  // 종전엔 이 줄 자체가 없어 별지4호·9호 세부현황에서 통째로 누락됐다(현행판 원문 대조로 확인, 2026-08-12).
  const WATER_SYSTEMS = [
    '옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
    '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비',
  ]
  const sysLine = (b: Vals) =>
    `◦ 설비의 종류: ${WATER_SYSTEMS.slice(0, 3).map(o => `${mc(b['systems'], o)}${o}`).join(', ')},`
    + `<br>　　${WATER_SYSTEMS.slice(3).map(o => `${mc(b['systems'], o)}${o}`).join(', ')}`

  const pumpLines = [
    sysLine(pm),
    `◦ 설치장소: ${locLine(pm, '', h)}`,
    `◦ 주펌프  전양정:${pv(pm['main_head'], 9, h)}m, 토출량:${pv(pm['main_flow'], 9, h)}ℓ/min`,
    `◦ 예비펌프  전양정:${pv(pm['reserve_head'], 9, h)}m, 토출량:${pv(pm['reserve_flow'], 9, h)}ℓ/min`,
    `◦ 충압펌프  전양정:${pv(pm['jockey_head'], 9, h)}m, 토출량:${pv(pm['jockey_flow'], 9, h)}ℓ/min`,
    `◦ ${cb(has(pm['priming']))}물올림장치(유효수량: ${pv(pm['priming_capacity'], 9, h)}ℓ, 급수배관: ${pv(pm['priming_pipe'], 9, h)}㎜`,
    `◦ 기동장치: ${mc(pm['starter'], '기동용수압개폐장치')}기동용수압개폐장치, ${mc(pm['starter'], 'ON/OFF 방식')}ON/OFF 방식`,
    `  ${cb(has(pm['chamber']))}압력체임버(용량:${pv(pm['chamber_capacity'], 9, h)}ℓ, 사용압력:${pv(pm['chamber_pressure'], 9, h)}MPa`,
    `  ${cb(has(pm['pressure_switch']))}기동용압력스위치(${sel(pm['pressure_switch'], '부르동관식')}부르동관식 ${sel(pm['pressure_switch'], '전자식')}전자식 ${sel(pm['pressure_switch'], '그 밖의 것')}그 밖의 것)`,
    `◦ ${cb(has(pm['decompress']))}감압장치 ${gsel(pm['decompress_ground'])} (${slot(pm['decompress_floor'], '   ', h)})층, 설치장소:(${slot(pm['decompress_place'], '                  ', h)})`,
  ]
  const inletSys = (o: string) => `${mc(inlet['systems'], o)}${o}`
  const epType = (o: string) => `${mc(ep['types'], o)}${o}`

  return `<table class="form tight">
  <colgroup><col style="width:12mm"><col style="width:20mm"><col></colgroup>
  <tr>
    <th rowspan="2">수원</th>
    <td class="center">주된수원</td>
    <td class="pre">${sysLine(mw)}<br>◦ 설치장소: ${locLine(mw, '', h)}<br>◦ 흡입방식: ${sel(mw['intake'], '정압')}정압, ${sel(mw['intake'], '부압')}부압,   ◦ 유효수량: ${pv(mw['capacity'], 9, h)}㎥</td>
  </tr>
  <tr>
    <td class="center">보조수원</td>
    <td class="pre">◦ 설치장소: 동명(${slot(aw['dong'], '            ', h)}) 실명(${slot(aw['room'], '            ', h)}), ◦ 유효수량: ${pv(aw['capacity'], 9, h)}㎥</td>
  </tr>
  <tr>
    <th rowspan="4">가압<br>송수<br>장치</th>
    <td class="center">${cb(has(el['used']) || blockHas(el))}<br>고가수조</td>
    <td class="pre">${sysLine(el)}<br>◦ 설치장소: 동명(${slot(el['dong'], '            ', h)}) 실명(${slot(el['room'], '            ', h)}), ◦ 유효낙차: ${pv(el['head_drop'], 9, h)}m</td>
  </tr>
  <tr>
    <td class="center">${cb(has(pr['used']) || blockHas(pr))}<br>압력수조</td>
    <td class="pre">${sysLine(pr)}<br>◦ 설치장소: ${locLine(pr, '', h)}<br>◦ 수조용량: ${pv(pr['tank_volume'], 9, h)}ℓ, 수조가압압력:${pv(pr['tank_pressure'], 9, h)}MPa<br>◦ 자동식공기압축기 용량:${pv(pr['compressor_capacity'], 9, h)}㎥/min, 동 력:${pv(pr['compressor_power'], 9, h)}Kw</td>
  </tr>
  <tr>
    <td class="center">${cb(has(pz['used']) || blockHas(pz))}<br>가압수조</td>
    <td class="pre">${sysLine(pz)}<br>◦ 설치장소: ${locLine(pz, '', h)}<br>◦ 수조용량: ${pv(pz['tank_volume'], 9, h)}ℓ, 수조가압압력:${pv(pz['tank_pressure'], 9, h)}MPa<br>◦ 가압가스의 종류: ${sel(pz['gas_type'], '공기')}공기 ${sel(pz['gas_type'], '불연성가스')}불연성가스(${slot(pz['gas_etc'], '                  ', h)})</td>
  </tr>
  <tr>
    <td class="center">${cb(has(pm['used']) || blockHas(pm))}펌프방식</td>
    <td class="pre">${pumpLines.join('<br>')}</td>
  </tr>
  <tr>
    <th colspan="2">송수구</th>
    <td class="pre">${inletSys('옥내소화전설비')} ${inletSys('옥외소화전설비')} ${inletSys('스프링클러설비')} ${inletSys('간이스프링클러설비')}<br>${inletSys('화재조기진압용스프링클러설비')} ${inletSys('물분무소화설비')} ${inletSys('미분무소화설비')} ${inletSys('포소화설비')}<br>◦ 설치장소:(${slot(inlet['place'], '                  ', h)}), ${cb(has(inlet['twin_count']))}쌍구형 ${pv(inlet['twin_count'], 3, h)}개/${cb(has(inlet['single_count']))}단구형 ${pv(inlet['single_count'], 3, h)}개</td>
  </tr>
  <tr>
    <th colspan="2">비상전원</th>
    <td class="pre"> ${epType('자가발전설비')}(${sel(ep['gen_type'], '소방전용')}소방전용 ${sel(ep['gen_type'], '소방부하겸용')}소방부하겸용 ${sel(ep['gen_type'], '소방전원보존형')}소방전원보존형 ${sel(ep['gen_type'], '기타')}기타(${slot(ep['gen_etc'], '          ', h)}))<br> ${epType('비상전원수전설비')} ${epType('축전지설비')} ${epType('전기저장장치')}<br>◦ 설치장소: ${locLine(ep, '', h)}</td>
  </tr>
</table>`
}

// ── 3-3. 수계소화설비(개별사항) ─────────────────────────────────────────────
function renderS33(sec: Vals, h: boolean): string {
  const ih = blk(sec, 'indoor_hydrant')
  const oh = blk(sec, 'outdoor_hydrant')
  const sp = blk(sec, 'sprinkler')
  const ss = blk(sec, 'simple_sprinkler')
  const es = blk(sec, 'early_suppression')
  const ws = blk(sec, 'water_spray')
  const wm = blk(sec, 'water_mist')
  const fo = blk(sec, 'foam')

  return `<table class="form tight">
  ${specRow(`${cb(blockHas(ih))}옥내<br>소화전`, [
    ...rangeLines2(ih, h),
    `◦ 설치개수가 가장 많은 층의 설치개수: ${pv(ih['max_count'], 3, h)}개`])}
  ${specRow(`${cb(blockHas(oh))} 옥외<br>소화전`, [`◦ 설치개수: ${pv(oh['count'], 3, h)}개`])}
  ${specRow(`${cb(blockHas(sp))} 스프링클러설비`, [
    `◦ 종류: ${sel(sp['type'], '습식')}습식 ${sel(sp['type'], '부압식')}부압식 ${sel(sp['type'], '준비작동식')}준비작동식 ${sel(sp['type'], '건식')}건식 ${sel(sp['type'], '일제살수식')}일제살수식`,
    `◦ 설치장소: ${rangeLine(sp, h)}`])}
  ${specRow(`${cb(blockHas(ss))} 간이스프링클러설비`, [
    `◦ 종류: ${sel(ss['type'], '펌프')}펌프 ${sel(ss['type'], '캐비닛')}캐비닛 ${sel(ss['type'], '상수도')}상수도`,
    `◦ 설치장소: ${rangeLine(ss, h)}`])}
  ${specRow(`${cb(blockHas(es))} 화재<br>조기진압용`, rangeLines2(es, h))}
  ${specRow(`${cb(blockHas(ws))} 물분무소화설비`, rangeLines2(ws, h))}
  ${specRow(`${cb(blockHas(wm))} 미분무소화설비`, rangeLines2(wm, h))}
  ${specRow(`${cb(blockHas(fo))} 포<br>소화설비`, [
    `${mc(fo['system'], '포워터스프링클러설비')}포워터스프링클러설비 ${mc(fo['system'], '포헤드설비')}포헤드설비 ${mc(fo['system'], '고정포방출설비')}고정포방출설비 ${mc(fo['system'], '기타')}기타(${slot(fo['system_etc'], '               ', h)})`,
    `◦ 소화약제 ${mc(fo['agent'], '단백포')}단백포 ${mc(fo['agent'], '합성계면활성제포')}합성계면활성제포 ${mc(fo['agent'], '수성막포')}수성막포 ${mc(fo['agent'], '내알코올포')}내알코올포`,
    `◦ 설치장소: ${rangeLine(fo, h)}`])}
</table>`
}

// ── 3-4. 가스계소화설비(개별사항) ───────────────────────────────────────────
function renderS34(sec: Vals, h: boolean): string {
  const g = blk(sec, 'gas_system')
  const sy = (o: string) => mc(g['system'], o)
  const ag = (o: string) => mc(g['agent'], o)
  return `<table class="form tight">
  ${specRow(`${sy('이산화탄소')}이산화탄소<br>${sy('할론')}할론<br>${sy('할로겐화합물 및 불활성기체')}할로겐화합물<br> 및 불활성기체<br>${sy('분말')}분말<br>${sy('강화액')}강화액<br>${sy('고체에어로졸')}고체에어로졸`, [
    `${mc(g['discharge'], '전역방출')}전역방출 ${mc(g['discharge'], '국소방출')}국소방출 ${mc(g['discharge'], '호스릴')}호스릴 / ${sel(g['pressure_class'], '고압식')}고압식 ${sel(g['pressure_class'], '저압식')}저압식 / ${sel(g['charge_type'], '축압식')}축압식 ${sel(g['charge_type'], '가압식')}가압식`,
    `◦ 설치장소: ${rangeLine(g, h)}`,
    `◦ 저장용기 설치장소: ${gsel(g['storage_ground'])} (${slot(g['storage_floor'], '   ', h)})층, ${sel(g['storage_room'], '전용실')}전용실 ${sel(g['storage_room'], '기타')}기타(${slot(g['storage_room_etc'], '               ', h)})`,
    `  수량: ${pv(g['qty_amount'], 9, h)}${sel(g['qty_unit'], '㎏')}㎏,${sel(g['qty_unit'], '㎥')}㎥ ${pv(g['qty_liter'], 9, h)}ℓ ${pv(g['qty_count'], 9, h)}개`,
    `◦ 소화약제 ${ag('이산화탄소')}이산화탄소 ${ag('할론1301')}할론1301 ${ag('할론2402')}할론2402 ${ag('할론1211')}할론1211 ${ag('할론104')} 할론104`,
    ` ${ag('FC-3-1-10')}FC-3-1-10 ${ag('HCFC BLEND A')}HCFC BLEND A ${ag('HCFC-124')}HCFC-124 ${ag('HFC-125')}HFC-125 ${ag('HFC-227ea')}HFC-227ea`,
    ` ${ag('HFC-23')}HFC-23 ${ag('IG-541')}IG-541 ${ag('IG-100')}IG-100 ${ag('기타')} 기타(${slot(g['agent_etc'], '           ', h)})`,
    ` ${ag('제1종분말')}제1종분말 ${ag('제2종분말')}제2종분말 ${ag('제3종분말')}제3종분말 ${ag('제4종분말')}제4종분말`])}
</table>`
}

// ── 3-5. 경보설비 ───────────────────────────────────────────────────────────
/** 자탐·화재알림 공용 — detectionFields 대응.
 *  A4-4: 설치장소 둘째 줄은 **둘 다** 있다(현행 9호 원문 2줄 블록 8개에 모두 포함).
 *  종전엔 화재알림설비를 "원문에 없는 신설 설비"로 보고 1줄만 냈는데, 그 근거가 **구판 별지4호 샘플**이었다. */
function detectionLines(b: Vals, h: boolean, second = false): string[] {
  const det = b['detector']
  const detEtc = ['불꽃', '아날로그식', '복합형'].some(o => Array.isArray(det) && (det as unknown[]).map(String).includes(o))
  return [
    `◦ 수신기 위치: 동명(${slot(b['receiver_dong'], '            ', h)}) ${gsel(b['receiver_ground'])} (${slot(b['receiver_floor'], '   ', h)})층 실명(${slot(b['receiver_room'], '                ', h)})`,
    `◦ 경보방식 ${sel(b['alarm_mode'], '전층경보')}전층경보 ${sel(b['alarm_mode'], '우선경보')}우선경보, 시각경보기 ${sel(b['visual_alarm'], '유')}유 ${sel(b['visual_alarm'], '무')}무`,
    ...(second ? rangeLines2(b, h) : [`◦ 설치장소: ${rangeLine(b, h)}`]),
    `◦ 감지기종류 ${mc(det, '열')}열 ${mc(det, '연기')}연기 ${cb(detEtc)}그 밖의 것(${mc(det, '불꽃')}불꽃 ${mc(det, '아날로그식')}아날로그식 ${mc(det, '복합형')}복합형)`,
  ]
}

function renderS35(sec: Vals, h: boolean): string {
  const sd = blk(sec, 'standalone_detector')
  const eb = blk(sec, 'emergency_bell')
  const fd = blk(sec, 'fire_detection')
  const fa = blk(sec, 'fire_alert')
  const bc = blk(sec, 'broadcast')
  const im = blk(sec, 'integrated_monitor')
  const ar = blk(sec, 'auto_report')
  const la = blk(sec, 'leakage_alarm')
  const ga = blk(sec, 'gas_leak_alarm')

  return `<table class="form tight">
  ${specRow(`${cb(blockHas(sd))} 단독경보형<br>감지기`, [
    `◦ 설치장소: ${rangeLine(sd, h)}`,
    `◦ 주전원 ${sel(sd['power'], '상용전원')}상용전원 ${sel(sd['power'], '건전지')}건전지`])}
  ${specRow(`${cb(blockHas(eb))} 비상경보설비`, [
    `${mc(eb['type'], '비상벨설비')}비상벨설비 ${mc(eb['type'], '자동식사이렌설비')}자동식사이렌설비`,
    `◦ 설치장소: ${rangeLine(eb, h)}`,
    `◦ 조작장치 설치장소: 동명(${slot(eb['panel_dong'], '            ', h)}) ${gsel(eb['panel_ground'])} (${slot(eb['panel_floor'], '   ', h)})층 실명(${slot(eb['panel_room'], '              ', h)})`])}
  ${specRow(`${cb(blockHas(fd))} 자동화재<br>탐지설비`, detectionLines(fd, h, true))}
  ${specRow(`${cb(blockHas(fa))} 화재알림설비`, detectionLines(fa, h, true))}
  ${specRow(`${cb(blockHas(bc))} 비상방송설비`, [
    `${sel(bc['usage'], '전용')}전용 ${sel(bc['usage'], '겸용')}겸용 / ${sel(bc['alarm_mode'], '전층경보')}전층경보 ${sel(bc['alarm_mode'], '우선경보')}우선경보`,
    `◦ 증폭기 설치장소: ${locLine(bc, 'amp', h)}`])}
  ${specRow(`${cb(blockHas(im))} 통합감시시설`, [
    `◦ 주수신기 설치장소: ${locLine(im, 'main', h)}`,
    `◦ 부수신기 설치장소: ${locLine(im, 'sub', h)}`,
    `◦ 정보통신망 ${sel(im['network'], '광케이블')}광케이블 ${sel(im['network'], '기타')}기타(${slot(im['network_etc'], '            ', h)}) / 예비선로 ${sel(im['spare_line'], '유')}유 ${sel(im['spare_line'], '무')}무`])}
  ${specRow(`${cb(blockHas(ar))} 자동화재<br>속보설비`, [`◦ 속보기 설치장소: ${locLine(ar, 'reporter', h)}`])}
  ${specRow(`${cb(blockHas(la))} 누전경보기`, [
    `◦ 수신기 설치장소: ${locLine(la, 'receiver', h)}`,
    `◦ 수신기 형식 ${sel(la['grade'], '1급')}1급 ${sel(la['grade'], '2급')}2급, 차단기구 ${sel(la['breaker'], '무')}무 ${sel(la['breaker'], '유')}유(설치장소:${slot(la['breaker_place'], '                    ', h)})`])}
  ${specRow(`${cb(blockHas(ga))} 가스누설<br>경보기`, [
    `◦ ${sel(ga['form'], '단독형')}단독형 ${sel(ga['form'], '분리형')}분리형, 사용가스종류 ${sel(ga['gas'], 'LNG')}LNG ${sel(ga['gas'], 'LPG')}LPG, 경계구역 수: ${pv(ga['zone_count'], 5, h)}개`,
    `◦ 수신기 설치장소: ${locLine(ga, 'receiver', h)}`,
    `◦ 차단기구 ${sel(ga['breaker'], '무')}무 ${sel(ga['breaker'], '유')}유(설치장소:${slot(ga['breaker_place'], '                    ', h)})`])}
</table>`
}

// ── 3-6. 피난구조설비 ───────────────────────────────────────────────────────
function renderS36(sec: Vals, h: boolean): string {
  const ev = blk(sec, 'evac_equipment')
  const re = blk(sec, 'rescue_equipment')
  const gl = blk(sec, 'guide_light')
  const el = blk(sec, 'emergency_light')
  const pl = blk(sec, 'portable_light')
  const evT = (o: string) => `${mc(ev['types'], o)}${o}`
  const glT = (o: string) => `${mc(gl['types'], o)}${o}`

  return `<table class="form tight">
  ${specRow(`${cb(blockHas(ev))} 피난기구`, [
    `◦ 종류: ${evT('피난사다리')} ${evT('완강기')} ${evT('다수인피난장비')} ${evT('승강식피난기')} ${evT('미끄럼대')}`,
    `${evT('피난교')} ${evT('피난용트랩')} ${evT('구조대')} ${evT('간이완강기')} ${evT('공기안전매트')}`,
    // 통합 어휘 11종의 마지막 — 종전 1.4 대장에만 있어 세부현황에 인쇄되지 못하던 종류 (2026-08-08)
    `${evT('하향식피난구용내림식사다리')}`,
    ...rangeLines2(ev, h)])}
  ${specRow(`${cb(blockHas(re))} 인명구조기구`, [
    `◦ 종류: ${mc(re['types'], '방열복/방화복')}방열복/ 방화복 ${mc(re['types'], '공기호흡기')}공기호흡기 ${mc(re['types'], '인공소생기')}인공소생기`,
    ...rangeLines2(re, h),
    `◦ 대상물의 용도: ${mc(re['target_usage'], '5층이상 병원')} 5층이상 병원  ${mc(re['target_usage'], '7층이상 관광호텔')} 7층이상 관광호텔 ${mc(re['target_usage'], '이산화탄소소화설비 설치')} 이산화탄소소화설비 설치`,
    `${mc(re['target_usage'], '지하역사ㆍ백화점ㆍ대형점포ㆍ쇼핑센타ㆍ지하상가ㆍ영화상영관')} 지하역사ㆍ백화점ㆍ대형점포ㆍ쇼핑센타ㆍ지하상가ㆍ영화상영관`])}
  ${specRow(`${cb(blockHas(gl))} 유도등`, [
    `◦ 종류: ${glT('피난구')} ${glT('통로')} ${glT('객석유도등')} ${glT('유도표지')} ${glT('피난유도선')}`,
    `◦ 설치장소: ${rangeLine(gl, h)}`])}
  ${specRow(`${cb(blockHas(el))} 비상조명등`, [
    `◦ 설치장소: ${rangeLine(el, h)}`,
    `◦ 비상전원 ${mc(el['power'], '자가발전설비')}자가발전설비 ${mc(el['power'], '축전지설비')}축전지설비 ${mc(el['power'], '내장형')}내장형`])}
  ${specRow(`${cb(blockHas(pl))} 휴대용<br>비상조명등`, [
    `◦ 설치장소: ${rangeLine(pl, h)}`,
    `◦ 전원 ${sel(pl['power'], '건전지식')}건전지식 ${sel(pl['power'], '충전식 배터리식')}충전식 배터리식`])}
</table>`
}

// ── 3-7. 소화용수설비 ───────────────────────────────────────────────────────
function renderS37(sec: Vals, h: boolean): string {
  const ww = blk(sec, 'waterworks')
  const wt = blk(sec, 'water_tank')
  return `<table class="form tight">
  ${specRow(`${cb(blockHas(ww))} 상수도<br>소화용수`, [
    `◦ 설치장소:(${slot(ww['place'], '                  ', h)}), 소화전 호칭지름: ${pv(ww['diameter'], 9, h)}㎜`])}
  ${specRow(`${cb(blockHas(wt))} 소화수조`, [
    `◦ 가압송수장치  ${slot(wt['pump'], '          ', h)}`,
    `◦ ${cb(has(wt['priming']))}물올림장치 유효수량: ${pv(wt['priming_capacity'], 9, h)}ℓ, 급수배관: ${pv(wt['priming_pipe'], 9, h)}㎜`])}
</table>`
}

// ── 3-8. 소화활동설비 ───────────────────────────────────────────────────────
function renderS38(sec: Vals, h: boolean): string {
  const rm = blk(sec, 'smoke_room')
  const lb = blk(sec, 'smoke_lobby')
  const ri = blk(sec, 'riser')
  const sc = blk(sec, 'sprinkler_connect')
  const eo = blk(sec, 'emergency_outlet')
  const wl = blk(sec, 'wireless')
  const fs = blk(sec, 'fire_spread')

  const roomLines = [
    `◦ 설치장소: ${rangeLine(rm, h)}`,
    `◦ 방식 ${sel(rm['method'], '단독')}단독 ${sel(rm['method'], '공동')}공동 ${sel(rm['method'], '상호')}상호 ${sel(rm['method'], '기타')}기타(${slot(rm['method_etc'], '                  ', h)})`,
    `◦ 기동장치 ${mc(rm['starter'], '자동(감지기 연동)')}자동(감지기 연동) ${mc(rm['starter'], '수동')}수동 ${mc(rm['starter'], '원격')}원격`,
    `◦ 제연구획면적 최대: ${pv(rm['zone_area'], 9, h)}㎡ / 구조 ${sel(rm['zone_structure'], '내화')}내화 ${sel(rm['zone_structure'], '불연')}불연 ${sel(rm['zone_structure'], '그 밖의 것')}그 밖의 것:(${slot(rm['zone_structure_etc'], '          ', h)})`,
    `◦ 제연구역 출입문 ${sel(rm['door'], '상시폐쇄(자동폐쇄장치)')}상시폐쇄(자동폐쇄장치) ${sel(rm['door'], '상시개방(감지기에 의한 닫힘)')}상시개방(감지기에 의한 닫힘)`,
    ...fanLines(rm, 'supply_fan', '급기용송풍기', h),
    ...fanLines(rm, 'exhaust_fan', '배출용송풍기', h),
    `◦ 배출구 ${sel(rm['outlet_pos'], '천장면')}천장면 ${sel(rm['outlet_pos'], '천장직하')}천장직하 ${sel(rm['outlet_pos'], '기타')}기타(${slot(rm['outlet_pos_etc'], '      ', h)}) / 옥외배출구 ${sel(rm['outdoor_outlet'], '옥상')}옥상 ${sel(rm['outdoor_outlet'], '기타')}기타(${slot(rm['outdoor_outlet_etc'], '      ', h)})`,
    ` 풍도구조 ${sel(rm['exhaust_duct'], '내화')}내화 ${sel(rm['exhaust_duct'], '불연')}불연 ${sel(rm['exhaust_duct'], '그 밖의 것')}그 밖의 것(${slot(rm['exhaust_duct_etc'], '          ', h)}) / 구획댐퍼 ${sel(rm['exhaust_damper'], '유')}유 ${sel(rm['exhaust_damper'], '무')}무`,
    `◦ 유입공기배출 ${mc(rm['air_exhaust'], '자연배출')}자연배출 ${mc(rm['air_exhaust'], '기계배출')}기계배출 ${mc(rm['air_exhaust'], '배출구')}배출구 ${mc(rm['air_exhaust'], '제연설비')}제연설비`,
    `◦ 급기구 ${mc(rm['inlet_mode'], '강제유입')}강제유입 ${mc(rm['inlet_mode'], '자연유입')}자연유입 ${mc(rm['inlet_mode'], '인접구역유입')}인접구역유입`,
    ` 풍도구조 ${sel(rm['inlet_duct'], '내화')}내화 ${sel(rm['inlet_duct'], '불연')}불연 ${sel(rm['inlet_duct'], '그 밖의 것')}그 밖의 것(${slot(rm['inlet_duct_etc'], '          ', h)}) / 구획댐퍼 ${sel(rm['inlet_damper'], '유')}유 ${sel(rm['inlet_damper'], '무')}무`,
  ]

  const lobbyLines = [
    `◦ 설치대상: 동명(${slot(lb['targets'], '           ,           ,           ,           ,           ', h)})`,
    `  특별피난계단 ${pv(lb['stair_count'], 6, h)}개소, 비상용승강기 ${pv(lb['elevator_count'], 6, h)}대`,
    `◦ 방식 ${sel(lb['method'], '부속실')}부속실 ${sel(lb['method'], '계단실 및 부속실')}계단실 및 부속실 ${sel(lb['method'], '계단실')} 계단실 ${sel(lb['method'], '비상용승강기승강장')} 비상용승강기승강장`,
    `◦ 기동방식 ${sel(lb['start_mode'], '전층')}전층 ${sel(lb['start_mode'], '부분층')}부분층(${slot(lb['partial_floors'], '        ', h)}개층) / 댐퍼개방감지기 ${sel(lb['damper_detector'], '전용')}전용 ${sel(lb['damper_detector'], '겸용')}겸용`,
    ...fanLines(lb, 'supply_fan', '급기용송풍기', h),
    ...fanLines(lb, 'exhaust_fan', '배출용송풍기', h),
    `◦ 제연구역 출입문 ${sel(lb['door'], '상시폐쇄(자동폐쇄장치)')}상시폐쇄(자동폐쇄장치) ${sel(lb['door'], '상시개방(연기감지기에 의한 닫힘)')}상시개방(연기감지기에 의한 닫힘)`,
    `◦ 유입공기배출 ${mc(lb['air_exhaust'], '자연배출')}자연배출 ${mc(lb['air_exhaust'], '기계배출')}기계배출 ${mc(lb['air_exhaust'], '배출구')}배출구 ${mc(lb['air_exhaust'], '제연설비')}제연설비`,
    `◦ 과압방지장치 ${sel(lb['overpressure'], '플랩댐퍼')}플랩댐퍼 ${sel(lb['overpressure'], '자동차압(과압조절형)댐퍼')}자동차압(과압조절형)댐퍼 ${sel(lb['overpressure'], '그 밖의 것')}그 밖의 것 ${sel(lb['overpressure'], '해당없음')}해당없음`,
  ]

  const riserLines = [
    `${sel(ri['usage'], '전용')}전용 ${sel(ri['usage'], '겸용')}겸용(${mc(ri['shared_with'], '옥내소화전설비')}옥내소화전설비 ${mc(ri['shared_with'], '스프링클러설비')}스프링클러설비 ${mc(ri['shared_with'], '기타')}기타:${slot(ri['shared_etc'], '             ', h)})`,
    `◦ 설치장소: ${rangeLine(ri, h)}`,
    `◦ 송수구 설치장소:(${slot(ri['inlet_place'], '                  ', h)}), , 중간수조용량: ${pv(ri['mid_tank'], 9, h)}㎥`,
    `◦ 가압송수장치 설치장소: ${locLine(ri, 'pump', h)}`,
    `  전양정:${pv(ri['pump_head'], 9, h)}m, 토출량:${pv(ri['pump_flow'], 9, h)}ℓ/min`,
    `◦ 기동스위치 설치장소 ${mc(ri['start_switch'], '송수구')}송수구 ${mc(ri['start_switch'], '방재실')}방재실 ${mc(ri['start_switch'], '기타')}기타(${slot(ri['start_switch_etc'], '             ', h)})`,
  ]

  return `<table class="form tight">
  <colgroup><col style="width:12mm"><col style="width:14mm"><col></colgroup>
  <tr>
    <th rowspan="2">${cb(blockHas(rm) || blockHas(lb))}<br>제연<br>설비</th>
    <td class="center">${cb(blockHas(rm))}<br>거실</td>
    <td class="pre">${roomLines.join('<br>')}</td>
  </tr>
  <tr>
    <td class="center">${cb(blockHas(lb))}<br>전실</td>
    <td class="pre">${lobbyLines.join('<br>')}</td>
  </tr>
  <tr>
    <th colspan="2">${cb(blockHas(ri))}연결<br> 송수관</th>
    <td class="pre">${riserLines.join('<br>')}</td>
  </tr>
  <tr>
    <th colspan="2">${cb(blockHas(sc))}연결<br> 살수</th>
    <td class="pre">◦ 설치대상: 동명(${slot(sc['targets'], '           ,           ,           ,           ,           ', h)})<br>◦ 방식 ${sel(sc['method'], '습식')}습식 ${sel(sc['method'], '건식')}건식 / ${mc(sc['target_type'], '지하층')}지하층 ${mc(sc['target_type'], '판매시설')}판매시설 ${mc(sc['target_type'], '가스시설')}가스시설 ${mc(sc['target_type'], '부속된 연결통로')}부속된 연결통로<br>◦ 송수구 설치장소:(${slot(sc['inlet_place'], '                  ', h)}), 송수구역수: ${pv(sc['zone_count'], 9, h)}구역</td>
  </tr>
  <tr>
    <th colspan="2">${cb(blockHas(eo))}비상<br> 콘센트</th>
    <td class="pre">◦ 설치장소: ${rangeLineNoCoverage(eo, h)}<br>${mc(eo['power'], '3상 380V')}3상 380V ${mc(eo['power'], '단상 220V')}단상 220V / ${mc(eo['plug'], '접지형 2극 플러그접속기')}접지형 2극 플러그접속기 ${mc(eo['plug'], '접지형 3극 플러그접속기')}접지형 3극 플러그접속기</td>
  </tr>
  <tr>
    <th colspan="2">${cb(blockHas(wl))}무선<br> 통신보조</th>
    <td class="pre">◦ 설치장소: ${rangeLineNoCoverage(wl, h)}<br>${sel(wl['usage'], '전용')}전용 ${sel(wl['usage'], '공용')}공용 / 방식: ${sel(wl['method'], '누설동축케이블')}누설동축케이블 ${sel(wl['method'], '누설동축케이블과 안테나')}누설동축케이블과 안테나 ${sel(wl['method'], '안테나')}안테나<br>◦ 접속단자 설치장소(${slot(wl['terminals'], '              ', h)}), (${slot(wl['terminals2'], '              ', h)})</td>
  </tr>
  <tr>
    <th colspan="2">${cb(blockHas(fs))}연소<br> 방지</th>
    <td class="pre">◦ 방호대상물 ${mc(fs['target'], '전력사업용')}전력사업용 ${mc(fs['target'], '통신사업용')}통신사업용 ${mc(fs['target'], '그 밖의 것')}그 밖의 것(${slot(fs['target_etc'], '                  ', h)})<br>◦ 송수구역수: ${pv(fs['zone_count'], 9, h)}구역 / 구역간의 구획 ${sel(fs['partition'], '있다')}있다 ${sel(fs['partition'], '일부 있다')}일부 있다 ${sel(fs['partition'], '없다')}없다</td>
  </tr>
  <tr>
    <th colspan="2">비고</th>
    <td class="pre">※ 제연설비 설비개요 작성 시 최대 구역 1개소에 대하여 기입합니다.</td>
  </tr>
</table>`
}

// ── 조립 ────────────────────────────────────────────────────────────────────

const RENDERERS: Record<string, (sec: Vals, h: boolean) => string> = {
  s31_extinguisher: renderS31,
  s32_water_common: renderS32,
  s33_water_each: renderS33,
  s34_gas: renderS34,
  s35_alarm: renderS35,
  s36_evac: renderS36,
  s37_supply: renderS37,
  s38_activity: renderS38,
}

/** 세부현황 3-1~3-8 섹션 HTML 배열 — 카탈로그 순서·라벨 기준, 쪽 묶음은 호출부(템플릿)가 결정 */
export function renderSpecSections(specs: SpecMap, opts: SpecRenderOpts = {}): string[] {
  const h = !!opts.highlight
  return FACILITY_SPEC_SECTIONS.map((s, i) => {
    const no = opts.numbering === 'annex4' ? `${i + 1}.` : `${s.no}.`
    const raw = (specs[s.key] ?? {}) as Vals
    const vals = opts.derived ? applyDerived(s.key, raw, opts.derived) as Vals : raw
    const body = RENDERERS[s.key]?.(vals, h) ?? ''
    return `<div class="sec-title"> ${no} ${esc(s.label)}</div>\n${body}`
  })
}

/** 세부현황 비고(작성 안내) 표 — 별지 9호 4쪽 하단 원문 (템플릿 공용) */
export function specNoteTable(): string {
  return `<table class="form tight" style="margin-top:4px">
  <tr>
    <th style="width:14mm"> 비 고</th>
    <td class="pre small"> 1. 해당 특정소방대상물에 설치된 소방시설에 대하여만 작성이 가능합니다.<br> 2. [&nbsp;&nbsp;]에는 해당 시설에 √ 표를 하고, 세부 현황 및 설치된 수량을 기입합니다.<br> 3. 기입란이 부족한 경우 서식을 추가하여 작성할 수 있습니다.</td>
  </tr>
</table>`
}
