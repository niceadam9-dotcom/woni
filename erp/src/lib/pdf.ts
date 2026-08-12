import 'server-only'

/**
 * xlsx(또는 기타 오피스 문서) → PDF 변환 (P32-1).
 * Gotenberg LibreOffice 라우트 사용. 환경변수 GOTENBERG_URL 필요(예: http://gotenberg-staging:3000).
 */
export async function convertXlsxToPdf(
  xlsx: Uint8Array,
  fileName = 'report.xlsx',
  opts?: { landscape?: boolean },
): Promise<Uint8Array> {
  const base = process.env.GOTENBERG_URL
  if (!base) throw new Error('GOTENBERG_URL 미설정 — PDF 변환 서비스가 구성되지 않았습니다.')

  const form = new FormData()
  form.append(
    'files',
    new Blob([xlsx as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    fileName,
  )
  if (opts?.landscape) form.append('landscape', 'true')

  const res = await fetch(`${base.replace(/\/$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg 변환 실패 (${res.status}): ${detail.slice(0, 200)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * HTML → PDF 변환 (소방계획서 표준양식·별지 서식 생성 — 소방계획서_7 H-2 단일 경로).
 * Gotenberg Chromium 라우트 사용 — A4 세로, 배경 인쇄 포함.
 * assets: HTML에서 상대경로(파일명)로 참조하는 이미지 등 부속 파일 (멀티파트 첨부)
 * 서식은 @page 여백을 자체 정의하므로 marginMode 'none'을 쓴다(doc-templates 공통 CSS 기준).
 */
export async function convertHtmlToPdf(
  html: string,
  assets: Array<{ name: string; data: Uint8Array; mime: string }> = [],
  opts?: { marginMode?: 'default' | 'none'; timeoutMs?: number },
): Promise<Uint8Array> {
  const base = process.env.GOTENBERG_URL
  if (!base) throw new Error('GOTENBERG_URL 미설정 — PDF 변환 서비스가 구성되지 않았습니다.')

  const buildForm = () => {
    const form = new FormData()
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
    for (const a of assets) {
      form.append('files', new Blob([a.data as BlobPart], { type: a.mime }), a.name)
    }
    form.append('paperWidth', '8.27')    // A4 (inch)
    form.append('paperHeight', '11.69')
    if (opts?.marginMode === 'none') {
      // 서식 템플릿: 여백은 HTML @page가 결정 — Gotenberg 여백 0
      for (const k of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) form.append(k, '0')
    } else {
      form.append('marginTop', '0.6')
      form.append('marginBottom', '0.6')
      form.append('marginLeft', '0.55')
      form.append('marginRight', '0.55')
    }
    form.append('printBackground', 'true')
    return form
  }

  // 일시 오류(네트워크·컨테이너 재기동) 1회 재시도 — 타임아웃 기본 60s (H-2)
  const timeout = opts?.timeoutMs ?? 60_000
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/forms/chromium/convert/html`, {
        method: 'POST',
        body: buildForm(),
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        // 4xx는 요청 자체 문제 — 재시도 무의미
        if (res.status < 500) throw new Error(`Gotenberg HTML 변환 실패 (${res.status}): ${detail.slice(0, 200)}`)
        lastErr = new Error(`Gotenberg HTML 변환 실패 (${res.status}): ${detail.slice(0, 200)}`)
        continue
      }
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Gotenberg HTML 변환 실패 (4')) throw e
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Gotenberg HTML 변환 실패: ${String(lastErr)}`)
}

/**
 * ODT → PDF 변환 (소방계획서 HWP 워커 2단계 폴백 — 워커 로컬 LibreOffice 실패 시 크론이 호출).
 * Gotenberg LibreOffice 라우트 사용.
 */
export async function convertOdtToPdf(odt: Uint8Array, fileName = 'doc.odt'): Promise<Uint8Array> {
  const base = process.env.GOTENBERG_URL
  if (!base) throw new Error('GOTENBERG_URL 미설정 — PDF 변환 서비스가 구성되지 않았습니다.')

  const form = new FormData()
  form.append('files', new Blob([odt as BlobPart], { type: 'application/vnd.oasis.opendocument.text' }), fileName)

  const res = await fetch(`${base.replace(/\/$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg ODT 변환 실패 (${res.status}): ${detail.slice(0, 200)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * PDF 병합 (소방계획서_18 S1 — 회차 별지 묶음 인쇄).
 * Gotenberg pdfengines/merge 라우트 사용 — 파일명 알파벳 순으로 병합되므로
 * 0패딩 인덱스 파일명(001.pdf, 002.pdf…)으로 순서를 제어한다.
 */
export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  // 병합이 필요 없는 경우를 먼저 처리한다 — 서식이 하나뿐인 회차까지 Gotenberg를 요구하면
  // 변환 서비스가 없는 환경에서 인쇄가 통째로 막힌다.
  if (pdfs.length === 0) throw new Error('병합할 PDF가 없습니다.')
  if (pdfs.length === 1) return pdfs[0]
  const base = process.env.GOTENBERG_URL
  if (!base) throw new Error('GOTENBERG_URL 미설정 — PDF 변환 서비스가 구성되지 않았습니다.')

  const form = new FormData()
  pdfs.forEach((p, i) => {
    form.append('files', new Blob([p as BlobPart], { type: 'application/pdf' }),
      `${String(i + 1).padStart(3, '0')}.pdf`)
  })

  const res = await fetch(`${base.replace(/\/$/, '')}/forms/pdfengines/merge`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg PDF 병합 실패 (${res.status}): ${detail.slice(0, 200)}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

/** Gotenberg 헬스체크 */
export async function gotenbergHealthy(): Promise<boolean> {
  const base = process.env.GOTENBERG_URL
  if (!base) return false
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
