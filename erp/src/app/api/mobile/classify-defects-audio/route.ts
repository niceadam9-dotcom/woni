import { NextResponse, type NextRequest } from 'next/server'
import { requireMobileUser } from '@/lib/mobile-auth'

// Claude API는 오디오 직접 입력을 지원하지 않습니다.
// 모바일 앱에서 expo-speech 등으로 텍스트 변환 후 /api/mobile/classify-defects 를 사용하세요.
export async function POST(req: NextRequest) {
  // proxy가 /api/mobile/을 통과시킨다 — 이 경로도 인증부터(lib/mobile-auth)
  const auth = await requireMobileUser(req)
  if ('response' in auth) return auth.response
  return NextResponse.json(
    { error: '음성 파일 직접 분류는 지원되지 않습니다. 텍스트로 변환 후 /api/mobile/classify-defects 를 사용하세요.' },
    { status: 400 }
  )
}
