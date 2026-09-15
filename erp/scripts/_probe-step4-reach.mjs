import { launch, login, mkUser, delUser, BASE } from './_e2e-helpers.mjs'
const EMAIL='e2e-step4probe@test.local'
const uid=await mkUser({email:EMAIL,name:'E2ES4',employeeId:'ES4',role:'admin'})
const {browser,page}=await launch(); page.setDefaultTimeout(60000)
try{
  await login(page,EMAIL)
  for (const id of ['93d26d98-f3e0-4109-a8fd-c598681b9b33','8ef7cf05-f0ae-468f-9e11-b57598f73269']){
    await page.goto(`${BASE}/inspections/${id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]')
    const steps = await page.$$eval('[data-testid="workbench-stepbar"] button[data-step]',
      els => els.map(e => `${e.getAttribute('data-step')}${e.disabled?'(disabled)':''}`))
    console.log(`${id.slice(0,8)} 단계버튼: ${steps.join(' ')}`)
    const btn = '[data-testid="workbench-stepbar"] button[data-step="submit9"]'
    if (await page.locator(btn).count()){
      const dis = await page.locator(btn).isDisabled()
      console.log(`   submit9 disabled=${dis}`)
      if (!dis){ await page.click(btn); await page.waitForTimeout(3000)
        console.log(`   iframe 수=${await page.locator('iframe[title="별지 10호 미리보기"]').count()}`)
        console.log(`   report10 패널=${await page.locator('[data-annex-fields="report10"]').count()}`) }
    }
  }
}finally{ await browser.close(); await delUser(uid) }
