// 실화면 — 별지 10호 **미리보기**(iframe srcDoc, gotenberg 불필요)에 총 이행기간이 인쇄되는가.
// 🎯 과녁은 「갈라진 회차」다: 불량/X는 있는데 폐지된 계획 칸이 비어 plannedCount=0인 회차.
//    수리 전에는 엑셀엔 법정 10일이 서고 **PDF는 공란**이었다(실측 5회차).
// ⚠ 이 검사는 스테이징 **실데이터**를 읽기만 한다(픽스처를 만들지 않는다) — 갈라짐 자체가
//   실데이터의 성질이라, 합성 픽스처로는 「그 상황」을 재현했다고 말할 수 없다.
import { launch, login, mkUser, delUser, check, summary, raw, BASE } from './_e2e-helpers.mjs'
const EMAIL='e2e-legalpdf@test.local'
// 🚨 과녁 선정에서 한 번 틀렸다. 갈라진 회차는 처음 센 5건이 아니라 **3건**이다 —
//   `monthly`(월간 작동)·`event`(일반관리) 회차는 작업대 단계가 ① 하나뿐이어서 **별지 10호를
//   애초에 내지 않는다**(실측: 단계버튼이 `checklist` 하나). 「데이터가 갈라졌다」와 「그 갈라짐이
//   문서로 새어 나온다」는 다른 질문이고, 뒤쪽만 결함이다.
const TARGETS=[
  ['da1c3d30-5b85-44f9-95b5-63943c2ce987','송학떡집(special_작동·불량2·X2)'],
]
const uid=await mkUser({email:EMAIL,name:'E2ELP',employeeId:'ELP',role:'admin'})
const {browser,page}=await launch()
page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000)
try{
  await login(page,EMAIL)
  for (const [id,label] of TARGETS){
    // 전제 — 이 회차가 정말 「갈라진 상태」인가(수기 총기간 없음 · 계획 칸 공란)
    const {data:ai}=await raw.from('annex_inputs').select('fields').eq('inspection_id',id).eq('annex_no','report10').maybeSingle()
    const tp=(ai?.fields?.totalPeriod ?? '')
    const {data:ds}=await raw.from('inspection_defects').select('action_plan, action_start, action_end').eq('inspection_id',id)
    const planned=(ds??[]).filter(d=>d.action_plan||d.action_start||d.action_end).length
    check(`[전제] ${label} 수기 총기간 없음`, !String(tp).includes('~'), `totalPeriod=${JSON.stringify(tp)}`)
    check(`[전제] ${label} 폐지된 계획 칸 공란(plannedCount=0)`, planned===0, `planned=${planned}`)

    await page.goto(`${BASE}/inspections/${id}`)
    await page.waitForSelector('[data-testid="workbench-stepbar"]')
    // 🚨 단계 키는 숫자가 아니라 이름이다(`checklist|cert|ownerReport|submit9|repair|submit11`).
    //   `data-step="4"`로 찾다 90초 타임아웃이 났다 — 제품이 아니라 이 검사가 틀렸다.
    // ⚠ 전환은 aria-current로 확인하고 안 되면 다시 누른다(차수 재조회 중엔 첫 클릭이 삼켜진다).
    const goStep = async (key) => {
      const btn = `[data-testid="workbench-stepbar"] button[data-step="${key}"]`
      for (let i=0;i<3;i++){
        if (!(await page.locator(btn).count())) return false
        await page.click(btn)
        const ok = await page.waitForSelector(`${btn}[aria-current="step"]`,{timeout:10000}).then(()=>true).catch(()=>false)
        if (ok) return true
      }
      return false
    }
    const iframe = page.locator('iframe[title="별지 10호 미리보기"]')
    let opened = false
    for (const key of ['submit9','repair']){
      if (!(await goStep(key))) continue
      if (await iframe.count().then(c=>c>0)) { opened = true; break }
      const seen = await iframe.waitFor({timeout:8000}).then(()=>true).catch(()=>false)
      if (seen) { opened = true; break }
    }
    check(`[전제] ${label} 별지10호 미리보기 화면에 도달`, opened)
    if (!opened) continue
    await iframe.waitFor({timeout:90000})
    // 미리보기가 조립을 마칠 때까지 — 고정 sleep 대신 「기간 칸이 채워지거나 3회 연속 빈 채」로 판정
    let srcDoc='', filled=false
    for (let i=0;i<30;i++){
      srcDoc=(await iframe.getAttribute('srcdoc')) ?? ''
      if (/\d{4}\s*년[\s\S]{0,40}~[\s\S]{0,40}\d{1,2}\s*일/.test(srcDoc)) { filled=true; break }
      await page.waitForTimeout(1000)
    }
    const m = srcDoc.match(/(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)\s*~\s*(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)/)
    check(`⭐ ${label} 별지10호 미리보기에 총 이행기간이 인쇄된다`, filled && !!m,
      m ? `${m[1].replace(/\s+/g,'')} ~ ${m[2].replace(/\s+/g,'')}` : '공란(= 수리 전 상태)')
    // 법정 기본은 **10일**이어야 한다(1호 수리·정비) — 20일이 조용히 서면 상한 위반이다
    if (m){
      const iso=s=>{const p=s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);return `${p[1]}-${String(p[2]).padStart(2,'0')}-${String(p[3]).padStart(2,'0')}`}
      const days=Math.round((new Date(iso(m[2]))-new Date(iso(m[1])))/86400000)+1
      check(`${label} 법정 기본 일수 = 10일(상한 20일을 조용히 넘지 않는다)`, days===10, `${days}일`)
    }
  }
}finally{ await browser.close(); await delUser(uid) }
summary()
