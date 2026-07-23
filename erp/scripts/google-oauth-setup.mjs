// Google OAuth refresh token 발급 헬퍼 (1회 실행) — Gmail 조회 + Drive 백업용
// 사용법: node scripts/google-oauth-setup.mjs <CLIENT_ID> <CLIENT_SECRET>
//   1) 출력된 URL을 브라우저에서 열고 sjfirekorea@gmail.com으로 동의
//   2) 자동으로 토큰이 교환되어 .env에 넣을 값이 출력됨
import http from 'http'

const [clientId, clientSecret] = process.argv.slice(2)
if (!clientId || !clientSecret) {
  console.error('사용법: node scripts/google-oauth-setup.mjs <CLIENT_ID> <CLIENT_SECRET>')
  process.exit(1)
}

const PORT = 8756
const REDIRECT = `http://localhost:${PORT}/callback`
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send', // §9-9d 관계인 보고 이메일 발송
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent',
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
  const code = url.searchParams.get('code')
  if (!code) { res.end('인증 코드가 없습니다. 다시 시도하세요.'); return }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  })
  const data = await tokenRes.json()
  if (!data.refresh_token) {
    console.error('\n❌ refresh_token이 없습니다. 응답:', JSON.stringify(data, null, 2))
    res.end('실패 — 터미널을 확인하세요.')
    server.close()
    process.exit(1)
  }

  console.log('\n✅ 발급 완료! 아래 3줄을 서버 환경변수(.env)에 추가하세요:\n')
  console.log(`GOOGLE_CLIENT_ID=${clientId}`)
  console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`)
  console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<h3>발급 완료 — 터미널의 환경변수 3줄을 복사하세요. 이 창은 닫아도 됩니다.</h3>')
  server.close()
})

server.listen(PORT, () => {
  console.log('아래 URL을 브라우저에서 열고 sjfirekorea@gmail.com으로 로그인·동의하세요:\n')
  console.log(authUrl + '\n')
  console.log(`(동의 후 자동으로 localhost:${PORT}로 돌아와 토큰이 발급됩니다)`)
})
