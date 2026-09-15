// 검증 — 별지 9호 2쪽 인쇄 칸(건축허가일·사용승인일·건축면적·높이) 라벨이
// **비었을 때만** 빨강인가. 🎯 핵심 단언은 「빨갛게 했는가」가 아니라 **「채우면 빨강이 사라지는가」**다
// (상시 빨강과 구별되지 않으면 이 변경은 아무 뜻이 없다).
import { launch, login, mkUser, delUser, mkCustomer, cleanupCustomer, check, summary, raw } from './_e2e-helpers.mjs'
const EMAIL='e2e-a9label@test.local'
const NAME=`ZZ라벨빨강${Math.random().toString(36).slice(2,6)}`
const uid=await mkUser({email:EMAIL,name:'E2EA9',employeeId:'EA9',role:'admin'})
let custId=null
const {browser,page}=await launch()
page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000)
// 🚨 계측기 함정: 고객 페이지는 **전 탭을 hidden으로 마운트**한다. 페이지 전역에서 라벨을
//   이름으로 찾으면 「사용승인일」은 기본정보 탭 것이 먼저 잡혀 **늘 평상**으로 보인다
//   (실제로 처음에 그렇게 1건 빨강이 났고, 제품이 아니라 이 함수가 틀렸다).
//   판정은 반드시 이 화면의 앵커 **안에서** 한다.
const red = async (label) => {
  const l = page.locator(`[data-a9-blank] label`).filter({hasText: label}).first()
  if (!(await l.count())) return null
  return (await l.getAttribute('class') ?? '').includes('text-red-500')
}
try{
  // 네 칸이 **전부 빈** 고객·건물 — 빨강 4개가 기대값
  custId=await mkCustomer({customer_name:NAME,created_by:uid,assigned_employee_id:uid,
    use_approval_date:null,plan_anchor_date:'2026-05-10',inspection_type:'종합',inspection_sub_type:'종합'})
  const {error:be}=await raw.from('buildings').insert({customer_id:custId,building_name:'1동',
    is_active:true,permit_date:null,building_area:null,height:null,created_by:uid})
  if(be) throw new Error('건물 생성 실패: '+be.message)

  await login(page,EMAIL)
  // 🚨 탭 키는 **`buildings`**다(`building`은 없는 키 — 그러면 탭 셸이 hidden으로 마운트만 해서
  //   요소는 4개 「붙어 있는데」 끝까지 보이지 않는다. 처음에 그 함정에 빠졌다).
  // ⚠ 1동이면 목록 표를 감추고 패널이 자동 펼쳐지므로 [보기·수정] 버튼이 없다 — 있을 때만 누른다.
  const openPanel = async () => {
    await page.goto(`http://localhost:3000/customers/${custId}?tab=buildings`)
    const btn = page.locator('[data-testid="building-open"]').first()
    if (await btn.count()) await btn.click({timeout:20000})
    await page.locator('[data-a9-blank]').first().waitFor({state:'visible',timeout:40000})
  }
  await openPanel()
  const n = await page.locator('[data-a9-blank]').count()
  check('네 칸에 판정 앵커가 붙어 있다', n===4, `${n}개`)

  for (const lab of ['건축허가일','사용승인일','건축면적(㎡)','높이(m)']) {
    const r = await red(lab)
    check(`[빈 칸] ${lab} 라벨이 빨강`, r===true, `red=${r}`)
  }
  const blanks1 = await page.locator('[data-a9-blank="1"]').count()
  check('공란 판정 4/4', blanks1===4, `${blanks1}개`)

  // 🎯 대조군 — DB에 값을 넣고 다시 열면 **빨강이 사라져야** 한다.
  //   이게 없으면 「상시 빨강」과 구별되지 않아 위 단언이 아무것도 증명하지 못한다.
  await raw.from('customers').update({use_approval_date:'2020-03-02'}).eq('id',custId)
  await raw.from('buildings').update({permit_date:'2019-05-01',building_area:120.5,height:9.9}).eq('customer_id',custId)
  await openPanel()
  const blanks2 = await page.locator('[data-a9-blank="1"]').count()
  check('⭐ 채우면 공란 판정이 0이 된다(상시 빨강이 아니다)', blanks2===0, `${blanks2}개 남음`)
  for (const lab of ['건축허가일','사용승인일','건축면적(㎡)','높이(m)']) {
    const r = await red(lab)
    check(`[채운 칸] ${lab} 라벨이 평상`, r===false, `red=${r}`)
  }
  // 음성 축 — 필수 별표는 그대로 남아야 한다(빨강과 뜻이 다르다)
  const stars = await page.locator('[data-a9-blank] label span:text-is("*")').count()
  check('(음성) 필수 별표는 사라지지 않았다', stars===2, `${stars}개(건축허가일·건축면적)`)
}finally{ await browser.close(); await cleanupCustomer(custId); await delUser(uid) }
summary()
