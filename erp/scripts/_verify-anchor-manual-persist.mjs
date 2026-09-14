// 예외 체크가 **DB까지 가는가** — 화면만 바뀌고 저장이 안 되면 등록 후 일정이 법정 축으로 돌아간다.
import { launch, login, mkUser, delUser, cleanupCustomer, check, summary, raw } from './_e2e-helpers.mjs'
const EMAIL='e2e-anchor-persist@test.local'
const NAME=`ZZ예외저장${Math.random().toString(36).slice(2,6)}`
const uid=await mkUser({email:EMAIL,name:'E2EAP',employeeId:'EAP',role:'admin'})
let custId=null
const {browser,page}=await launch()
const fillDate=async(label,val)=>{
  const f=page.locator(`label:has-text("${label}")`).locator('xpath=..').first()
  await f.locator('input:not([type="date"])').first().fill(val)
}
try{
  await login(page,EMAIL)
  await page.goto('http://localhost:3000/customers/new')
  await page.waitForSelector('[data-testid="new-schedule-preview"]',{timeout:25000})
  await page.locator('input[placeholder*="고객"], #customer-name, input').first().click().catch(()=>{})
  // 필수: 고객명·주소·점검일자·사용승인일·대표
  await page.locator('label:has-text("고객명")').locator('xpath=..').first().locator('input').first().fill(NAME)
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill('경기 양평군 지평면 지평의병로 123')
  await fillDate('점검일자','2026-09-11')
  await fillDate('사용승인일','1999-09-26')
  await page.locator('#contact-대표-name').fill('홍길동')
  await page.waitForFunction(()=>document.querySelector('[data-testid="anchor-manual-toggle"]')!=null,{timeout:20000})
  await page.locator('[data-testid="anchor-manual-toggle"]').check()
  await page.waitForTimeout(1500)
  const btn=page.locator('button[type="submit"]').last()
  console.log('버튼 라벨:', await btn.innerText())
  console.log('버튼 disabled:', await btn.isDisabled())
  if(await btn.isDisabled()){
    const cl=await page.locator('text=/필수|입력해주세요/').allInnerTexts().catch(()=>[])
    console.log('미충족 안내:', cl.slice(0,8).join(' | '))
  }
  await btn.click({force:true})
  await page.waitForTimeout(6000)
  const {data}=await raw.from('customers').select('id,plan_anchor_manual,plan_anchor_date,use_approval_date').eq('customer_name',NAME).maybeSingle()
  custId=data?.id??null
  check('고객이 등록된다',!!data,JSON.stringify(data))
  check('예외 체크가 DB에 저장된다(plan_anchor_manual=true)',data?.plan_anchor_manual===true,String(data?.plan_anchor_manual))
  if(custId){
    await new Promise(r=>setTimeout(r,3000))
    const {data:items}=await raw.from('inspection_plan_items').select('plan_type,scheduled_date').eq('customer_id',custId).neq('plan_type','monthly').order('scheduled_date')
    console.log('생성된 자체점검:',(items??[]).map(i=>`${i.scheduled_date} ${i.plan_type}`).join(' | '))
    // ⚠ 당월 항목이 이미 지났으면 생성기가 **오늘 이후 첫 영업일로 보정**한다
    //   (inspection-plan-generator.ts:307 — 등록 직후부터 지연⚠로 뜨는 것 방지).
    //   그래서 2026-09-11(과거)은 오늘로 당겨지는 게 정상이다. 기산 '일'이 11인지는
    //   **보정 대상이 아닌 내년 항목**으로 판정한다(2026-09-14: 처음엔 이 규칙을 몰라 빨강이 났다).
    const future=(items??[]).filter(i=>String(i.scheduled_date)>'2026-12-31')
    const day11=future.every(i=>{
      const d=Number(String(i.scheduled_date).slice(8,10))
      return d>=11&&d<=13           // 11일 기준 + 주말이면 다음 영업일(최대 13일)
    })
    check('내년 일정이 **입력한 점검일자의 일(11)** 기준으로 선다',future.length>0&&day11,future.map(i=>i.scheduled_date).join(','))
    check('법정 축(09-28)으로 서지 않는다',!(items??[]).some(i=>String(i.scheduled_date).slice(5)==='09-28'),(items??[]).map(i=>i.scheduled_date).join(','))
  }
}finally{ await browser.close(); await cleanupCustomer(custId); await delUser(uid) }
summary()
