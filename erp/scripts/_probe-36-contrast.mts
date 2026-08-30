// 소방계획서_36 S6 — 텍스트 대비(contrast) 전수 검사 프로브
//
// 저장소에 **텍스트 대비율 검사기가 없었다**. _probe-29-light-scan.mts는 배경 휘도만 본다
// (lum=(0.2126R+0.7152G+0.0722B)/255, 감마 미보정). 그건 "밝은 면 찾기"에는 충분했지만
// 전경/배경 대비는 구조적으로 못 본다 — **ink-faint가 읽는 글자에 쓰인 결함이 29 판정을
// 통과한 이유가 이것이다**. 그 근사식은 여기로 복사하지 않는다(D-7).
//
// 실행: npx tsx scripts/_probe-36-contrast.mts            (게이트 — 래칫)
//       npx tsx scripts/_probe-36-contrast.mts --report   (보고 전용 — S1-5 baseline 채취)
// @ts-expect-error mjs 헬퍼
import { raw, BASE, check, summary, mkUser, delUser, mkCustomer, cleanupCustomer, launch, login } from './_e2e-helpers.mjs'

const REPORT_ONLY = process.argv.includes('--report')

/** S6-9 래칫 기준선 — S1-5로 채취해 여기 박는다. null이면 게이트가 서지 않는다(보고만).
 *  ⚠ '0으로 조이기'는 S7 완료 후에만. 처음부터 0을 요구하면 아무도 못 켜고 게이트가 꺼진다. */
/** S6-9 래칫 기준선 — S5 반영 후 **커버리지 전건 통과** 상태에서 채취(2026-08-30).
 *  ⚠ 최초 baseline(라이트 524·다크 334)은 폐기했다: 다크 드로어가 215칸만 걷힌 미렌더 실행이라
 *  다크 수가 거짓으로 낮았다. 정상 커버리지에서는 그 자리가 293칸이다.
 *  ⚠ ±2~3 편차가 정상이다 — FAIL 수는 화면에 그려진 **행 수**에 비례하는데 목록·달력의 행은
 *  다른 세션이 테스트 데이터를 만들고 지우면서 흔들린다. 그래서 실측에 여유를 둔다.
 *  이력: 524/334(폐기 — 다크 미렌더) → 513/381(S5) → 430/297(S7 1차)
 *        → **400/268(S7 2차, 실측 395/263)**. */
const BASELINE: { light: number; dark: number } | null = { light: 400, dark: 268 }

/** 라우트별 **검사 대상 수 하한**(S6-9 보강, 2026-08-30).
 *
 *  ⚠ FAIL 수만 보는 래칫은 '안 그려져서 초록'을 구조적으로 못 잡는다 — 페이지가 덜 렌더되면
 *  검사 대상이 줄어 FAIL도 같이 줄고, 그게 **개선으로 보인다**. 실제로 최초 baseline의
 *  다크 드로어가 215칸만 걷혀 334로 기록됐다(정상 실행은 293칸·112 FAIL). 그 수를 그대로
 *  래칫에 박았으면 이후 정상 실행이 전부 '악화'로 실패했을 것이다.
 *  그래서 커버리지를 **별도 축**으로 단언한다(35 세션이 --overflow에서 겪은 것과 같은 함정). */
const COVERAGE_FLOOR: Record<string, number> = {
  '점검 목록': 200, '점검 달력': 170,
  '작업대 1단계': 220, '작업대 2단계': 75, '작업대 3단계': 70,
  '작업대 4단계': 100, '작업대 5단계': 95, '작업대 6단계': 88,
  '점검표 드로어(열림)': 270,
}
/* S1-5 채취 2026-08-30 (소스 무변경 · dev :3000 · 뷰포트 1600×1000 · 9라우트 × 2모드).
   ⚠ 이 수치는 **파싱 수리 이후** 값이다. 수리 전 첫 측정은 lab()/oklab() 미파싱으로
   흰 글자를 1:1 오탐 처리해 라이트 37/40대의 **낮은** 수를 줬다 — 오탐이 섞인 baseline을
   래칫에 박았으면 진짜 악화를 영원히 못 잡았을 것이다(F-9). */

/** S6-10 자가검증 오라클 — scripts/_probe-36-wcag-constants.mjs가 계산한 값.
 *  ⚠ 소방계획서_36 문서(§2.3)의 다크 수치 3.14·6.76·4.76은 **오기**였다(2026-08-30 재계산).
 *     프로브가 이 표를 재현하지 못하면 프로브가 틀린 것이다. */
const ORACLE = {
  light: { 'ink-faint': 2.16, 'ink-sub': 7.86, 'ink': 19.41 },
  dark: { 'ink-faint': 3.05, 'ink-sub': 6.57, 'ink': 13.40 },
}

/* 브라우저 식은 **문자열**로 넘긴다 — tsx가 함수에 __name을 주입해 page.evaluate가 깨진다
   (_probe-29-light-scan.mts와 같은 이유). */
const HELPERS = `
  /* ⚠ 색 문자열을 정규식으로 파싱하지 않는다. Tailwind v4는 팔레트를 **최신 색공간**으로 낸다 —
     실측(2026-08-30): bg-red-500 → "lab(55.4814 75.0732 48.8528)",
     조상 배경 → "oklab(0.604458 0.051835 -0.186825 / 0.1)".
     rgb()만 받는 정규식은 이들을 null로 흘려 **배경을 못 찾고 흰색으로 떨어뜨린다**
     → 흰 글자가 1:1 오탐으로 쏟아졌다. 브라우저에게 직접 sRGB로 칠하게 해서 받는다. */
  var __cv = document.createElement('canvas'); __cv.width = 1; __cv.height = 1;
  var __ctx = __cv.getContext('2d', { willReadFrequently: true });
  function __paint(s, sentinel){
    __ctx.clearRect(0,0,1,1);
    __ctx.fillStyle = sentinel;
    __ctx.fillStyle = s;          /* 못 읽는 값이면 이 대입이 **조용히 무시**된다 */
    __ctx.fillRect(0,0,1,1);
    var d = __ctx.getImageData(0,0,1,1).data;
    return [d[0], d[1], d[2], d[3]/255];
  }
  /* 서로 다른 두 sentinel로 두 번 칠해 본다. 값이 유효하면 결과가 같고,
     무시됐으면 sentinel이 그대로 남아 검정/흰색으로 갈린다 — '무시'와 '진짜 검정'을 가른다.
     (한 번만 칠하면 무효값이 sentinel 색으로 **조용한 오답**이 된다) */
  function parse(s){
    if(!s) return null;
    var a = __paint(s, '#000'), b = __paint(s, '#fff');
    if(a[0]!==b[0] || a[1]!==b[1] || a[2]!==b[2] || a[3]!==b[3]) return null;
    return a;
  }
  function lin(c){ c=c/255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
  function lum(p){ return 0.2126*lin(p[0]) + 0.7152*lin(p[1]) + 0.0722*lin(p[2]); }
  function over(f,b){ var a=f[3]; return [f[0]*a+b[0]*(1-a), f[1]*a+b[1]*(1-a), f[2]*a+b[2]*(1-a)]; }
  function ratio(a,b){ var x=lum(a), y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  /* S6-2 — 조상을 거슬러 **실효 배경**을 합성한다. 부모 배경 상속을 무시하면
     투명 배경 위의 글자가 전부 흰 배경으로 계산돼 오탐이 쏟아진다. */
  function effBg(el){
    var stack=[];
    for(var n=el; n; n=n.parentElement){
      var c=parse(getComputedStyle(n).backgroundColor);
      if(!c || c[3]===0) continue;
      stack.push(c);
      if(c[3]>=0.999) break;
    }
    var base=[255,255,255];
    if(stack.length && stack[stack.length-1][3]>=0.999) base=stack.pop().slice(0,3);
    for(var i=stack.length-1;i>=0;i--) base=over(stack[i],base);
    return base;
  }
  function cumOpacity(el){
    var o=1;
    for(var n=el;n;n=n.parentElement){
      var v=parseFloat(getComputedStyle(n).opacity);
      if(!isNaN(v)) o*=v;
      if(o<0.5) return o;
    }
    return o;
  }
`

const SCAN = `(function(){
  ${HELPERS}
  var out=[], warn=[], counted=0;
  var els=document.querySelectorAll('body *');
  for(var i=0;i<els.length;i++){
    var el=els[i], tag=el.tagName;
    if(tag==='SCRIPT'||tag==='STYLE'||tag==='NOSCRIPT'||tag==='OPTION') continue;
    var cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none') continue;
    var r=el.getBoundingClientRect();
    if(r.width<1||r.height<1) continue;                       // S6-6: 0-size
    if(el.closest('[aria-hidden="true"]')) continue;          // S6-6: 보조기술 비노출
    if(el.disabled===true||el.closest('[disabled]')) continue; // S6-6: 비활성은 대비 대상 아님
    if(cumOpacity(el)<0.5) continue;                          // S6-6: 흐린 요소

    /* 직계 텍스트 노드만 — 컨테이너까지 세면 같은 글자가 조상 수만큼 중복된다 */
    var txt='';
    for(var j=0;j<el.childNodes.length;j++){
      var n=el.childNodes[j];
      if(n.nodeType===3) txt+=n.nodeValue;
    }
    txt=txt.replace(/\\s+/g,' ').trim();

    var isPh=false, colorStr=cs.color;
    if(!txt){
      /* S6-6: placeholder는 **별도 WARN 버킷**. FAIL에 섞으면 목록이 못 쓰게 된다
         (placeholder는 의도적으로 흐린 것이 관행이라 수가 많다) */
      if((tag==='INPUT'||tag==='TEXTAREA') && el.placeholder && !el.value){
        isPh=true; txt='[ph] '+el.placeholder;
        var pc=getComputedStyle(el,'::placeholder').color;
        if(pc) colorStr=pc;
      } else continue;
    }

    var fg=parse(colorStr); if(!fg) continue;
    if(fg[3]===0) continue;
    var bg=effBg(el);
    var fgc = fg[3]<1 ? over(fg,bg) : [fg[0],fg[1],fg[2]];
    var fs=parseFloat(cs.fontSize)||0;
    var fw=parseInt(cs.fontWeight,10)||400;
    /* S6-4 — 큰 텍스트는 임계가 3.0:1. ≥24px 또는 ≥18.66px+bold */
    var large = fs>=24 || (fs>=18.66 && fw>=700);
    var need = large?3.0:4.5;
    var cr = ratio(fgc,bg);
    counted++;
    if(cr>=need) continue;
    var cls=(typeof el.className==='string'?el.className:'').slice(0,110);
    var rec={ ratio:Math.round(cr*100)/100, need:need, fs:fs, fw:fw, large:large,
              tag:tag, cls:cls, color:colorStr,
              bg:'rgb('+bg[0].toFixed(0)+','+bg[1].toFixed(0)+','+bg[2].toFixed(0)+')',
              text:txt.slice(0,44) };
    if(isPh) warn.push(rec); else out.push(rec);
  }
  out.sort(function(a,b){return a.ratio-b.ratio;});           // S6-7: ratio 오름차순
  warn.sort(function(a,b){return a.ratio-b.ratio;});
  return JSON.stringify({fail:out, warn:warn, counted:counted});
})()`

/** S6-10 — 알려진 토큰 쌍으로 프로브 자체를 검증한다. 프로브가 곧 스펙 위험이다(위험 ④). */
const SELFTEST = `(function(){
  ${HELPERS}
  var probe=document.createElement('div');
  probe.style.position='fixed'; probe.style.left='-9999px'; probe.style.top='0';
  probe.style.background='var(--t-surface)';
  document.body.appendChild(probe);
  var res={};
  var toks=['ink-faint','ink-sub','ink'];
  for(var i=0;i<toks.length;i++){
    var s=document.createElement('span');
    s.style.color='var(--t-'+toks[i]+')';
    s.textContent='x';
    probe.appendChild(s);
    var fg=parse(getComputedStyle(s).color);
    var bg=effBg(s);
    res[toks[i]]=Math.round(ratio([fg[0],fg[1],fg[2]],bg)*100)/100;
  }
  /* ⚠ 색공간 축 — 위 세 토큰은 전부 hex라 rgb()로 직렬화된다. **그래서 이 자가검증이
     lab()/oklab()을 못 보고 통과했다**(2026-08-30 실결함: bg-red-500이 lab()이라
     파싱 실패 → 흰 배경으로 떨어져 1:1 오탐). 최신 색공간을 명시적으로 한 칸 태운다. */
  var wk=document.createElement('span');
  wk.style.color='#ffffff';
  wk.style.background='lab(55.4814 75.0732 48.8528)';   /* = bg-red-500 */
  wk.textContent='x';
  probe.appendChild(wk);
  var wfg=parse(getComputedStyle(wk).color);
  var wbg=effBg(wk);
  res['lab-bg']=Math.round(ratio([wfg[0],wfg[1],wfg[2]],wbg)*100)/100;
  /* 알파 합성 축 — oklab(… / 0.1) 조상이 실재한다(사이드바 활성 항목) */
  res['lab-parsed']=parse('oklab(0.604458 0.051835 -0.186825 / 0.1)') ? 1 : 0;
  document.body.removeChild(probe);
  return JSON.stringify(res);
})()`

type Rec = {
  ratio: number; need: number; fs: number; fw: number; large: boolean
  tag: string; cls: string; color: string; bg: string; text: string
}
type ScanOut = { fail: Rec[]; warn: Rec[]; counted: number }

const EMAIL = 'contrast-probe@erp-test.com'
let userId = '', cust = '', insp = ''
let browser: Awaited<ReturnType<typeof launch>>['browser'] | null = null

/** S6-7 — class 서명으로 묶는다. "한 번 고치면 몇 개가 낫는지"가 보여야 착수 순서가 정해진다. */
function group(list: Rec[]) {
  const m = new Map<string, { n: number; worst: number; rec: Rec }>()
  for (const r of list) {
    const key = `${r.tag}|${r.cls}|${r.color}`
    const cur = m.get(key)
    if (cur) { cur.n++; if (r.ratio < cur.worst) { cur.worst = r.ratio; cur.rec = r } }
    else m.set(key, { n: 1, worst: r.ratio, rec: r })
  }
  return [...m.values()].sort((a, b) => a.worst - b.worst)
}

/** 커버리지 미달을 잡는다 — 덜 그려진 화면의 낮은 FAIL 수는 개선이 아니다 */
function checkCoverage(mode: string, route: string, counted: number) {
  const floor = COVERAGE_FLOOR[route]
  if (floor === undefined) return
  check(`커버리지 [${mode}] ${route} ≥ ${floor}칸`, counted >= floor,
    `실제 ${counted}칸 — 덜 그려진 화면은 FAIL이 적게 나와 '개선'으로 오독된다`)
}

function report(label: string, s: ScanOut) {
  console.log(`\n── ${label} — 검사 ${s.counted}개 · FAIL ${s.fail.length} · WARN(placeholder) ${s.warn.length}`)
  // 보고 모드에서는 **전량**을 낸다 — S7 확산 대상을 이 목록에서 고르므로 잘리면 안 된다
  for (const g of group(s.fail).slice(0, REPORT_ONLY ? 9999 : 18)) {
    const r = g.rec
    console.log(`   ${String(g.worst).padStart(5)}:1 (필요 ${r.need})  ×${g.n}  ${r.fs}px/${r.fw}${r.large ? ' 큰글자' : ''}  <${r.tag}> ${r.cls}`)
    console.log(`            색 ${r.color} / 배경 ${r.bg}  "${r.text}"`)
  }
  if (s.warn.length) {
    console.log(`   — WARN(placeholder) ${group(s.warn).length}종`)
    for (const g of group(s.warn).slice(0, 5)) {
      console.log(`     ${String(g.worst).padStart(5)}:1  ×${g.n}  "${g.rec.text}"`)
    }
  }
}

try {
  userId = await mkUser({ email: EMAIL, name: '대비프로브', employeeId: 'E2E-CTR' })
  cust = await mkCustomer({ customer_name: 'ZZ대비프로브고객', created_by: userId })
  {
    const { data, error } = await raw.from('inspections').insert({
      customer_id: cust, inspection_type: '작동', sequence_num: 1, plan_type: 'special_작동',
      inspection_start_date: '2026-07-01', status: 'in_progress',
      assigned_employee_id: userId, created_by: userId,
    }).select('id').single()
    if (error) throw new Error(`점검 생성 실패: ${error.message}`)
    insp = data!.id as string
  }
  // 불량 1건 — 없으면 ⑤⑥이 '해당없음'으로 접혀 두 단계를 아예 못 본다
  await raw.from('inspection_defects').insert({
    inspection_id: insp, defect_code: 'A-01', defect_name: 'ZZ대비불량', severity: '보통',
  })

  const l = await launch()
  browser = l.browser
  const page = l.page
  await page.setViewportSize({ width: 1600, height: 1000 })
  page.setDefaultTimeout(120000)   // dev 콜드 컴파일 대비(실측: /login 47s) — 상한만 늘린다
  await login(page, EMAIL)

  const totals: Record<string, number> = {}

  for (const mode of ['light', 'dark'] as const) {
    if (mode === 'dark') {
      // _probe-29-light-scan.mts의 다크 전환 절차 재사용(S6-1)
      await page.goto(`${BASE}/settings`)
      await page.waitForSelector('[data-testid="theme-option-dark"]')
      await page.click('[data-testid="theme-option-dark"]')
      await page.waitForSelector('[data-testid="theme-saved"]', { timeout: 15000 })
    }

    // ── S6-10 자가검증 먼저 — 프로브가 틀렸으면 아래 수치는 전부 무의미하다
    await page.goto(`${BASE}/inspections`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const self = JSON.parse(await page.evaluate(SELFTEST) as string) as Record<string, number>
    for (const [tok, want] of Object.entries(ORACLE[mode])) {
      const got = self[tok]
      check(`S6-10 자가검증 ${mode} ${tok} = ${want}:1`, Math.abs(got - want) <= 0.06,
        `계산 ${got} / 기대 ${want}`)
    }
    /* 색공간 축 — 파싱이 깨지면 배경을 못 찾아 흰색으로 떨어지고 흰 글자가 **정확히 1.0**이 된다.
       그 서명을 직접 막는다(수치 핀은 Chrome 버전에 흔들려 실익이 없다). */
    check(`S6-10 ${mode} lab() 배경을 찾는다 (1.0 아님)`, Math.abs(self['lab-bg'] - 1) > 0.01,
      `lab-bg=${self['lab-bg']} — 1.0이면 배경 파싱 실패(오탐 발생)`)
    check(`S6-10 ${mode} oklab(…/알파) 파싱된다`, self['lab-parsed'] === 1)

    let modeFail = 0
    const routes: Array<[string, string]> = [
      ['/inspections', '점검 목록'],
      ['/inspections/calendar', '점검 달력'],
    ]
    for (let step = 1; step <= 6; step++) routes.push([`/inspections/${insp}?step=${step}`, `작업대 ${step}단계`])

    for (const [path, label] of routes) {
      await page.goto(`${BASE}${path}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(900)
      const s = JSON.parse(await page.evaluate(SCAN) as string) as ScanOut
      report(`[${mode}] ${label}`, s)
      checkCoverage(mode, label, s.counted)
      modeFail += s.fail.length
    }

    // 점검표 드로어 열린 상태 — sheet-item-editor가 이 안에만 있다(S5의 대상 화면)
    await page.goto(`${BASE}/inspections/${insp}?step=1`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const card = page.locator('[data-group-key]').first()
    if (await card.count() > 0) {
      await card.click()
      await page.waitForSelector('[data-testid="sheet-drawer"]', { timeout: 20000 }).catch(() => {})
      // ⚠ 드로어 **껍데기**가 뜬 것과 항목이 그려진 것은 다르다. 고정 대기만 두면 덜 그려진 채
      // 재게 되고, 그러면 FAIL이 적게 나와 **개선처럼 보인다**(실제로 baseline 다크가 그렇게
      // 215칸만 걷혀 334로 기록됐다 — 뒤 실행의 293칸과 비교 불가였다). 항목이 실제로
      // 붙을 때까지 기다린다.
      await page.locator('[data-testid="sheet-drawer"] button[aria-label$=" O"]').first()
        .waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(900)
      const s = JSON.parse(await page.evaluate(SCAN) as string) as ScanOut
      report(`[${mode}] 점검표 드로어(열림)`, s)
      checkCoverage(mode, '점검표 드로어(열림)', s.counted)
      // S5-6 — 눈이 아니라 **전체 FAIL 목록**으로 판정한다(출력은 잘리므로 데이터를 직접 훑는다).
      // 항목코드(참조 키)와 [불량 등록] 안내문이 목록에서 사라졌는가.
      const codeLeft = s.fail.filter(f => /w-20/.test(f.cls) && /ink-faint/.test(f.cls))
      const hintLeft = s.fail.filter(f => f.text.includes('불량 등록'))
      check(`S5-6 [${mode}] 항목코드가 FAIL에 없다`, codeLeft.length === 0,
        codeLeft.map(f => `${f.ratio}:1 ${f.cls}`).join(' · '))
      check(`S5-6 [${mode}] [불량 등록] 안내문이 FAIL에 없다`, hintLeft.length === 0,
        hintLeft.map(f => `${f.ratio}:1 "${f.text}"`).join(' · '))
      modeFail += s.fail.length
    } else {
      console.log(`\n── [${mode}] 점검표 드로어 — 시트 카드가 없어 건너뜀`)
    }

    totals[mode] = modeFail
    console.log(`\n══ [${mode}] FAIL 합계 ${modeFail}`)
  }

  console.log(`\n══ 총계 — 라이트 ${totals.light} · 다크 ${totals.dark}`)
  if (REPORT_ONLY) {
    console.log(`   (보고 전용) S1-5 baseline으로 기록할 값: { light: ${totals.light}, dark: ${totals.dark} }`)
  } else if (!BASELINE) {
    console.log('   ⚠ BASELINE 미설정 — 게이트가 서지 않는다. S1-5로 채취해 상수에 박을 것.')
  } else {
    // S6-9 래칫 — 악화만 차단한다(사용자 확정)
    check(`S6-9 래칫 라이트 (${totals.light} ≤ ${BASELINE.light})`, totals.light <= BASELINE.light)
    check(`S6-9 래칫 다크 (${totals.dark} ≤ ${BASELINE.dark})`, totals.dark <= BASELINE.dark)
  }
} catch (e) {
  check('예외 없이 완주', false, String(e).slice(0, 300))
} finally {
  if (browser) await browser.close()
  if (insp) await raw.from('inspection_defects').delete().eq('inspection_id', insp)
  if (cust) await cleanupCustomer(cust)
  if (userId) await delUser(userId)
}
summary('소방계획서_36 대비 검사')
