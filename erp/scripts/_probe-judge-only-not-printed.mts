// 판정 전용(judgeOnly) 필드가 **법정 서식에 인쇄되지 않는가** — 구조 가드 (2026-09-07)
//
//  자동 ／ 판정을 위해 서식에 없는 칸(연결살수 헤드 형식·가스계 기동장치 방식)을 세부제원에 더했다.
//  이 칸이 별지 4호 3~7쪽·9호 4~7쪽에 찍히면 **법정 서식이 변형된다**. 지금은 인쇄 레이아웃이
//  손으로 쓴 서식 원문 재현이라 저절로 새지 않지만, 그 사실은 주석이 아니라 검사로 지켜야 한다
//  (다음 사람이 spec-sections를 카탈로그 순회로 리팩터하면 조용히 새어 나간다).
//
// 실행: npx tsx --conditions=react-server scripts/_probe-judge-only-not-printed.mts
// @ts-expect-error mjs 헬퍼
import { check, summary } from './_e2e-helpers.mjs'
import { FACILITY_SPEC_SECTIONS } from '../src/lib/facility-spec-schema'
import { renderSpecSections } from '../src/lib/doc-templates/spec-sections'

// 판정 전용 필드 전수 — 카탈로그에서 스스로 찾는다(목록을 손으로 적으면 다음 필드가 누락된다)
const judgeFields: Array<{ section: string; block: string; field: string; label: string }> = []
for (const sec of FACILITY_SPEC_SECTIONS) {
  for (const bl of sec.blocks) {
    for (const f of bl.fields) {
      if (f.judgeOnly) judgeFields.push({ section: sec.key, block: bl.key, field: f.key, label: f.label })
    }
  }
}
check('판정 전용 필드가 실재한다(가드가 공허하지 않다)', judgeFields.length >= 2, `${judgeFields.length}개`)

// 각 판정 필드에 **눈에 띄는 표식 값**을 넣고, 인쇄 HTML에 그 값·라벨이 안 나오는지 본다.
// 값 자체를 찾는 것이 요점이다 — 라벨만 보면 우연히 같은 낱말이 서식에 있을 때 헛경보가 난다.
const MARK = 'ZZJUDGEONLYZZ'
const specs: Record<string, Record<string, unknown>> = {}
for (const jf of judgeFields) {
  specs[jf.section] ??= {}
  const sec = specs[jf.section] as Record<string, Record<string, unknown>>
  sec[jf.block] ??= {}
  sec[jf.block][jf.field] = MARK
}

for (const form of ['annex9', 'annex4'] as const) {
  const html = renderSpecSections(specs, { form }).join('\n')
  check(`${form} — 판정 전용 값이 인쇄물에 없다`, !html.includes(MARK),
    html.includes(MARK) ? '표식이 인쇄됐다(서식 변형)' : '')
  for (const jf of judgeFields) {
    check(`${form} — '${jf.label}' 라벨이 인쇄물에 없다`, !html.includes(jf.label))
  }
}

// 대조군 — 서식에 **있는** 값은 실제로 인쇄된다(위 단언이 '아무것도 안 찍힌다'는 항진명제가 아님을 증명)
const control = { s38_activity: { sprinkler_connect: { inlet_place: 'CTRLPLACE' } } }
const ctrlHtml = renderSpecSections(control, { form: 'annex9' }).join('\n')
check('대조군 — 서식에 있는 칸(송수구 설치장소)은 인쇄된다', ctrlHtml.includes('CTRLPLACE'))

summary()
