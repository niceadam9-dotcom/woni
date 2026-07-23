import 'server-only'

/** Google API 연동 (sjfirekorea@gmail.com 공용 계정) — Gmail 조회 + Drive 백업 (2026-07-15)
 *  인증: OAuth refresh token (scripts/google-oauth-setup.mjs로 1회 발급)
 *  환경변수: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN */

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)
}

// ── access token 캐시 (만료 60초 전 갱신) ─────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google 토큰 갱신 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function gapi<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Google API 오류 (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}

// ── Gmail ─────────────────────────────────────────────────────
export type MailSummary = {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  unread: boolean
  hasAttachment: boolean
}

type GmailHeader = { name: string; value: string }
type GmailPart = {
  partId?: string; mimeType?: string; filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}
type GmailMessage = {
  id: string; snippet?: string; labelIds?: string[]
  payload?: GmailPart
  internalDate?: string
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** 받은편지함 목록 (q: Gmail 검색 문법 그대로) */
export async function gmailList(opts: { q?: string; pageToken?: string; maxResults?: number } = {}): Promise<{
  messages: MailSummary[]; nextPageToken?: string
}> {
  const params = new URLSearchParams({ maxResults: String(opts.maxResults ?? 25) })
  params.set('q', opts.q?.trim() ? opts.q : 'in:inbox')
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  const list = await gapi<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
    `${GMAIL}/messages?${params}`)
  const ids = (list.messages ?? []).map(m => m.id)
  const messages = await Promise.all(ids.map(async id => {
    const m = await gapi<GmailMessage>(
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    return {
      id: m.id,
      from: header(m, 'From'),
      subject: header(m, 'Subject') || '(제목 없음)',
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
      snippet: m.snippet ?? '',
      unread: m.labelIds?.includes('UNREAD') ?? false,
      hasAttachment: false,
    }
  }))
  return { messages, nextPageToken: list.nextPageToken }
}

export type MailDetail = {
  id: string
  from: string
  to: string
  subject: string
  date: string
  html: string | null
  text: string | null
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function walkParts(part: GmailPart | undefined, out: { html?: string; text?: string; atts: MailDetail['attachments'] }) {
  if (!part) return
  if (part.filename && part.body?.attachmentId) {
    out.atts.push({
      filename: part.filename, mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body.size ?? 0, attachmentId: part.body.attachmentId,
    })
  } else if (part.mimeType === 'text/html' && part.body?.data && !out.html) {
    out.html = decodeB64Url(part.body.data)
  } else if (part.mimeType === 'text/plain' && part.body?.data && !out.text) {
    out.text = decodeB64Url(part.body.data)
  }
  for (const p of part.parts ?? []) walkParts(p, out)
}

export async function gmailGet(id: string): Promise<MailDetail> {
  const m = await gapi<GmailMessage>(`${GMAIL}/messages/${id}?format=full`)
  const out = { atts: [] as MailDetail['attachments'] } as { html?: string; text?: string; atts: MailDetail['attachments'] }
  walkParts(m.payload, out)
  return {
    id: m.id,
    from: header(m, 'From'),
    to: header(m, 'To'),
    subject: header(m, 'Subject') || '(제목 없음)',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : '',
    html: out.html ?? null,
    text: out.text ?? null,
    attachments: out.atts,
  }
}

export async function gmailGetAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
  const res = await gapi<{ data: string }>(`${GMAIL}/messages/${messageId}/attachments/${attachmentId}`)
  return new Uint8Array(Buffer.from(res.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
}

// ── Drive (백업 미러) ─────────────────────────────────────────
const DRIVE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

function escapeQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** 폴더 확보 (없으면 생성) — 반환: 폴더 ID */
export async function driveEnsureFolder(name: string, parentId: string | null): Promise<string> {
  const parent = parentId ?? 'root'
  const q = `name='${escapeQ(name)}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const found = await gapi<{ files: Array<{ id: string }> }>(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  if (found.files.length > 0) return found.files[0].id
  const created = await gapi<{ id: string }>(`${DRIVE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  })
  return created.id
}

export async function driveFileExists(name: string, parentId: string): Promise<boolean> {
  const q = `name='${escapeQ(name)}' and '${parentId}' in parents and trashed=false`
  const found = await gapi<{ files: Array<{ id: string }> }>(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)`)
  return found.files.length > 0
}

export async function driveUpload(name: string, parentId: string, data: Uint8Array, mime: string): Promise<string> {
  const boundary = 'erp_backup_boundary'
  const meta = JSON.stringify({ name, parents: [parentId] })
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(data), Buffer.from(tail, 'utf8')])
  const token = await getAccessToken()
  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  })
  if (!res.ok) throw new Error(`Drive 업로드 실패 (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { id: string }).id
}

// ── Gmail 발송 (§9-9d 관계인 보고 — 첨부 1개 MIME) ─────────────
// ⚠ gmail.send 스코프 필요 — 기존 토큰(readonly)이면 403: scripts/google-oauth-setup.mjs 재실행 후 GOOGLE_REFRESH_TOKEN 교체
function b64url(data: Uint8Array | string): string {
  const b64 = typeof data === 'string' ? Buffer.from(data).toString('base64') : Buffer.from(data).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function gmailSendWithAttachment(opts: {
  to: string
  subject: string
  bodyText: string
  attachment?: { filename: string; mime: string; data: Uint8Array }
}): Promise<{ messageId: string }> {
  const boundary = `sjfire_${Math.random().toString(36).slice(2)}`
  const subjectEnc = `=?UTF-8?B?${Buffer.from(opts.subject).toString('base64')}?=`
  const lines: string[] = [
    `To: ${opts.to}`,
    `Subject: ${subjectEnc}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(opts.bodyText).toString('base64'),
  ]
  if (opts.attachment) {
    const fnEnc = `=?UTF-8?B?${Buffer.from(opts.attachment.filename).toString('base64')}?=`
    lines.push(
      `--${boundary}`,
      `Content-Type: ${opts.attachment.mime}; name="${fnEnc}"`,
      `Content-Disposition: attachment; filename="${fnEnc}"`,
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(opts.attachment.data).toString('base64'),
    )
  }
  lines.push(`--${boundary}--`)
  const raw = b64url(lines.join('\r\n'))
  const res = await gapi<{ id: string }>('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  return { messageId: res.id }
}
