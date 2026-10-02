// B3 단위 — 소방계획서 PDF HTML(buildFirePlanHtml)의 1.10.3 블록이 분기·안전시설·확인사항을 인쇄하는가(해당/해당없음)
import { buildFirePlanHtml } from '../src/lib/fire-plan-template'
let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m, d) } }
const MARK = (s: string) => `__${s}__`
// test-fire-plan-blanks의 픽스처(전 섹션이 렌더되는 최소 입력)를 그대로 쓰고 forms.multiUse만 바꾼다
const baseFixture = {
  year: 2026, buildingName: '가상건물', address: '어딘가', purpose: '공동주택',
  // ⚠ 조립기가 `.length`를 무조건 부르는 배열은 **전부** 채운다(`d.brigade`·`d.zones`·`d.evacRoutes`).
  //   비우면 픽스처가 아니라 TypeError로 죽어 이 블록이 통째로 안 돈다.
  // ⚠ 조립기가 `.length`를 무조건 부르는 배열은 **전부** 채운다(`d.brigade`·`d.zones`·`d.evacRoutes`).
  //   비우면 픽스처가 아니라 TypeError로 죽어 이 블록이 통째로 안 돈다.
  facilities: [], brigade: [], zones: [], trainingMonth: null,
  hazards: [{ place: MARK('HAZ'), location: '지하1층', factors: ['유류'] }],
  // 🚨 피난 경로는 `forms.evacPlan`이 **아니라** 최상위 `d.evacRoutes`다(템플릿 57줄 주석).
  //   처음엔 `forms.evacPlan`에 심어 마커가 안 나왔는데, 그게 「템플릿이 안 찍는다」인지
  //   「내 픽스처가 틀렸다」인지 갈라야 했다 — 답은 후자였다.
  evacRoutes: [{ floor: '2층', route: MARK('EVAC'), guide: '', equip: '' }],
  // 개정이력은 forms가 아니라 **최상위** d.revisions다(조립기가 fire_plan_revisions에서 직접)
  revisions: [{ date: '2026-01-05', note: MARK('REV'), author: '홍작성', reviewer: '김검토', approver: '이승인' }],
}
const render = (mu: unknown) => buildFirePlanHtml({ ...baseFixture, forms: { multiUse: mu } } as unknown as Parameters<typeof buildFirePlanHtml>[0])
const on = render({ applicable: true, categories: { 노래연습장: '1' }, bizName: 'B3', location: '', owner: '', phone: '', hours: '', users: '', capacity: '',
  quarters: [2], facilities: ['피난기구', '유도등'], evacNote: '구조대', checks: { '1': 'O', '8': 'X' } })
const block = on.slice(on.indexOf('1.10.3 다중이용업소 현황'), on.indexOf('1.10.4'))
ok(block.includes('■ 2분기(4~6월)') && block.includes('☐ 1분기(1~3월)'), '분기 — 2분기만 체크')
ok(block.includes('■ 피난기구</span>(구조대)'), '피난기구 종류 괄호')
ok(block.includes('■ 유도등') && block.includes('☐ 소화기'), '안전시설 — 고른 것만')
ok(/1\. 소화기, 자동확산소화기 등 소화설비 외관상태 확인<\/td><td>○/.test(block), '확인사항 1 ○')
ok(/8\. 방염물품의 방염성능확인\(성적서 확인 등\)<\/td><td>×/.test(block), '확인사항 8 ×')
ok(/2\. 비상벨설비[^<]*<\/td><td>&nbsp;/.test(block), '미입력 결과는 빈칸')
const off = render({ applicable: false, categories: {}, bizName: '', location: '', owner: '', phone: '', hours: '', users: '', capacity: '', quarters: [1], checks: { '1': 'O' } })
const offBlock = off.slice(off.indexOf('1.10.3 다중이용업소 현황'), off.indexOf('1.10.4'))
ok(!offBlock.includes('안전점검') && !offBlock.includes('확인사항'), '해당없음이면 세 축 행이 없다(값이 저장돼 있어도)')
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
