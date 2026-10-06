// 등록은 **예외 없이 법정 축**인가 — 2026-10-06 사용자 요청으로 등록 폼의 예외 스위치
// (「그래도 내가 입력한 점검일자로 잡겠습니다」)를 폐지했다. 종전 이 검사는 그 스위치의 저장·전파를 지켰다.
// 이제는 반대를 지킨다: 스위치가 없고, 저장값은 false이며, 과거 점검일자는 여전히 「점검 사실」로 1차를 연다.
import { launch, login, mkUser, delUser, cleanupCustomer, check, summary, raw } from './_e2e-helpers.mjs'
const EMAIL='e2e-anchor-persist@test.local'
const NAME=`ZZ예외저장${Math.random().toString(36).slice(2,6)}`
const uid=await mkUser({email:EMAIL,name:'E2EAP',employeeId:'EAP',role:'admin'})
let custId=null
const {browser,page}=await launch()
const fillDate=async(label,val)=>{
  // DateInput의 id는 텍스트 입력칸 자체에 붙는다(09-23 레이아웃 이후 라벨 부모엔 입력칸이 없다)
  await page.locator(label==='점검일자'?'#new-anchor-date':'#new-use-approval').fill(val)
}
try{
  await login(page,EMAIL)
  await page.goto('http://localhost:3000/customers/new')
  await page.waitForSelector('[data-testid="new-keydates"]',{timeout:25000})
  // 필수: 고객명·주소·점검일자·사용승인일·관계인
  await page.locator('#new-customer-name').fill(NAME)
  await page.waitForTimeout(400)
  await page.locator('input[placeholder="주소 검색 후 동/호수 등 추가 입력"]').fill('경기 양평군 지평면 지평의병로 123')
  await fillDate('점검일자','2026-09-11')
  await fillDate('사용승인일','1999-09-26')
  await page.locator('#contact-대표-name').fill('홍길동')
  await page.waitForTimeout(1500)
  check('예외 스위치가 없다 (사용자 폐지 2026-10-06)',(await page.locator('[data-testid="anchor-manual-toggle"]').count())===0)
  check('「이 날짜로 잡히는 일정」 칸이 없다',(await page.getByText('이 날짜로 잡히는 일정').count())===0)
  const btn=page.locator('button[type="submit"]').last()
  if(await btn.isDisabled()){
    const cl=await page.locator('text=/필수|입력해주세요/').allInnerTexts().catch(()=>[])
    console.log('미충족 안내:', cl.slice(0,8).join(' | '))
  }
  await btn.click({force:true})
  await page.waitForTimeout(6000)
  const {data}=await raw.from('customers').select('id,plan_anchor_manual,plan_anchor_date,use_approval_date').eq('customer_name',NAME).maybeSingle()
  custId=data?.id??null
  check('고객이 등록된다',!!data,JSON.stringify(data))
  check('예외 없이 저장된다(plan_anchor_manual=false)',data?.plan_anchor_manual===false,String(data?.plan_anchor_manual))
  if(custId){
    await new Promise(r=>setTimeout(r,3000))
    const {data:items}=await raw.from('inspection_plan_items').select('plan_type,scheduled_date,inspection_id').eq('customer_id',custId).neq('plan_type','monthly').order('scheduled_date')
    console.log('생성된 자체점검:',(items??[]).map(i=>`${i.scheduled_date} ${i.plan_type}`).join(' | '))
    // 과거·오늘 점검일자 = 점검 사실(2026-09-20 계약) — 예외 여부와 무관하게 1차는 입력한 날짜로 즉시 시작한다
    const {data:insp}=await raw.from('inspections').select('inspection_start_date,status').eq('customer_id',custId)
    check('등록과 동시에 1차 점검이 시작된다(점검업무 표시 축)',
      (insp??[]).length===1&&insp?.[0]?.status==='in_progress',JSON.stringify(insp))
    check('시작일 = 입력한 점검일자',insp?.[0]?.inspection_start_date==='2026-09-11',String(insp?.[0]?.inspection_start_date))
    // 차기 회차는 **법정 축** — 종합은 사용승인월(9월), 작동은 그 6개월 뒤(3월). 예외였다면 입력일(11일) 축이었다.
    const future=(items??[]).filter(i=>String(i.scheduled_date)>'2026-12-31')
    const legal=future.every(i=>{
      const m=String(i.scheduled_date).slice(5,7)
      return /종합/.test(i.plan_type)?m==='09':/작동/.test(i.plan_type)?m==='03':true
    })
    check('내년 일정이 **법정 축**(종합 9월·작동 3월)에 선다',future.length>0&&legal,future.map(i=>`${i.scheduled_date} ${i.plan_type}`).join(','))
  }
}finally{ await browser.close(); await cleanupCustomer(custId); await delUser(uid) }
summary()
