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
 * HTML → PDF 변환 (소방계획서 표준양식 생성 등).
 * Gotenberg Chromium 라우트 사용 — A4 세로, 배경 인쇄 포함.
 * assets: HTML에서 상대경로(파일명)로 참조하는 이미지 등 부속 파일 (멀티파트 첨부)
 */
export async function convertHtmlToPdf(
  html: string,
  assets: Array<{ name: string; data: Uint8Array; mime: string }> = [],
): Promise<Uint8Array> {
  const base = process.env.GOTENBERG_URL
  if (!base) throw new Error('GOTENBERG_URL 미설정 — PDF 변환 서비스가 구성되지 않았습니다.')

  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  for (const a of assets) {
    form.append('files', new Blob([a.data as BlobPart], { type: a.mime }), a.name)
  }
  form.append('paperWidth', '8.27')    // A4 (inch)
  form.append('paperHeight', '11.69')
  form.append('marginTop', '0.6')
  form.append('marginBottom', '0.6')
  form.append('marginLeft', '0.55')
  form.append('marginRight', '0.55')
  form.append('printBackground', 'true')

  const res = await fetch(`${base.replace(/\/$/, '')}/forms/chromium/convert/html`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg HTML 변환 실패 (${res.status}): ${detail.slice(0, 200)}`)
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
