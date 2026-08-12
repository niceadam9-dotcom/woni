/** [독립 판정 19] 서버 액션 직접 호출 헬퍼 — getAnnexPreviewHtmlAction('exterior')는 UI 진입점이 없다
 *  (외관점검표는 [생성](requestReport9Action)만 있고, 생성은 GOTENBERG_URL 미설정 로컬에서 불가).
 *  그래서 **같은 서버 액션을** 로그인 세션 쿠키로 HTTP 호출한다 — 코드 경로는 UI와 완전히 동일하다.
 *  dev 번들에 createServerReference("<id>", …, "<함수명>") 형태로 액션 id가 실려 있어 그걸 추출한다. */

/** 페이지가 받아간 js 청크에서 서버 액션 id 추출.
 *  dev 청크에는 `__next_internal_action_entry_do_not_use__ [{"<id>":{"name":"<fn>"}}, …]` 주석이 실린다. */
export async function findActionId(page, fnName, urls) {
  const re = new RegExp(`\\{"([0-9a-f]{40,})":\\{"name":"${fnName}"\\}`)
  for (const u of urls) {
    let text = ''
    try { text = await (await page.request.get(u)).text() } catch { continue }
    const m = re.exec(text)
    if (m) return m[1]
  }
  return null
}

/** page.on('response')로 js URL을 모으는 수집기 부착 */
export function collectScripts(page) {
  const urls = new Set()
  page.on('response', r => { const u = r.url(); if (u.includes('_next/static') && u.includes('.js')) urls.add(u) })
  return urls
}

/** 서버 액션 HTTP 호출 → 반환 객체(JSON) */
export async function callAction(page, actionId, args) {
  return await page.evaluate(async ({ actionId, args }) => {
    const res = await fetch(location.pathname + location.search, {
      method: 'POST',
      headers: { 'Next-Action': actionId, 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(args),
    })
    return { status: res.status, text: await res.text() }
  }, { actionId, args })
}

/** RSC flight 응답 파싱 — 큰 문자열은 `N:T<바이트길이(16진)>,<본문>` 청크로 나온다.
 *  반환: { html, missing, error } (액션 반환 객체의 참조 `$N`을 해소해 채운다) */
export function parseFlight(text) {
  // 1) 텍스트 청크 수집 — 선언된 바이트 길이만큼 정확히 잘라낸다
  const enc = new TextEncoder(); const dec = new TextDecoder()
  const chunks = {}
  const reT = /(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g
  let m
  while ((m = reT.exec(text)) !== null) {
    const start = m.index + m[0].length
    const bytes = enc.encode(text.slice(start))
    chunks[m[1]] = dec.decode(bytes.slice(0, parseInt(m[2], 16)))
  }
  // 2) 액션 반환 객체 행 — 텍스트 청크 바로 뒤에 개행 없이 붙어 나오므로(`</html>1:{…}`) 행 분해가 아니라
  //    마지막 `N:{"html"|"error"|"missing"` 위치에서 끝까지 JSON 파싱한다
  let obj = null
  for (const key of ['html', 'error', 'missing']) {
    const i = text.lastIndexOf(`:{"${key}"`)
    if (i < 0) continue
    try {
      const o = JSON.parse(text.slice(i + 1).trim())
      if (o && typeof o === 'object') { obj = o; break }
    } catch { /* 다음 키 */ }
  }
  if (!obj) return { html: '', missing: [], error: '', raw: text }
  const deref = v => (typeof v === 'string' && /^\$[0-9a-f]+$/.test(v)) ? (chunks[v.slice(1)] ?? v) : v
  return {
    html: deref(obj.html) ?? '',
    missing: Array.isArray(obj.missing) ? obj.missing.map(deref) : [],
    error: deref(obj.error) ?? '',
  }
}
